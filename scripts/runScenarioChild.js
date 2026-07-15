'use strict';

// Runs ONE scenario in a dedicated child process and streams events to the
// parent over IPC. A fresh process per run is the only reliable way to get a
// clean engine: screeps-server-mockup / @screeps/driver keep module-level
// singleton state (storage connection, pubsub, Memory), so running multiple
// scenarios in one long-lived process leaks state between runs. The CLI avoids
// this by running once per process; the GUI server now does the same by forking.
//
// Each frame is rendered to a full-fidelity SVG here (same renderFrameSvg the
// MP4/GIF exporter uses) so the live preview and replays look identical.
//
//   fork: node scripts/runScenarioChild.js <scenarioDir> [record]
//   parent -> child:  { type: 'abort' }
//   child  -> parent: { ev: <runner event, frame events gain .svg> } ... { done: true }
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const { runScenario } = require('../src/scenarioRunner');
const { renderFrameSvg, computeLayout } = require('../src/render/frameRenderer');

const PIXELS_PER_ROOM = 600;

function layoutOf(terrain) {
	const rooms = Object.keys(terrain || {});
	const layout = computeLayout(rooms);
	return {
		rooms: rooms, offsets: layout.offsets, pixelsPerRoom: PIXELS_PER_ROOM,
		width: layout.columns * PIXELS_PER_ROOM, height: layout.rows * PIXELS_PER_ROOM
	};
}

const scenarioDir = process.argv[2];
const record = process.argv[3] === 'record' || process.argv[3] === '1';

if (!scenarioDir) { console.error('usage: runScenarioChild <scenarioDir> [record]'); process.exit(2); }

const signal = { aborted: false };
process.on('message', function (msg) { if (msg && msg.type === 'abort') signal.aborted = true; });

// Accumulate a recording-shaped object so renderFrameSvg can draw the latest
// frame (it looks at frame N and N+1 and scans back for facing).
const acc = { terrain: {}, frames: [], meta: { botUserId: null, scenario: '' } };

function send(obj) { if (process.send) process.send(obj); }

runScenario(scenarioDir, {
	signal: signal,
	runExpect: true,
	record: record,
	streamFrames: true,
	onEvent: function (ev) {
		try {
			if (ev.type === 'start') { acc.meta.scenario = ev.scenario; if (ev.botUserId) acc.meta.botUserId = ev.botUserId; }
			else if (ev.type === 'terrain') {
				acc.terrain = ev.terrain || {};
				if (ev.botUserId) acc.meta.botUserId = ev.botUserId;
				send({ ev: { type: 'layout', layout: layoutOf(acc.terrain) } });
				return;
			}
			else if (ev.type === 'frame') {
				acc.frames.push(ev.frame);
				let svg = null;
				try { svg = renderFrameSvg(acc, acc.frames.length - 1, 0, { staticActions: true }); } catch (e) { /* keep streaming */ }
				// forward a slimmer frame event: svg for rendering, objects for the inspector
				send({ ev: { type: 'frame', gameTime: ev.frame.gameTime, objects: ev.frame.objects, console: ev.frame.console, svg: svg } });
				return;
			}
			send({ ev: ev });
		} catch (e) { /* never let a forwarding error kill the run */ }
	}
}).then(function () {
	send({ done: true });
	process.exit(0);
}).catch(function (err) {
	send({ ev: { type: 'fatal', error: String((err && err.message) || err) } });
	send({ done: true });
	process.exit(1);
});

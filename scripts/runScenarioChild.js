'use strict';

// Runs ONE scenario in a dedicated child process and streams events to the
// parent over IPC. A fresh process per run is the only reliable way to get a
// clean engine: screeps-server-mockup / @screeps/driver keep module-level
// singleton state (storage connection, pubsub, Memory), so running multiple
// scenarios in one long-lived process leaks state between runs.
//
// Game mods make that structural rather than merely tidy: a mod mutates the
// shared constants object, registers engine listeners and pushes custom object
// prototypes into the driver, and @screeps/common offers no way to unload one.
// A process that has run a Season 5 scenario can never run a vanilla one again.
// Both the GUI (src/server/jobManager.js) and the CLI suite
// (test/scenarios.test.js) therefore fork this, through src/scenarioChild.js.
//
//   fork: node scripts/runScenarioChild.js <scenarioDir> [record] [no-frames]
//   parent -> child:  { type: 'abort' }
//   child  -> parent: { ev: <runner event> } ... { done: true, result | error }
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const { runScenario } = require('../src/scenarioRunner');

const scenarioDir = process.argv[2];
const flags = process.argv.slice(3);
const record = flags.indexOf('record') !== -1 || flags.indexOf('1') !== -1;
// Frames are the expensive part of the IPC stream and only the live preview
// wants them; a headless verdict run asks for text only.
const streamFrames = flags.indexOf('no-frames') === -1;

if (!scenarioDir) { console.error('usage: runScenarioChild <scenarioDir> [record] [no-frames]'); process.exit(2); }

const signal = { aborted: false };
process.on('message', function (msg) { if (msg && msg.type === 'abort') signal.aborted = true; });

function send(obj) { if (process.send) process.send(obj); }

runScenario(scenarioDir, {
	signal: signal,
	runExpect: true,
	record: record,
	streamFrames: streamFrames,
	onEvent: function (ev) {
		try { send({ ev: ev }); } catch (e) { /* forwarding never breaks the run */ }
	}
}).then(function (result) {
	// The verdict, small enough to cross IPC: finalState never does — it is the
	// whole world, and the parent has the frames if it asked for them.
	send({
		done: true,
		result: {
			endReason: result.endReason,
			ticks: result.ticks,
			damageTaken: result.damageTaken,
			survived: result.survived,
			mods: result.mods,
			recordingPath: result.recordingPath,
			test: result.test || null
		}
	});
	process.exit(0);
}).catch(function (err) {
	// Boot and mod-load failures land here: they happen before the first tick,
	// so `end` never fired and this is the only thing the parent will see.
	send({ ev: { type: 'fatal', error: String((err && err.message) || err) } });
	send({ done: true, error: String((err && err.stack) || err), recordingPath: err && err.recordingPath || null });
	process.exit(1);
});

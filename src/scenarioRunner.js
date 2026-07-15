'use strict';

// Runs one scenario dir against a fresh world (spec §4/§6): setup -> tick loop
// with per-tick snapshots -> end on until()/maxTicks/botDied -> result object.
//
// There is deliberately NO wall-clock limit on a run: maxTicks bounds it, and
// a per-tick watchdog (default 60s, scenario.tickTimeout overrides) catches a
// genuinely stalled server. The scenario test suite disables mocha's timeout
// for the same reason.
//
// Memory: recordings stream to disk frame by frame (frames.ndjson journal);
// RAM stays flat regardless of run length. SIGTERM/SIGINT finalize the
// recording synchronously before exiting, so a docker stop / OOM-adjacent
// kill still leaves a loadable recording.json.
//
// GUI control-plane (Phase 1): runScenario accepts an optional options arg —
// fully backward compatible (mocha/scripts pass none). It can stream live
// events (onEvent), be aborted cooperatively (signal, checked at the tick
// boundary — NEVER via a process signal, since the GUI server and sim share
// one process), force recording (options.record), and run the scenario's
// expect() to capture pass/fail (options.runExpect) for the Replays badge.
const path = require('path');
const assert = require('assert');
const DojoWorld = require('./dojoWorld');
const { createRecorder } = require('./recording');
const { getMockEngineFeatures } = require('./serverBoot');

const DEFAULT_TICK_TIMEOUT_MS = 60000;

function snapshotHits(state) {
	const hits = {};
	for (const name of Object.keys(state.creeps)) hits[name] = state.creeps[name].hits;
	return hits;
}

// Damage = sum of hits lost per bot creep; a creep that disappears counts its
// remaining hits as damage taken that tick.
function accumulateDamage(damageTaken, previousHits, state) {
	for (const name of Object.keys(previousHits)) {
		const creep = state.creeps[name];
		const lost = creep === undefined ? previousHits[name] : Math.max(0, previousHits[name] - creep.hits);
		if (lost > 0) damageTaken[name] = (damageTaken[name] || 0) + lost;
	}
}

async function runScenario(scenarioDir, options) {
	options = options || {};
	const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
	const streamFrames = onEvent && options.streamFrames !== false;
	function emit(evt) { if (onEvent) { try { onEvent(evt); } catch (e) { /* listener errors never break the run */ } } }
	function isAborted() { const s = options.signal; return !!(s && s.aborted === true); }

	const scenario = require(path.join(scenarioDir, 'scenario.js'));
	if (typeof scenario.maxTicks !== 'number' || scenario.maxTicks <= 0) throw new Error(scenarioDir + ': maxTicks is required');
	if (typeof scenario.setup !== 'function') throw new Error(scenarioDir + ': setup(world) is required');
	if (typeof scenario.expect !== 'function') throw new Error(scenarioDir + ': expect(result, assert) is required');

	const world = new DojoWorld();
	const consoleLines = [];
	let lastConsoleLen = 0;
	const recordingEnabled = options.record === true || scenario.record === true || process.env.DOJO_RECORD === '1';
	let recorder = null;
	let ticks = 0;

	function recordingMeta(endReason, error, test) {
		const meta = {
			scenario: path.basename(scenarioDir),
			createdAt: new Date().toISOString(),
			botUserId: world.botUserId,
			endReason: endReason,
			ticks: ticks
		};
		if (error) meta.error = String(error);
		if (test) meta.test = test;
		return meta;
	}

	// Docker sends SIGTERM on stop/OOM-kill; finalize is fully synchronous so
	// the recording survives even though no further event-loop turns happen.
	function onKillSignal(signal) {
		const recordingPath = recorder.finalize(recordingMeta('killed', 'received ' + signal));
		console.log('\trecording finalized on ' + signal + ': ' + recordingPath);
		process.exit(143);
	}

	const tickTimeoutMs = typeof scenario.tickTimeout === 'number' ? scenario.tickTimeout : DEFAULT_TICK_TIMEOUT_MS;

	// A tick that never resolves means the server stalled; without this the
	// run would hang forever now that there is no wall-clock test timeout.
	function tickWithWatchdog() {
		let timer = null;
		const watchdog = new Promise(function (unused, reject) {
			timer = setTimeout(function () {
				reject(new Error('server stalled: tick ' + (ticks + 1) + ' did not complete within '
					+ tickTimeoutMs + 'ms (override with scenario.tickTimeout)'));
			}, tickTimeoutMs);
		});
		return Promise.race([world.tick(), watchdog]).finally(function () {
			clearTimeout(timer);
		});
	}

	// Drains console lines accumulated since the last call (per-tick delta).
	function takeConsoleDelta() {
		if (consoleLines.length === lastConsoleLen) return [];
		const delta = consoleLines.slice(lastConsoleLen);
		lastConsoleLen = consoleLines.length;
		return delta;
	}

	try {
		await world.reset();
		world.modules = typeof scenario.modules === 'function' ? scenario.modules() : scenario.modules;
		await scenario.setup(world);
		if (!world.bot) {
			throw new Error(scenarioDir + ': setup() must add the main bot (loadScenarioMaps or addMainBot)');
		}
		world.bot.on('console', function (logs) {
			for (const line of logs || []) consoleLines.push(line);
		});

		await world.start();

		// optional hook: runs with the server LIVE, before metrics/recording
		// begin — for setup that needs ticks (e.g. probe the bot's own base
		// plan via evalInBot, then place the spawn where it wants one)
		if (typeof scenario.afterStart === 'function') {
			await scenario.afterStart(world);
		}

		let state = await world.readState();
		emit({
			type: 'start', scenario: path.basename(scenarioDir), maxTicks: scenario.maxTicks,
			botUserId: world.botUserId, mockEngineFeatures: getMockEngineFeatures()
		});

		// terrain is captured once (it never changes); feed both the recorder
		// and the live stream so the live preview can draw rooms.
		let terrain = null;
		if (recordingEnabled || streamFrames) terrain = await world.captureTerrain();
		if (recordingEnabled) {
			recorder = createRecorder(path.basename(scenarioDir));
			recorder.writeMeta(recordingMeta('in-progress', null)); // even SIGKILL leaves identifiable metadata
			recorder.setTerrain(terrain);
			process.once('SIGTERM', onKillSignal);
			process.once('SIGINT', onKillSignal);
		}
		if (streamFrames) emit({ type: 'terrain', terrain: terrain, botUserId: world.botUserId });
		// initial pre-tick frame (for recording and/or live stream)
		if (recorder || streamFrames) {
			const frame0 = await world.captureFrame();
			frame0.console = [];
			if (recorder) recorder.addFrame(frame0);
			if (streamFrames) emit({ type: 'frame', frame: frame0 });
		}

		const damageTaken = {};
		const seenCreeps = new Set(Object.keys(state.creeps));
		let previousHits = snapshotHits(state);
		let endReason = 'maxTicks';

		for (let i = 0; i < scenario.maxTicks; i++) {
			if (isAborted()) { endReason = 'aborted'; break; }
			await tickWithWatchdog();
			ticks++;
			state = await world.readState();

			// Surface any bot crash from this tick as a console line so a throwing
			// bot is never silent (e.g. "Could not load terrain data" when the bot
			// paths through an open exit into an unloaded room).
			if (typeof world.takeBotErrors === 'function') {
				for (const err of world.takeBotErrors()) consoleLines.push('⚠ bot error: ' + err);
			}

			const tickConsole = takeConsoleDelta();
			// capture the frame ONCE and feed both the recorder and the live
			// stream (captureFrame is an expensive db scan — never double it)
			if (recorder || streamFrames) {
				const frame = await world.captureFrame();
				frame.console = tickConsole;
				if (recorder) recorder.addFrame(frame);
				if (streamFrames) emit({ type: 'frame', frame: frame });
			}
			if (tickConsole.length) emit({ type: 'console', lines: tickConsole });
			emit({ type: 'tick', tick: ticks, maxTicks: scenario.maxTicks });

			for (const name of Object.keys(state.creeps)) seenCreeps.add(name);
			accumulateDamage(damageTaken, previousHits, state);
			previousHits = snapshotHits(state);
			if (seenCreeps.size > 0 && Object.keys(state.creeps).length === 0) {
				endReason = 'botDied';
				break;
			}
			// botDied wins over until so endReason stays diagnostic (until() may also return true on death)
			if (scenario.until && scenario.until(state)) {
				endReason = 'until';
				break;
			}
		}

		const survived = {};
		for (const name of seenCreeps) survived[name] = state.creeps[name] !== undefined;

		// Build the result first (recordingPath unknown until finalize). expect()
		// runs against this and never needs recordingPath, so there's no ordering
		// cycle: run expect -> capture pass/fail -> finalize meta (with test) ->
		// set recordingPath.
		const result = {
			endReason: endReason,
			ticks: ticks,
			damageTaken: damageTaken,
			survived: survived,
			console: consoleLines,
			finalState: state,
			recordingPath: null
		};

		let test = null;
		if (options.runExpect) {
			try { scenario.expect(result, assert); test = { passed: true, message: null }; }
			catch (e) { test = { passed: false, message: String((e && e.message) || e) }; }
			result.test = test;
		}

		if (recorder) {
			result.recordingPath = recorder.finalize(recordingMeta(endReason, null, test));
		}

		emit({ type: 'end', endReason: endReason, ticks: ticks, recordingPath: result.recordingPath, test: test });
		return result;
	} catch (error) {
		// A failed run is exactly the one worth replaying: finalize whatever
		// was journaled before the abort and surface the path on the error.
		if (recorder && recorder.frameCount() > 0) {
			try {
				error.recordingPath = recorder.finalize(recordingMeta('aborted', error));
				console.log('\tpartial recording saved: ' + error.recordingPath);
			} catch (writeError) {
				console.error('\tfailed to save partial recording: ' + writeError);
			}
		}
		emit({ type: 'end', endReason: 'error', ticks: ticks, error: String((error && error.message) || error) });
		throw error;
	} finally {
		if (recorder) {
			// don't stack handlers across sequential scenario runs
			process.removeListener('SIGTERM', onKillSignal);
			process.removeListener('SIGINT', onKillSignal);
		}
		world.stop();
	}
}

module.exports = { runScenario: runScenario };

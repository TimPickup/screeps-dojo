'use strict';

// Forks one scenario run into its own process (scripts/runScenarioChild.js) and
// turns the IPC chatter into { child, promise }.
//
// Both callers need the same fork, so it lives here rather than twice:
//   - the GUI (src/server/jobManager.js) wants the live event stream and the
//     child handle, to fan events out over SSE and to abort a run;
//   - the CLI suite (test/scenarios.test.js) wants only the final verdict.
//
// Every run needs its OWN process because a game mod cannot be unloaded — see
// the header of scripts/runScenarioChild.js.
const path = require('path');
const { fork } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const CHILD = path.join(REPO_ROOT, 'scripts', 'runScenarioChild.js');

// options:
//   record      — force a recording (default false)
//   streamFrames— forward per-tick frames over IPC (default true; the CLI turns
//                 it off, since nothing reads them and they are the bulk of it)
//   onEvent     — called with every runner event, live
//
// The promise resolves with the child's verdict:
//   { endReason, ticks, damageTaken, survived, mods, recordingPath, test, exitCode }
// and rejects only when the run itself failed (a boot error, a mod that did not
// load, a crashed child) — a scenario whose expect() failed still RESOLVES,
// with test.passed === false, because that run happened and its recording is
// worth keeping.
function forkScenario(scenarioDir, options) {
	options = options || {};
	const onEvent = typeof options.onEvent === 'function' ? options.onEvent : function () {};
	const args = [scenarioDir];
	if (options.record === true) args.push('record');
	if (options.streamFrames === false) args.push('no-frames');

	const child = fork(CHILD, args, { cwd: REPO_ROOT, silent: false });
	let settled = false;
	let verdict = null;
	let failure = null;

	const promise = new Promise(function (resolve, reject) {
		function finish(code) {
			if (settled) return;
			settled = true;
			if (verdict) { verdict.exitCode = code; resolve(verdict); return; }
			const error = new Error(failure || ('run process exited (' + code + ')'));
			reject(error);
		}

		child.on('message', function (msg) {
			if (!msg) return;
			if (msg.ev) { try { onEvent(msg.ev); } catch (e) { /* a listener never breaks the run */ } }
			if (msg.done) {
				if (msg.result) verdict = msg.result;
				else if (msg.error) failure = msg.error;
			}
		});
		child.on('error', function (err) {
			failure = String((err && err.message) || err);
			try { onEvent({ type: 'fatal', error: failure }); } catch (e) { /* */ }
			finish(null);
		});
		child.on('exit', function (code) {
			// A child that died without saying anything (crash, OOM, SIGKILL) still
			// has to produce a terminal event, or a GUI subscriber waits forever.
			if (!verdict && !failure) {
				failure = 'run process exited (' + code + ')';
				try { onEvent({ type: 'fatal', error: failure }); } catch (e) { /* */ }
			}
			finish(code);
		});
	});

	return { child: child, promise: promise };
}

module.exports = { forkScenario: forkScenario, CHILD: CHILD };

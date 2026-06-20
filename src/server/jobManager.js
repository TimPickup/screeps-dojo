'use strict';

// Serializes scenario runs (one engine at a time) and fans their live events
// out to any number of SSE subscribers. Each run executes in a FORKED CHILD
// PROCESS (scripts/runScenarioChild.js) so every run gets a pristine engine —
// screeps-server-mockup keeps module-level singleton state, so reusing one
// process across runs leaks Memory/segments/storage between them. The child
// also renders each frame to SVG, so this module never imports the engine
// (keeps the server bootable on an empty volume).
//
// Memory: console/tick/start/end events are small and fully buffered; frames
// carry a rendered SVG, so only the LATEST frame is retained (live preview is
// current-state, not scrubbable — that's what recordings are for).
const path = require('path');
const { fork } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHILD = path.join(REPO_ROOT, 'scripts', 'runScenarioChild.js');

let active = null; // { jobId, kind, scenario, child, history, lastFrame, subscribers, done }
let counter = 0;

function broadcast(job, evt) {
	if (evt.type === 'frame') job.lastFrame = evt;
	else job.history.push(evt);
	for (const sink of job.subscribers) { try { sink(evt); } catch (e) { /* a dead sink never breaks the run */ } }
}

// kind: 'run' (streams frames for live preview) | 'test' (text only). `record`
// forces a recording. expect() always runs so recordings carry a PASS/FAIL badge.
function startJob(kind, scenarioDir, options) {
	options = options || {};
	if (active && !active.done) {
		const err = new Error('a run is already active');
		err.statusCode = 409;
		throw err;
	}
	counter += 1;
	const jobId = 'job-' + Date.now() + '-' + counter;
	const job = {
		jobId: jobId, kind: kind, scenario: path.basename(scenarioDir),
		child: null, history: [], lastFrame: null, subscribers: new Set(), done: false
	};
	active = job;

	const args = [scenarioDir, options.record === true ? 'record' : ''];
	const child = fork(CHILD, args, { cwd: REPO_ROOT, silent: false });
	job.child = child;

	child.on('message', function (msg) {
		if (!msg) return;
		if (msg.ev) {
			// the 'test' kind doesn't need frames; drop them to save IPC/memory
			if (msg.ev.type === 'frame' && kind === 'test') return;
			broadcast(job, msg.ev);
		}
		if (msg.done) job.done = true;
	});
	child.on('exit', function (code) {
		if (!job.done) {
			// child died without a clean end (crash/kill) — synthesize a terminal event
			broadcast(job, { type: 'fatal', error: 'run process exited (' + code + ')' });
			job.done = true;
		}
	});
	child.on('error', function (err) {
		broadcast(job, { type: 'fatal', error: String((err && err.message) || err) });
		job.done = true;
	});

	return { jobId: jobId };
}

function subscribe(jobId, sink) {
	if (!active || active.jobId !== jobId) { sink({ type: 'gone' }); return function () {}; }
	const job = active;
	for (const evt of job.history) sink(evt);
	if (job.lastFrame) sink(job.lastFrame);
	if (!job.done) job.subscribers.add(sink);
	return function () { job.subscribers.delete(sink); };
}

function abort(jobId) {
	if (active && active.jobId === jobId && !active.done && active.child) {
		try { active.child.send({ type: 'abort' }); } catch (e) { /* child may be gone */ }
		// hard stop if it doesn't honour the cooperative abort within the grace window
		const child = active.child;
		setTimeout(function () { try { child.kill('SIGKILL'); } catch (e) { /* already dead */ } }, 70000);
		return true;
	}
	return false;
}

function getActive() {
	if (!active || active.done) return null;
	return { jobId: active.jobId, kind: active.kind, scenario: active.scenario };
}

function _reset() { if (active && active.child) { try { active.child.kill('SIGKILL'); } catch (e) { /* */ } } active = null; }

module.exports = { startJob: startJob, subscribe: subscribe, abort: abort, getActive: getActive, _reset: _reset };

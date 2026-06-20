'use strict';

// Spawns the existing in-container renderer (src/render/renderCli.js — resvg +
// ffmpeg) as a child and streams its progress over SSE. Runs on its own slot
// (rendering doesn't need the engine, so it may overlap a sim). Built-ins only.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const renders = new Map(); // id -> { history, done, file, error, subscribers }
let counter = 0;

function broadcast(job, evt) {
	job.history.push(evt);
	for (const sink of job.subscribers) { try { sink(evt); } catch (e) { /* ignore */ } }
}

let activeRenderId = null;

// recordingJsonPath: absolute path to a recording.json. format: 'gif'|'mp4'.
function startRender(recordingJsonPath, format, opts) {
	opts = opts || {};
	// Serialize: resvg+ffmpeg renders are RAM/CPU/disk heavy, so never run two
	// at once (clicking GIF then MP4 would otherwise stack concurrent renders
	// and thrash the machine). Reject the second with a clear, retryable error.
	if (activeRenderId) {
		const job = renders.get(activeRenderId);
		if (job && !job.done) {
			const err = new Error('a render is already in progress — wait for it to finish');
			err.statusCode = 409;
			throw err;
		}
	}
	counter += 1;
	const id = 'render-' + Date.now() + '-' + counter;
	const dir = path.dirname(recordingJsonPath);
	const ext = format === 'gif' ? '.gif' : '.mp4';
	const outFile = path.join(dir, 'export' + ext);

	const args = ['src/render/renderCli.js', recordingJsonPath, '--out', outFile];
	if (format === 'gif') args.push('--gif');
	if (opts.fps) args.push('--fps', String(opts.fps));
	if (opts.pixels) args.push('--pixels', String(opts.pixels));

	const job = { id: id, history: [], done: false, file: null, error: null, subscribers: new Set() };
	renders.set(id, job);
	activeRenderId = id;

	const child = spawn('node', args, { cwd: REPO_ROOT });
	let buf = '';
	function onData(chunk) {
		buf += chunk.toString();
		let nl;
		while ((nl = buf.indexOf('\n')) !== -1) {
			const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
			if (line.trim()) broadcast(job, { type: 'log', line: line });
		}
	}
	child.stdout.on('data', onData);
	child.stderr.on('data', onData);
	child.on('close', function (code) {
		job.done = true;
		if (activeRenderId === id) activeRenderId = null;
		if (code === 0 && fs.existsSync(outFile)) {
			job.file = outFile;
			broadcast(job, { type: 'done', file: outFile });
		} else {
			job.error = 'render exited ' + code;
			broadcast(job, { type: 'failed', error: job.error });
		}
	});
	child.on('error', function (err) {
		job.done = true; job.error = String(err.message || err);
		if (activeRenderId === id) activeRenderId = null;
		broadcast(job, { type: 'failed', error: job.error });
	});

	return { id: id };
}

function subscribe(id, sink) {
	const job = renders.get(id);
	if (!job) { sink({ type: 'failed', error: 'no such render' }); return function () {}; }
	for (const evt of job.history) sink(evt);
	if (!job.done) job.subscribers.add(sink);
	return function () { job.subscribers.delete(sink); };
}

module.exports = { startRender: startRender, subscribe: subscribe };

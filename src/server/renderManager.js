'use strict';

// Spawns the in-container Canvas2D + FFmpeg renderer as a child and streams its
// progress over SSE. Runs on its own slot
// (rendering doesn't need the engine, so it may overlap a sim). Built-ins only.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { parseProgress } = require('../render/progressProtocol');

const REPO_ROOT = path.join(__dirname, '..', '..');
const renders = new Map(); // id -> render job state
let counter = 0;

function broadcast(job, evt) {
	job.history.push(evt);
	for (const sink of job.subscribers) { try { sink(evt); } catch (e) { /* ignore */ } }
}

function cleanupCancelledJob(job) {
	if (job.pendingFile) {
		try { fs.rmSync(job.pendingFile, { force: true }); } catch (error) { /* best effort */ }
	}
	if (!job.workPrefix) return;
	let entries;
	try { entries = fs.readdirSync(os.tmpdir(), { withFileTypes: true }); } catch (error) { return; }
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith(job.workPrefix)) continue;
		try { fs.rmSync(path.join(os.tmpdir(), entry.name), { recursive: true, force: true }); }
		catch (error) { /* best effort after hard cancellation */ }
	}
}

let activeRenderId = null;

// recordingJsonPath: absolute path to a recording.json. format: 'gif'|'mp4'.
function startRender(recordingJsonPath, format, opts) {
	opts = opts || {};
	// Serialize: Canvas2D + FFmpeg renders are RAM/CPU heavy, so never run two
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
	if (opts.speed) args.push('--speed', String(opts.speed));
	if (opts.pixels) args.push('--pixels', String(opts.pixels));

	const job = {
		id: id, history: [], done: false, file: null, error: null,
		subscribers: new Set(), child: null, cancelRequested: false, killTimer: null
	};
	renders.set(id, job);
	activeRenderId = id;

	const child = spawn('node', args, { cwd: REPO_ROOT });
	job.child = child;
	job.pendingFile = path.join(dir, '.' + path.basename(outFile, ext) + '.partial-' + child.pid + ext);
	job.workPrefix = 'dojo-render-' + child.pid + '-';
	let buf = '';
	function onData(chunk) {
		buf += chunk.toString();
		let nl;
		while ((nl = buf.indexOf('\n')) !== -1) {
			const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
			if (!line.trim()) continue;
			const progress = parseProgress(line.trim());
			if (progress) broadcast(job, Object.assign({ type: 'progress' }, progress));
			else broadcast(job, { type: 'log', line: line });
		}
	}
	child.stdout.on('data', onData);
	child.stderr.on('data', onData);
	child.on('close', function (code) {
		if (job.done) return;
		job.done = true;
		if (job.killTimer) clearTimeout(job.killTimer);
		if (activeRenderId === id) activeRenderId = null;
		if (job.cancelRequested) {
			cleanupCancelledJob(job);
			broadcast(job, { type: 'cancelled' });
		} else if (code === 0 && fs.existsSync(outFile)) {
			job.file = outFile;
			broadcast(job, { type: 'done', file: outFile });
		} else {
			job.error = 'render exited ' + code;
			broadcast(job, { type: 'failed', error: job.error });
		}
	});
	child.on('error', function (err) {
		if (job.done) return;
		job.done = true; job.error = String(err.message || err);
		if (job.killTimer) clearTimeout(job.killTimer);
		if (activeRenderId === id) activeRenderId = null;
		if (job.cancelRequested) cleanupCancelledJob(job);
		broadcast(job, job.cancelRequested ? { type: 'cancelled' } : { type: 'failed', error: job.error });
	});

	return { id: id };
}

function cancelRender(id) {
	const job = renders.get(id);
	if (!job) {
		const err = new Error('no such render');
		err.statusCode = 404;
		throw err;
	}
	if (job.done || job.cancelRequested) return { ok: true };
	job.cancelRequested = true;
	broadcast(job, { type: 'cancelling' });
	if (job.child) job.child.kill('SIGTERM');
	// The CLI handles SIGTERM through AbortController and normally cleans up in
	// milliseconds. A hard-stop fallback prevents a wedged encoder from making
	// Cancel cosmetic; partial output is also removed by the manager below.
	job.killTimer = setTimeout(function () {
		if (!job.done && job.child) job.child.kill('SIGKILL');
	}, 5000);
	if (job.killTimer.unref) job.killTimer.unref();
	return { ok: true };
}

function subscribe(id, sink) {
	const job = renders.get(id);
	if (!job) { sink({ type: 'failed', error: 'no such render' }); return function () {}; }
	for (const evt of job.history) sink(evt);
	if (!job.done) job.subscribers.add(sink);
	return function () { job.subscribers.delete(sink); };
}

module.exports = { startRender: startRender, cancelRender: cancelRender, subscribe: subscribe };

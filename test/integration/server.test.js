'use strict';

// Boots the GUI server in-process on an ephemeral port and exercises the
// Phase-1 routes end to end, including a live SSE run of the tiny fixture.
const assert = require('assert');
const http = require('http');
const path = require('path');
const { createServer } = require('../../src/server');
const jobManager = require('../../src/server/jobManager');

const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');

function get(port, p) {
	return new Promise(function (resolve, reject) {
		http.get({ host: '127.0.0.1', port: port, path: p }, function (res) {
			let body = '';
			res.on('data', function (c) { body += c; });
			res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
		}).on('error', reject);
	});
}

function post(port, p, obj) {
	return new Promise(function (resolve, reject) {
		const data = JSON.stringify(obj || {});
		const req = http.request({ host: '127.0.0.1', port: port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, function (res) {
			let body = '';
			res.on('data', function (c) { body += c; });
			res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
		});
		req.on('error', reject);
		req.write(data);
		req.end();
	});
}

// Collects SSE events until an `end` event arrives.
function streamUntilEnd(port, jobId, timeoutMs) {
	return new Promise(function (resolve, reject) {
		const events = [];
		const req = http.get({ host: '127.0.0.1', port: port, path: '/api/jobs/' + jobId + '/stream' }, function (res) {
			let buf = '';
			res.on('data', function (c) {
				buf += c;
				let idx;
				while ((idx = buf.indexOf('\n\n')) !== -1) {
					const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
					const m = /event: (\w+)\ndata: ([\s\S]*)/.exec(block);
					if (m) {
						events.push(m[1]);
						if (m[1] === 'end' || m[1] === 'fatal') { req.destroy(); resolve(events); return; }
					}
				}
			});
		});
		req.on('error', function () { resolve(events); });
		setTimeout(function () { req.destroy(); reject(new Error('stream timeout; got ' + events.join(','))); }, timeoutMs);
	});
}

describe('GUI server (Phase 1)', function () {
	this.timeout(0);
	let server, port;
	before(function (done) {
		jobManager._reset();
		server = createServer({ scenariosRoot: FIXTURES_ROOT });
		server.listen(0, '127.0.0.1', function () { port = server.address().port; done(); });
	});
	after(function (done) { server.close(function () { done(); }); });

	it('GET /api/health → ok', async function () {
		const r = await get(port, '/api/health');
		assert.strictEqual(r.status, 200);
		assert.deepStrictEqual(JSON.parse(r.body), { ok: true, ready: true });
	});

	it('GET /api/scenarios lists the tiny fixture', async function () {
		const r = await get(port, '/api/scenarios');
		const list = JSON.parse(r.body);
		const tiny = list.find(function (s) { return s.name === 'tiny-scenario'; });
		assert.ok(tiny, 'tiny-scenario listed');
		assert.ok(tiny.files.includes('scenario.js'));
	});

	it('POST /api/run streams to an end event', async function () {
		const r = await post(port, '/api/run', { scenario: 'tiny-scenario' });
		assert.strictEqual(r.status, 200);
		const jobId = JSON.parse(r.body).jobId;
		assert.ok(jobId);
		const events = await streamUntilEnd(port, jobId, 60000);
		assert.ok(events.includes('start'));
		assert.ok(events.includes('tick'));
		assert.ok(events.includes('frame'));
		assert.ok(events.includes('end'));
	});

	it('POST /api/test runs expect and ends', async function () {
		jobManager._reset();
		const r = await post(port, '/api/test', { scenario: 'tiny-scenario' });
		const jobId = JSON.parse(r.body).jobId;
		const events = await streamUntilEnd(port, jobId, 60000);
		assert.ok(events.includes('end'));
	});

	it('POST /api/run rejects unknown scenario', async function () {
		const r = await post(port, '/api/run', { scenario: 'does-not-exist' });
		assert.strictEqual(r.status, 404);
	});

	it('rejects path traversal on recordings/file', async function () {
		const r = await get(port, '/api/recordings/file?path=' + encodeURIComponent('../../etc/passwd'));
		assert.strictEqual(r.status, 400);
	});
});

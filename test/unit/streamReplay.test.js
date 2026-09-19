'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const streamReplay = require('../../src/server/streamReplay');
const { createRouter } = require('../../src/server/router');
const registerRecordingRoutes = require('../../src/server/routes/recordings');

describe('paced replay reads', function () {
	let dir, file;
	beforeEach(function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-stream-'));
		file = path.join(dir, 'recording.json');
		fs.writeFileSync(file, Buffer.alloc(3 * 64 * 1024, 42));
	});
	afterEach(function () { fs.unlinkSync(file); fs.rmdirSync(dir); });

	it('sends the burst first and paces remaining bytes without altering them', async function () {
		const chunks = [], times = [];
		const res = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); times.push(Date.now()); done(); } });
		await streamReplay(file, res, { burst: 64 * 1024, bytesPerSecond: 640 * 1024 });
		assert.deepStrictEqual(Buffer.concat(chunks), fs.readFileSync(file));
		assert(times[1] - times[0] >= 80, 'second chunk should be paced');
		assert(times[2] - times[1] >= 80, 'third chunk should be paced');
	});

	it('cancels a pending paced read when the response closes', async function () {
		let chunks = 0;
		const res = new Writable({ write(chunk, encoding, done) { chunks++; done(); setTimeout(() => res.destroy(), 10); } });
		const start = Date.now();
		await assert.rejects(streamReplay(file, res, { burst: 64 * 1024, bytesPerSecond: 64 }), /abort|close/i);
		assert.strictEqual(chunks, 1);
		assert(Date.now() - start < 1000, 'should cancel rather than wait for the throttle');
	});

	it('lifts the throttle for a pending seek and restores it after catching up', async function () {
		let urgent = false;
		const times = [], chunks = [];
		const res = new Writable({ write(chunk, encoding, done) {
			times.push(Date.now());
			chunks.push(chunk);
			urgent = chunks.length === 1;
			done();
		} });
		await streamReplay(file, res, { burst: 64 * 1024, bytesPerSecond: 128 * 1024, isUrgent: () => urgent });
		assert.deepStrictEqual(Buffer.concat(chunks), fs.readFileSync(file));
		assert(times[1] - times[0] < 350, 'urgent chunk should bypass the 500ms throttle');
		assert(times[2] - times[1] >= 450, 'background loading should be paced again');
	});

	it('scopes priority controls to an open stream and removes them on close', async function () {
		const router = createRouter();
		registerRecordingRoutes(router, {
			recordingsRoot: dir,
			sendJson(res, status, body) { res.status = status; res.body = body; }
		});
		const open = () => {
			const res = new Writable({ write(chunk, encoding, done) { done(); } });
			res.writeHead = (status, headers) => { res.headers = headers; };
			const closed = new Promise(resolve => res.once('close', resolve));
			router.match('GET', '/api/recordings/file').handler({ query: new URLSearchParams('path=recording.json&progressive=1') }, res);
			return { id: res.headers['X-Replay-Stream'], closed };
		};
		const priority = (id, urgent) => {
			const match = router.match('POST', '/api/recordings/streams/' + id + '/priority');
			const reply = {};
			match.handler({ params: match.params, body: { urgent } }, reply);
			return reply.status;
		};
		const first = open(), second = open();
		assert.notStrictEqual(first.id, second.id);
		assert.strictEqual(priority(first.id, true), 200);
		assert.strictEqual(priority(second.id, false), 200);
		assert.strictEqual(priority(first.id, 'true'), 400);
		await Promise.all([first.closed, second.closed]);
		assert.strictEqual(priority(first.id, false), 404);
		assert.strictEqual(priority(second.id, true), 404);
	});
});

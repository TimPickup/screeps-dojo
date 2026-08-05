'use strict';

// Boots the GUI server in-process on an ephemeral port and exercises the
// Phase-1 routes end to end, including a live SSE run of the tiny fixture.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createServer } = require('../../src/server');
const { _clearRecordingCache } = require('../../src/recording');
const jobManager = require('../../src/server/jobManager');

const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');

function get(port, p, headers) {
	return new Promise(function (resolve, reject) {
		http.get({ host: '127.0.0.1', port: port, path: p, headers: headers || {} }, function (res) {
			let body = '';
			res.on('data', function (c) { body += c; });
			res.on('end', function () { resolve({ status: res.statusCode, body: body, headers: res.headers }); });
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

function put(port, p, obj) {
	return new Promise(function (resolve, reject) {
		const data = JSON.stringify(obj || {});
		const req = http.request({ host: '127.0.0.1', port: port, path: p, method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, function (res) {
			let body = '';
			res.on('data', function (c) { body += c; });
			res.on('end', function () { resolve({ status: res.statusCode, body: body, headers: res.headers }); });
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
		events.payloads = [];
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
						try { events.payloads.push(JSON.parse(m[2])); } catch (e) { /* malformed data is tested elsewhere */ }
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

	it('serves the exact Canvas render font faces', async function () {
		const regular = await get(port, '/api/render/font?weight=400');
		const bold = await get(port, '/api/render/font?weight=700');
		assert.strictEqual(regular.status, 200);
		assert.strictEqual(bold.status, 200);
		assert.strictEqual(regular.headers['content-type'], 'font/ttf');
		assert.ok(Number(regular.headers['content-length']) > 100000);
		assert.ok(Number(bold.headers['content-length']) > 100000);
	});

	it('rejects cancellation of an unknown render', async function () {
		const r = await post(port, '/api/render/not-a-render/cancel', {});
		assert.strictEqual(r.status, 404);
	});

	it('rejects an invalid export speed', async function () {
		const r = await post(port, '/api/render', { path: 'missing/recording.json', format: 'gif', speed: 0 });
		assert.strictEqual(r.status, 400);
		assert.match(JSON.parse(r.body).error, /speed must be a positive number/);
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
		const terrain = events.payloads.find(function (event) { return event.type === 'terrain'; });
		const frame = events.payloads.find(function (event) { return event.type === 'frame'; });
		assert.ok(terrain && terrain.terrain && Object.keys(terrain.terrain).length > 0);
		assert.ok(frame && frame.frame && Array.isArray(frame.frame.objects));
		assert.strictEqual(Object.prototype.hasOwnProperty.call(frame, 'svg'), false);
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

describe('GET /api/scenarios', function () {
	this.timeout(0);
	let server, port, scenariosRoot;

	before(function (done) {
		scenariosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-srv-scn-'));
		const mk = function (name, files) {
			const dir = path.join(scenariosRoot, name);
			fs.mkdirSync(dir, { recursive: true });
			for (const f of files) fs.writeFileSync(path.join(dir, f), '// ' + f);
			return dir;
		};
		mk('with-map', ['scenario.js', 'main.js', 'map.json']);
		mk('no-map', ['scenario.js', 'main.js']);
		mk('not-a-scenario', ['readme.txt']);           // no scenario.js → not listed
		const dotted = mk('dotfiles', ['scenario.js', '.hidden']);
		fs.mkdirSync(path.join(dotted, 'nested'));       // nested dirs are not files
		fs.writeFileSync(path.join(dotted, 'nested', 'inner.js'), '//');
		server = createServer({ scenariosRoot: scenariosRoot });
		server.listen(0, '127.0.0.1', function () { port = server.address().port; done(); });
	});
	after(function (done) {
		fs.rmSync(scenariosRoot, { recursive: true, force: true });
		server.close(function () { done(); });
	});

	const listed = async function (port) {
		const r = await get(port, '/api/scenarios');
		assert.strictEqual(r.status, 200);
		return JSON.parse(r.body);
	};

	it('lists only directories holding a scenario.js, sorted', async function () {
		const names = (await listed(port)).map(function (s) { return s.name; });
		assert.deepStrictEqual(names, ['dotfiles', 'no-map', 'with-map']);
	});

	it('flags which scenarios ship a map', async function () {
		const list = await listed(port);
		assert.strictEqual(list.find(function (s) { return s.name === 'with-map'; }).hasMap, true);
		assert.strictEqual(list.find(function (s) { return s.name === 'no-map'; }).hasMap, false);
	});

	it('returns each scenario’s top-level files, sorted, without dotfiles or subdirectories', async function () {
		const list = await listed(port);
		assert.deepStrictEqual(list.find(function (s) { return s.name === 'with-map'; }).files, ['main.js', 'map.json', 'scenario.js']);
		assert.deepStrictEqual(list.find(function (s) { return s.name === 'dotfiles'; }).files, ['scenario.js']);
	});

	// Reporting an unreadable directory as "no scenarios" would send the user to
	// copy files from examples/ when the real problem is permissions.
	it('reports a filesystem failure as a 500, not as an empty list', async function () {
		const real = fs.readdirSync;
		fs.readdirSync = function () { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; };
		let r;
		try { r = await get(port, '/api/scenarios'); } finally { fs.readdirSync = real; }
		assert.strictEqual(r.status, 500);
		assert.match(JSON.parse(r.body).error, /EACCES/);
	});

	it('still reports an absent scenarios directory as an empty list', async function () {
		const gone = path.join(scenariosRoot, 'definitely-not-here');
		const srv = createServer({ scenariosRoot: gone });
		await new Promise(function (done) { srv.listen(0, '127.0.0.1', done); });
		try {
			const r = await get(srv.address().port, '/api/scenarios');
			assert.strictEqual(r.status, 200);
			assert.deepStrictEqual(JSON.parse(r.body), []);
		} finally {
			await new Promise(function (done) { srv.close(done); });
		}
	});

	// statSync follows symlinks; a directory listing reports the link itself. A
	// scenario symlinked in from elsewhere has to keep working.
	it('follows a symlinked scenario directory and symlinked files inside it', async function () {
		const real = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-real-scn-'));
		try {
			fs.writeFileSync(path.join(real, 'scenario.js'), '//');
			fs.writeFileSync(path.join(real, 'map.json'), '{}');
			try {
				fs.symlinkSync(real, path.join(scenariosRoot, 'linked'), 'dir');
				fs.symlinkSync(path.join(real, 'map.json'), path.join(scenariosRoot, 'with-map', 'linked-map.json'), 'file');
			} catch (e) {
				this.skip(); // no symlink privilege on this platform
				return;
			}
			const list = await listed(port);
			const linked = list.find(function (s) { return s.name === 'linked'; });
			assert.ok(linked, 'symlinked scenario directory is listed');
			assert.strictEqual(linked.hasMap, true);
			const withMap = list.find(function (s) { return s.name === 'with-map'; });
			assert.ok(withMap.files.includes('linked-map.json'), 'symlinked file is listed');
		} finally {
			fs.rmSync(path.join(scenariosRoot, 'linked'), { force: true });
			fs.rmSync(path.join(scenariosRoot, 'with-map', 'linked-map.json'), { force: true });
			fs.rmSync(real, { recursive: true, force: true });
		}
	});
});

describe('GET /api/scenarios/:name/maps', function () {
	let server, port, scenariosRoot;

	before(function (done) {
		scenariosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-srv-maps-'));
		const dir = path.join(scenariosRoot, 'preview');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'scenario.js'), '// scenario');
		fs.writeFileSync(path.join(dir, 'map.W1N1.json'), JSON.stringify({ room: 'W1N1', terrain: ['.'] }));
		fs.writeFileSync(path.join(dir, 'map.W0N1.json'), JSON.stringify({ room: 'W0N1', terrain: ['#'] }));
		fs.writeFileSync(path.join(dir, 'map.broken.json'), '{ nope');
		fs.writeFileSync(path.join(dir, 'memory.json'), '{}');
		server = createServer({ scenariosRoot: scenariosRoot });
		server.listen(0, '127.0.0.1', function () { port = server.address().port; done(); });
	});

	after(function (done) {
		fs.rmSync(scenariosRoot, { recursive: true, force: true });
		server.close(function () { done(); });
	});

	it('returns every valid map in one request, sorted, while reporting malformed files', async function () {
		const r = await get(port, '/api/scenarios/preview/maps');
		assert.strictEqual(r.status, 200);
		const body = JSON.parse(r.body);
		assert.deepStrictEqual(body.maps.map(function (entry) { return entry.path; }), ['map.W0N1.json', 'map.W1N1.json']);
		assert.deepStrictEqual(body.maps.map(function (entry) { return entry.map.room; }), ['W0N1', 'W1N1']);
		assert.strictEqual(body.errors.length, 1);
		assert.strictEqual(body.errors[0].path, 'map.broken.json');
		assert.match(body.revision, /^[a-f0-9]{40}$/);
		assert.strictEqual(r.headers.etag, '"' + body.revision + '"');
		// A warm request is served entirely from memory. This matters on Docker
		// bind mounts: even stat/readdir calls are expensive there.
		const realReadDir = fs.readdirSync;
		const realReadFile = fs.readFileSync;
		fs.readdirSync = function () { throw new Error('warm cache must not scan'); };
		fs.readFileSync = function () { throw new Error('warm cache must not read'); };
		let cached;
		try { cached = await get(port, '/api/scenarios/preview/maps', { 'If-None-Match': r.headers.etag }); }
		finally { fs.readdirSync = realReadDir; fs.readFileSync = realReadFile; }
		assert.strictEqual(cached.status, 304);
		assert.strictEqual(cached.body, '');

		// Writes through the editor API invalidate synchronously, so the next
		// preview cannot race an fs.watch notification.
		const saved = await put(port, '/api/scenarios/preview/file?path=map.W1N1.json', {
			content: JSON.stringify({ room: 'W1N1', terrain: ['.'], changed: true })
		});
		assert.strictEqual(saved.status, 200);
		const changed = await get(port, '/api/scenarios/preview/maps', { 'If-None-Match': r.headers.etag });
		assert.strictEqual(changed.status, 200);
		assert.notStrictEqual(changed.headers.etag, r.headers.etag);
	});

	it('returns 404 for an unknown scenario', async function () {
		const r = await get(port, '/api/scenarios/missing/maps');
		assert.strictEqual(r.status, 404);
	});
});

describe('GET /api/recordings', function () {
	this.timeout(0);
	let server, port, recordingsRoot;

	function makeRecording(scenario, ts, meta) {
		const dir = path.join(recordingsRoot, scenario, ts);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
		fs.writeFileSync(path.join(dir, 'recording.json'), JSON.stringify({ meta: meta, terrain: {}, frames: [] }));
	}

	before(function (done) {
		_clearRecordingCache();
		recordingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-srv-rec-'));
		makeRecording('alpha', '20260619-120000', { scenario: 'alpha', endReason: 'until', ticks: 12 });
		makeRecording('beta', '20260619-130000', { scenario: 'beta', endReason: 'botDied', ticks: 40 });
		makeRecording('beta', '20260619-140000', { scenario: 'beta', endReason: 'maxTicks', ticks: 99 });
		server = createServer({ scenariosRoot: FIXTURES_ROOT, recordingsRoot: recordingsRoot });
		server.listen(0, '127.0.0.1', function () { port = server.address().port; done(); });
	});
	after(function (done) {
		fs.rmSync(recordingsRoot, { recursive: true, force: true });
		_clearRecordingCache();
		server.close(function () { done(); });
	});

	it('lists every recording when no scenario is given', async function () {
		const r = await get(port, '/api/recordings');
		assert.strictEqual(r.status, 200);
		const list = JSON.parse(r.body);
		assert.strictEqual(list.length, 3);
		assert.strictEqual(list[0].timestamp, '20260619-140000', 'newest first');
	});

	it('returns only the named scenario when ?scenario= is given', async function () {
		const r = await get(port, '/api/recordings?scenario=beta');
		assert.strictEqual(r.status, 200);
		const list = JSON.parse(r.body);
		assert.strictEqual(list.length, 2);
		assert.ok(list.every(function (e) { return e.scenario === 'beta'; }));
	});

	it('carries status, ticks and a posix relPath', async function () {
		const list = JSON.parse((await get(port, '/api/recordings?scenario=alpha')).body);
		assert.strictEqual(list[0].status, 'until');
		assert.strictEqual(list[0].ticks, 12);
		assert.strictEqual(list[0].relPath, 'alpha/20260619-120000/recording.json');
	});

	it('returns [] for a scenario with no recordings', async function () {
		const r = await get(port, '/api/recordings?scenario=nosuchscenario');
		assert.strictEqual(r.status, 200);
		assert.deepStrictEqual(JSON.parse(r.body), []);
	});

	// The filter names a directory, so every traversal shape must be refused
	// before it reaches the filesystem.
	it('rejects a traversal or otherwise invalid scenario filter', async function () {
		// note: a literal '\0' here, so the query really carries a null byte —
		// the string 'a%00b' would arrive as five harmless characters.
		const evil = ['../../etc', '..', '.', 'a/b', 'a\\b', '/etc/passwd', '', 'a\0b'];
		for (const s of evil) {
			const r = await get(port, '/api/recordings?scenario=' + encodeURIComponent(s));
			assert.strictEqual(r.status, 400, 'must reject ' + JSON.stringify(s) + ', got ' + r.status);
			assert.match(JSON.parse(r.body).error, /invalid scenario name/);
		}
	});

	// A scenario the list will happily show must not 400 on its Replays tab.
	it('accepts scenario names the scenario list would show', async function () {
		for (const odd of ['my scenario', 'v1.2', '_scratch', '-tmp']) {
			makeRecording(odd, '20260101-000000', { scenario: odd, endReason: 'until', ticks: 5 });
			const r = await get(port, '/api/recordings?scenario=' + encodeURIComponent(odd));
			assert.strictEqual(r.status, 200, 'must accept ' + JSON.stringify(odd) + ', got ' + r.status);
			const list = JSON.parse(r.body);
			assert.strictEqual(list.length, 1);
			assert.strictEqual(list[0].scenario, odd);
		}
	});

	it('reports a filesystem failure as a 500, not as an empty list', async function () {
		const real = fs.readdirSync;
		fs.readdirSync = function () { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; };
		let r;
		try { r = await get(port, '/api/recordings'); } finally { fs.readdirSync = real; }
		assert.strictEqual(r.status, 500);
		assert.match(JSON.parse(r.body).error, /EACCES/);
	});

	it('does not leak recordings from outside the root', async function () {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-outside-'));
		try {
			fs.mkdirSync(path.join(outside, 'secret', '20260619-000000'), { recursive: true });
			fs.writeFileSync(path.join(outside, 'secret', '20260619-000000', 'recording.json'), '{}');
			const rel = path.relative(recordingsRoot, path.join(outside)).split(path.sep).join('/') + '/secret';
			const r = await get(port, '/api/recordings?scenario=' + encodeURIComponent(rel));
			assert.strictEqual(r.status, 400);
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});
});

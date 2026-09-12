'use strict';

// The scenario tree and the operations the GUI's list view performs on it:
// create/rename/move/delete for both scenarios and folders. These are the only
// routes in the app that DESTROY user work, so the guards — the traversal
// checks, the non-empty-folder refusal, the "into its own subtree" refusal —
// are what this file is really here for.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createServer } = require('../../src/server');

function request(port, method, p, obj) {
	return new Promise(function (resolve, reject) {
		const data = obj === undefined ? null : JSON.stringify(obj);
		const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
		const req = http.request({ host: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
			let body = '';
			res.on('data', function (c) { body += c; });
			res.on('end', function () {
				let parsed = null;
				try { parsed = JSON.parse(body); } catch (e) { /* non-JSON */ }
				resolve({ status: res.statusCode, body: parsed, raw: body });
			});
		});
		req.on('error', reject);
		if (data) req.write(data);
		req.end();
	});
}

const get = function (port, p) { return request(port, 'GET', p); };
const post = function (port, p, obj) { return request(port, 'POST', p, obj || {}); };
const del = function (port, p) { return request(port, 'DELETE', p); };

describe('scenario tree management', function () {
	this.timeout(0);
	let server, port, root;

	function scenarioAt(relPath, extra) {
		const dir = path.join(root, relPath.split('/').join(path.sep));
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'scenario.js'), '// scenario');
		for (const f of extra || []) fs.writeFileSync(path.join(dir, f), '{}');
		return dir;
	}

	function recordingIn(relPath, ts) {
		const dir = path.join(root, relPath.split('/').join(path.sep), 'recordings', ts);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'recording.json'), '{}');
		return dir;
	}

	beforeEach(function (done) {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-tree-'));
		server = createServer({ scenariosRoot: root });
		server.listen(0, '127.0.0.1', function () { port = server.address().port; done(); });
	});
	afterEach(function (done) {
		fs.rmSync(root, { recursive: true, force: true });
		server.close(function () { done(); });
	});

	describe('GET /api/scenario-tree', function () {
		it('reports folders and scenarios as paths, at every depth', async function () {
			scenarioAt('top', ['map.json']);
			scenarioAt('Benches/inner/deep');
			fs.mkdirSync(path.join(root, 'Empty Folder'), { recursive: true });

			const r = await get(port, '/api/scenario-tree');
			assert.strictEqual(r.status, 200);
			assert.deepStrictEqual(r.body.scenarios.map(function (s) { return s.path; }), ['Benches/inner/deep', 'top']);
			assert.deepStrictEqual(r.body.folders.map(function (f) { return f.path; }).sort(),
				['Benches', 'Benches/inner', 'Empty Folder']);
			const top = r.body.scenarios.find(function (s) { return s.path === 'top'; });
			assert.strictEqual(top.name, 'top');
			assert.strictEqual(top.hasMap, true);
		});

		// A scenario is a leaf: whatever is inside it is its own business, and
		// its recordings/ must never read as a folder of the workspace.
		it('never descends into a scenario, so its recordings are not folders', async function () {
			scenarioAt('solo');
			recordingIn('solo', '20260101-000000');
			fs.mkdirSync(path.join(root, 'solo', 'whatever'), { recursive: true });

			const r = await get(port, '/api/scenario-tree');
			assert.deepStrictEqual(r.body.folders, []);
			assert.deepStrictEqual(r.body.scenarios.map(function (s) { return s.path; }), ['solo']);
			// ...and the file list the Edit tab shows holds no directories either
			const files = await get(port, '/api/scenarios/solo/files');
			assert.deepStrictEqual(files.body.map(function (f) { return f.path; }), ['scenario.js']);
		});
	});

	describe('creating', function () {
		it('creates a scenario inside a folder', async function () {
			await post(port, '/api/scenario-folders', { name: 'Season 11' });
			const r = await post(port, '/api/scenarios', { name: 'phase4', parent: 'Season 11' });
			assert.strictEqual(r.status, 200);
			assert.strictEqual(r.body.path, 'Season 11/phase4');
			assert.ok(fs.existsSync(path.join(root, 'Season 11', 'phase4', 'scenario.js')));
		});

		it('refuses a name that collides, and one that is reserved', async function () {
			await post(port, '/api/scenario-folders', { name: 'Bench' });
			assert.strictEqual((await post(port, '/api/scenario-folders', { name: 'Bench' })).status, 409);
			const reserved = await post(port, '/api/scenario-folders', { name: 'recordings' });
			assert.strictEqual(reserved.status, 400);
			assert.match(reserved.body.error, /reserved/);
		});

		it('refuses a parent that is a scenario, not a folder', async function () {
			scenarioAt('leaf');
			const r = await post(port, '/api/scenario-folders', { name: 'nope', parent: 'leaf' });
			assert.strictEqual(r.status, 400);
			assert.match(r.body.error, /not a folder/);
		});

		it('refuses a parent that escapes the root', async function () {
			const r = await post(port, '/api/scenarios', { name: 'x', parent: '../../elsewhere' });
			assert.strictEqual(r.status, 400);
		});
	});

	describe('templates', function () {
		it('offers Basic, Blank and every example', async function () {
			const r = await get(port, '/api/scenario-templates');
			assert.strictEqual(r.status, 200);
			const ids = r.body.templates.map(function (t) { return t.id; });
			assert.deepStrictEqual(ids.slice(0, 2), ['basic', 'blank'], 'built-ins first');
			assert.ok(ids.includes('example:walk-to-flag'), 'examples/ is offered too');
			// Every entry carries what the picker renders.
			for (const t of r.body.templates) {
				assert.ok(t.name, t.id + ' needs a name');
				assert.ok(t.group, t.id + ' needs a group heading');
				assert.ok(t.description, t.id + ' needs a description');
			}
		});

		it('creates from Blank: scenario.js alone, with the name filled in', async function () {
			const r = await post(port, '/api/scenarios', { name: 'empty-one', template: 'blank' });
			assert.strictEqual(r.status, 200);
			const files = fs.readdirSync(path.join(root, 'empty-one'));
			assert.deepStrictEqual(files, ['scenario.js']);
			const text = fs.readFileSync(path.join(root, 'empty-one', 'scenario.js'), 'utf8');
			assert.ok(text.includes('Scenario: empty-one'), 'the name is substituted into the header');
			assert.ok(!text.includes('__SCENARIO_NAME__'), 'no placeholder left behind');
		});

		it('creates from an example, copying its settings.json', async function () {
			const r = await post(port, '/api/scenarios', { name: 'my-reactor', template: 'example:season5-reactor' });
			assert.strictEqual(r.status, 200);
			const files = fs.readdirSync(path.join(root, 'my-reactor')).sort();
			assert.deepStrictEqual(files, ['main.js', 'map.json', 'scenario.js', 'settings.json']);
			const settings = JSON.parse(fs.readFileSync(path.join(root, 'my-reactor', 'settings.json'), 'utf8'));
			assert.deepStrictEqual(settings.mods, ['season5'], 'the mod selection has to come across or it will not run');
		});

		it('defaults to Basic and refuses an unknown or crafted template id', async function () {
			assert.strictEqual((await post(port, '/api/scenarios', { name: 'defaulted' })).status, 200);
			assert.ok(fs.existsSync(path.join(root, 'defaulted', 'map.W1N1.json')), 'Basic ships maps');

			for (const evil of ['nope', 'example:../../src', 'example:', 'example:.']) {
				const r = await post(port, '/api/scenarios', { name: 'bad-' + Math.random().toString(36).slice(2), template: evil });
				assert.strictEqual(r.status, 400, 'must refuse ' + JSON.stringify(evil) + ', got ' + r.status);
			}
		});

		// Your own scenarios are the starting points that actually get reused,
		// so they are offered too — as a separate list, keyed by path.
		it('offers the user\'s own scenarios to duplicate', async function () {
			scenarioAt('Benches/rampart', ['map.json']);
			scenarioAt('plain');
			const r = await get(port, '/api/scenario-templates');
			const ids = r.body.scenarios.map(function (s) { return s.id; });
			assert.deepStrictEqual(ids.sort(), ['scenario:Benches/rampart', 'scenario:plain']);
			const nested = r.body.scenarios.find(function (s) { return s.id === 'scenario:Benches/rampart'; });
			assert.strictEqual(nested.name, 'rampart');
			assert.strictEqual(nested.group, 'Benches', 'the folder becomes the optgroup heading');
		});

		it('duplicates an existing scenario without its replays', async function () {
			scenarioAt('original', ['map.json', 'settings.json']);
			recordingIn('original', '20260101-000000');
			const r = await post(port, '/api/scenarios', { name: 'copy', template: 'scenario:original' });
			assert.strictEqual(r.status, 200);
			const files = fs.readdirSync(path.join(root, 'copy')).sort();
			assert.deepStrictEqual(files, ['map.json', 'scenario.js', 'settings.json']);
			assert.ok(!fs.existsSync(path.join(root, 'copy', 'recordings')),
				'a duplicate starts with no replay history of its own');
		});

		it('refuses a scenario: id that escapes the workspace or names a folder', async function () {
			scenarioAt('Box/inner');
			for (const evil of ['scenario:../../src', 'scenario:Box', 'scenario:nope', 'scenario:']) {
				const r = await post(port, '/api/scenarios', { name: 'x-' + Math.random().toString(36).slice(2), template: evil });
				assert.strictEqual(r.status, 400, 'must refuse ' + JSON.stringify(evil) + ', got ' + r.status);
			}
		});

		// An example that has picked up a recordings/ from a test run must not
		// drag hundreds of megabytes into every copy of it.
		it('copies files only, never a directory inside the template', async function () {
			const probe = path.join(__dirname, '..', '..', 'examples', 'walk-to-flag', 'recordings', 'probe');
			fs.mkdirSync(probe, { recursive: true });
			try {
				const r = await post(port, '/api/scenarios', { name: 'copied', template: 'example:walk-to-flag' });
				assert.strictEqual(r.status, 200);
				assert.ok(!fs.existsSync(path.join(root, 'copied', 'recordings')), 'recordings/ must not be copied');
			} finally {
				fs.rmSync(path.join(__dirname, '..', '..', 'examples', 'walk-to-flag', 'recordings'), { recursive: true, force: true });
			}
		});
	});

	describe('renaming', function () {
		it('renames a scenario and brings its recordings with it', async function () {
			scenarioAt('old-name');
			recordingIn('old-name', '20260101-000000');
			const r = await post(port, '/api/scenario-entry/rename', { path: 'old-name', name: 'new-name' });
			assert.strictEqual(r.status, 200);
			assert.strictEqual(r.body.path, 'new-name');
			assert.ok(fs.existsSync(path.join(root, 'new-name', 'recordings', '20260101-000000', 'recording.json')),
				'replays follow the scenario — the whole point of storing them inside it');
			assert.ok(!fs.existsSync(path.join(root, 'old-name')));

			const list = await get(port, '/api/recordings?scenario=new-name');
			assert.strictEqual(list.body.length, 1);
		});

		it('renames a folder, keeping everything under it', async function () {
			scenarioAt('Bench/a');
			scenarioAt('Bench/sub/b');
			const r = await post(port, '/api/scenario-entry/rename', { path: 'Bench', name: 'Benches' });
			assert.strictEqual(r.status, 200);
			const tree = await get(port, '/api/scenario-tree');
			assert.deepStrictEqual(tree.body.scenarios.map(function (s) { return s.path; }), ['Benches/a', 'Benches/sub/b']);
		});

		it('refuses a rename onto an existing sibling, and a name with a path in it', async function () {
			scenarioAt('one');
			scenarioAt('two');
			assert.strictEqual((await post(port, '/api/scenario-entry/rename', { path: 'one', name: 'two' })).status, 409);
			assert.strictEqual((await post(port, '/api/scenario-entry/rename', { path: 'one', name: '../escaped' })).status, 400);
		});
	});

	describe('moving', function () {
		it('moves a scenario into a folder and back out to the top level', async function () {
			scenarioAt('rover');
			recordingIn('rover', '20260101-000000');
			await post(port, '/api/scenario-folders', { name: 'Box' });

			const into = await post(port, '/api/scenario-entry/move', { path: 'rover', parent: 'Box' });
			assert.strictEqual(into.status, 200);
			assert.strictEqual(into.body.path, 'Box/rover');
			assert.ok(fs.existsSync(path.join(root, 'Box', 'rover', 'recordings', '20260101-000000')));

			const out = await post(port, '/api/scenario-entry/move', { path: 'Box/rover', parent: '' });
			assert.strictEqual(out.status, 200);
			assert.strictEqual(out.body.path, 'rover');
		});

		// Moving a folder under itself would detach the whole subtree from the
		// workspace — the files would still exist but nothing could reach them.
		it('refuses to move a folder into itself or its own descendant', async function () {
			scenarioAt('Outer/Inner/thing');
			assert.strictEqual((await post(port, '/api/scenario-entry/move', { path: 'Outer', parent: 'Outer' })).status, 400);
			const deeper = await post(port, '/api/scenario-entry/move', { path: 'Outer', parent: 'Outer/Inner' });
			assert.strictEqual(deeper.status, 400);
			assert.match(deeper.body.error, /into itself/);
		});

		it('refuses a move onto an existing name', async function () {
			scenarioAt('dup');
			scenarioAt('Box/dup');
			const r = await post(port, '/api/scenario-entry/move', { path: 'dup', parent: 'Box' });
			assert.strictEqual(r.status, 409);
		});
	});

	describe('deleting', function () {
		it('reports what a delete would take, before asking', async function () {
			scenarioAt('with-replays');
			recordingIn('with-replays', '20260101-000000');
			recordingIn('with-replays', '20260102-000000');
			const scenario = await get(port, '/api/scenario-entry?path=with-replays');
			assert.deepStrictEqual(scenario.body, { kind: 'scenario', path: 'with-replays', recordings: 2 });

			scenarioAt('Box/a');
			scenarioAt('Box/Deeper/b');
			const folder = await get(port, '/api/scenario-entry?path=Box');
			assert.deepStrictEqual(folder.body, { kind: 'folder', path: 'Box', folders: 1, scenarios: 2 });
		});

		it('deletes a scenario with everything inside it', async function () {
			scenarioAt('goner');
			recordingIn('goner', '20260101-000000');
			const r = await del(port, '/api/scenario-entry?path=goner');
			assert.strictEqual(r.status, 200);
			assert.ok(!fs.existsSync(path.join(root, 'goner')));
		});

		it('deletes an empty folder without being forced', async function () {
			await post(port, '/api/scenario-folders', { name: 'Empty' });
			const r = await del(port, '/api/scenario-entry?path=Empty');
			assert.strictEqual(r.status, 200);
		});

		// The GUI warns before it forces. The API refusing as well means a
		// mis-typed URL cannot take a subtree with it.
		it('refuses a non-empty folder unless forced, and says what is in it', async function () {
			scenarioAt('Box/a');
			scenarioAt('Box/Deeper/b');
			const refused = await del(port, '/api/scenario-entry?path=Box');
			assert.strictEqual(refused.status, 409);
			assert.match(refused.body.error, /not empty/);
			assert.strictEqual(refused.body.scenarios, 2);
			assert.strictEqual(refused.body.folders, 1);
			assert.ok(fs.existsSync(path.join(root, 'Box', 'a')), 'nothing deleted');

			const forced = await del(port, '/api/scenario-entry?path=Box&force=1');
			assert.strictEqual(forced.status, 200);
			assert.ok(!fs.existsSync(path.join(root, 'Box')));
		});

		it('refuses a traversal path', async function () {
			for (const evil of ['../..', '..', '', 'a/../../b', 'x/recordings']) {
				const r = await del(port, '/api/scenario-entry?path=' + encodeURIComponent(evil));
				assert.ok(r.status === 400 || r.status === 404, 'must not delete ' + JSON.stringify(evil) + ', got ' + r.status);
			}
			assert.ok(fs.existsSync(root));
		});
	});

	// The scenario id is a path now, so it has to survive an encoded '/' in a
	// :param segment — which is how every per-scenario route is addressed.
	it('addresses a nested scenario through the per-scenario routes', async function () {
		scenarioAt('Benches/deep/thing', ['map.W1N1.json']);
		const encoded = encodeURIComponent('Benches/deep/thing');
		const files = await get(port, '/api/scenarios/' + encoded + '/files');
		assert.strictEqual(files.status, 200);
		assert.deepStrictEqual(files.body.map(function (f) { return f.path; }), ['map.W1N1.json', 'scenario.js']);
		const maps = await get(port, '/api/scenarios/' + encoded + '/maps');
		assert.strictEqual(maps.status, 200);
	});
});

describe('legacy recording migration', function () {
	const { migrateLegacyRecordings } = require('../../src/recording');
	let root, legacy;

	beforeEach(function () {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-mig-scn-'));
		legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-mig-rec-'));
	});
	afterEach(function () {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(legacy, { recursive: true, force: true });
	});

	function legacyRun(scenario, ts) {
		const dir = path.join(legacy, scenario, ts);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'recording.json'), '{"n":1}');
	}

	it('moves runs into the scenario that owns them', function () {
		fs.mkdirSync(path.join(root, 'alpha'), { recursive: true });
		fs.writeFileSync(path.join(root, 'alpha', 'scenario.js'), '//');
		legacyRun('alpha', '20260101-000000');
		legacyRun('alpha', '20260102-000000');

		const result = migrateLegacyRecordings(root, legacy);
		assert.deepStrictEqual(result, { scenarios: 1, runs: 2, skipped: 0 });
		assert.ok(fs.existsSync(path.join(root, 'alpha', 'recordings', '20260101-000000', 'recording.json')));
		assert.ok(!fs.existsSync(path.join(legacy, 'alpha')), 'the emptied legacy directory is cleaned up');
	});

	// Nothing to move them to, and guessing which scenario a name now refers to
	// would be worse than leaving them alone.
	it('leaves runs whose scenario no longer exists exactly where they are', function () {
		legacyRun('deleted-long-ago', '20260101-000000');
		const result = migrateLegacyRecordings(root, legacy);
		assert.deepStrictEqual(result, { scenarios: 0, runs: 0, skipped: 1 });
		assert.ok(fs.existsSync(path.join(legacy, 'deleted-long-ago', '20260101-000000', 'recording.json')));
	});

	it('is idempotent and never overwrites a run already on the scenario side', function () {
		fs.mkdirSync(path.join(root, 'alpha', 'recordings', '20260101-000000'), { recursive: true });
		fs.writeFileSync(path.join(root, 'alpha', 'scenario.js'), '//');
		fs.writeFileSync(path.join(root, 'alpha', 'recordings', '20260101-000000', 'recording.json'), '{"kept":true}');
		legacyRun('alpha', '20260101-000000');

		const first = migrateLegacyRecordings(root, legacy);
		assert.strictEqual(first.runs, 0, 'the existing run is not replaced');
		assert.strictEqual(
			fs.readFileSync(path.join(root, 'alpha', 'recordings', '20260101-000000', 'recording.json'), 'utf8'),
			'{"kept":true}');

		const second = migrateLegacyRecordings(root, legacy);
		assert.strictEqual(second.runs, 0);
	});

	it('does nothing when there is no legacy directory', function () {
		const result = migrateLegacyRecordings(root, path.join(legacy, 'not-here'));
		assert.deepStrictEqual(result, { scenarios: 0, runs: 0, skipped: 0 });
	});
});

describe('orphaned recordings', function () {
	const { listOrphanedRecordings, clearOrphanedRecordings } = require('../../src/recording');
	let root, legacy, server, port;

	function legacyRun(scenario, ts, bytes) {
		const dir = path.join(legacy, scenario, ts);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'recording.json'), 'x'.repeat(bytes || 10));
	}

	beforeEach(function (done) {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-orph-scn-'));
		legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-orph-rec-'));
		server = createServer({ scenariosRoot: root, legacyRecordingsRoot: legacy });
		server.listen(0, '127.0.0.1', function () { port = server.address().port; done(); });
	});
	afterEach(function (done) {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(legacy, { recursive: true, force: true });
		server.close(function () { done(); });
	});

	// A directory whose scenario still exists belongs to the migration, not
	// here — reporting it as an orphan would offer to delete live replays.
	it('reports only directories with no scenario left, with their size', function () {
		fs.mkdirSync(path.join(root, 'alive'), { recursive: true });
		fs.writeFileSync(path.join(root, 'alive', 'scenario.js'), '//');
		legacyRun('alive', '20260101-000000', 100);
		legacyRun('gone', '20260101-000000', 500);
		legacyRun('gone', '20260102-000000', 500);
		legacyRun('also-gone', '20260101-000000', 50);

		const found = listOrphanedRecordings(root, legacy);
		assert.deepStrictEqual(found.entries.map(function (e) { return e.name; }), ['gone', 'also-gone'],
			'biggest first');
		assert.strictEqual(found.entries[0].runs, 2);
		assert.strictEqual(found.entries[0].bytes, 1000);
		assert.strictEqual(found.runs, 3);
		assert.strictEqual(found.bytes, 1050);
	});

	it('serves the same over the API', async function () {
		legacyRun('gone', '20260101-000000', 42);
		const r = await get(port, '/api/recordings/orphans');
		assert.strictEqual(r.status, 200);
		assert.strictEqual(r.body.runs, 1);
		assert.strictEqual(r.body.bytes, 42);
		assert.strictEqual(r.body.entries[0].name, 'gone');
	});

	it('clears them, and leaves a live scenario\'s runs alone', async function () {
		fs.mkdirSync(path.join(root, 'alive'), { recursive: true });
		fs.writeFileSync(path.join(root, 'alive', 'scenario.js'), '//');
		legacyRun('alive', '20260101-000000', 100);
		legacyRun('gone', '20260101-000000', 500);

		const r = await del(port, '/api/recordings/orphans');
		assert.strictEqual(r.status, 200);
		assert.strictEqual(r.body.removed, 1);
		assert.strictEqual(r.body.bytes, 500);
		assert.ok(!fs.existsSync(path.join(legacy, 'gone')));
		assert.ok(fs.existsSync(path.join(legacy, 'alive')), 'not an orphan, not touched');
	});

	it('reports nothing when there is no legacy directory at all', function () {
		const found = listOrphanedRecordings(root, path.join(legacy, 'not-here'));
		assert.deepStrictEqual(found.entries, []);
		assert.strictEqual(found.bytes, 0);
		assert.deepStrictEqual(clearOrphanedRecordings(root, path.join(legacy, 'not-here')), { removed: 0, bytes: 0 });
	});
});

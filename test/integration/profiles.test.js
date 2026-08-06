'use strict';

// End-to-end wiring for bot/server profiles: a scenario's settings.json must
// decide which codebase its run uploads, and the Settings screen must be able to
// see which profiles are actually mounted.
//
// The engine runs every scenario in ONE process during `npm run test:scenarios`,
// so the per-run switch is exercised by running the SAME fixture twice under
// different settings — a directory captured at require time would fail the
// second run, which is exactly the regression worth guarding.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createServer } = require('../../src/server');
const { runScenario } = require('../../src/scenarioRunner');
const botModules = require('../../src/botModules');

const FIXTURE_BOTS = path.join(__dirname, '..', 'fixtures', 'bots');
const FIXTURE_SCENARIO = path.join(__dirname, '..', 'fixtures', 'profile-scenario');

function get(port, p) {
	return new Promise(function (resolve, reject) {
		http.get({ host: '127.0.0.1', port: port, path: p }, function (res) {
			let body = '';
			res.on('data', function (c) { body += c; });
			res.on('end', function () { resolve({ status: res.statusCode, body: body }); });
		}).on('error', reject);
	});
}

describe('bot profiles end to end', function () {
	this.timeout(0);

	// The fixture runs where it lives: its `require('../../../src/botModules')`
	// is relative, so copying it to a temp directory would break the very import
	// under test. Only settings.json is written, and it is removed afterwards.
	const scenarioDir = FIXTURE_SCENARIO;
	let saved;

	before(function () {
		saved = {
			DOJO_BOTS_DIR: process.env.DOJO_BOTS_DIR,
			DOJO_BOT_DIR: process.env.DOJO_BOT_DIR,
			DOJO_BOT_PROFILE_ALPHA_PATH: process.env.DOJO_BOT_PROFILE_ALPHA_PATH,
			DOJO_BOT_PROFILE_BETA_PATH: process.env.DOJO_BOT_PROFILE_BETA_PATH
		};
		process.env.DOJO_BOTS_DIR = FIXTURE_BOTS;
		delete process.env.DOJO_BOT_DIR;
		process.env.DOJO_BOT_PROFILE_ALPHA_PATH = '/host/alpha';
		process.env.DOJO_BOT_PROFILE_BETA_PATH = '/host/beta';
	});

	after(function () {
		for (const key of Object.keys(saved)) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
		fs.rmSync(path.join(scenarioDir, 'settings.json'), { force: true });
	});

	function writeSettings(obj) {
		fs.writeFileSync(path.join(scenarioDir, 'settings.json'), JSON.stringify(obj), 'utf8');
	}

	function consoleSaid(result, name) {
		return result.console.some(function (line) { return String(line).indexOf('bot:' + name) !== -1; });
	}

	it('runs the codebase settings.json names', async function () {
		writeSettings({ bot: 'alpha' });
		const result = await runScenario(scenarioDir, { runExpect: true });
		assert.ok(consoleSaid(result, 'alpha'), 'expected alpha to run, console: ' + JSON.stringify(result.console));
		assert.strictEqual(result.test.passed, true);
	});

	it('switches codebase between runs in the SAME process', async function () {
		writeSettings({ bot: 'beta' });
		const result = await runScenario(scenarioDir, { runExpect: true });
		assert.ok(consoleSaid(result, 'beta'), 'expected beta to run, console: ' + JSON.stringify(result.console));
		assert.strictEqual(consoleSaid(result, 'alpha'), false, 'the previous run\'s bot leaked into this one');
	});

	it('reports the resolved sides on the start event and the recording metadata', async function () {
		writeSettings({ bot: 'alpha', bots: { enemy: 'beta' } });
		let start = null;
		await runScenario(scenarioDir, {
			onEvent: function (ev) { if (ev.type === 'start') start = ev; }
		});
		assert.ok(start, 'no start event');
		assert.strictEqual(start.bots.main, path.posix.join(FIXTURE_BOTS, 'alpha'));
		assert.strictEqual(start.bots.enemy, path.posix.join(FIXTURE_BOTS, 'beta'));
	});

	it('clears the side context afterwards, so nothing leaks into the next scenario', async function () {
		writeSettings({ bot: 'alpha', bots: { enemy: 'beta' } });
		await runScenario(scenarioDir, {});
		assert.throws(function () { botModules.botDir('enemy'); }, /no bot configured for side "enemy"/);
	});

	it('fails before booting the engine when a profile is unknown', async function () {
		writeSettings({ bot: 'nope' });
		await assert.rejects(function () { return runScenario(scenarioDir, {}); },
			/unknown bot profile "nope" \(registered: alpha, beta\)/);
	});

	it('fails clearly when a profile is registered but not mounted', async function () {
		process.env.DOJO_BOT_PROFILE_GHOST_PATH = '/host/ghost';
		writeSettings({ bot: 'ghost' });
		try {
			await assert.rejects(function () { return runScenario(scenarioDir, {}); },
				/registered but not mounted.*npm run ui/);
		} finally {
			delete process.env.DOJO_BOT_PROFILE_GHOST_PATH;
		}
	});

	it('does not fail a scenario that never loads bot code when the default is broken', async function () {
		// tiny-scenario supplies its modules inline, so a misconfigured default
		// profile is none of its business — the error belongs at first use.
		fs.rmSync(path.join(scenarioDir, 'settings.json'), { force: true });
		process.env.DOJO_DEFAULT_BOT_PROFILE = 'ghost';
		try {
			const result = await runScenario(path.join(__dirname, '..', 'fixtures', 'tiny-scenario'), { runExpect: true });
			assert.strictEqual(result.test.passed, true, result.test && result.test.message);
		} finally {
			delete process.env.DOJO_DEFAULT_BOT_PROFILE;
		}
	});

	it('surfaces an unknown setting as a console warning rather than killing the run', async function () {
		writeSettings({ bot: 'alpha', botz: 'typo' });
		const result = await runScenario(scenarioDir, {});
		assert.ok(result.console.some(function (line) { return String(line).indexOf('unknown setting "botz"') !== -1; }),
			'expected a harness warning, console: ' + JSON.stringify(result.console));
	});
});

describe('profile routes', function () {
	let server, port, scenariosRoot, saved;

	before(function (done) {
		scenariosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-profile-api-'));
		const dir = path.join(scenariosRoot, 'demo');
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, 'scenario.js'), 'module.exports = {};\n');
		fs.writeFileSync(path.join(dir, 'settings.json'), '{"bot":"alpha","server":"season"}\n');
		saved = {
			DOJO_BOTS_DIR: process.env.DOJO_BOTS_DIR,
			DOJO_BOT_PROFILE_ALPHA_PATH: process.env.DOJO_BOT_PROFILE_ALPHA_PATH,
			DOJO_SCREEPS_PROFILE_SEASON_SHARD: process.env.DOJO_SCREEPS_PROFILE_SEASON_SHARD,
			DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN: process.env.DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN
		};
		process.env.DOJO_BOTS_DIR = FIXTURE_BOTS;
		process.env.DOJO_BOT_PROFILE_ALPHA_PATH = '/host/alpha';
		process.env.DOJO_SCREEPS_PROFILE_SEASON_SHARD = 'season';
		process.env.DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN = 'super-secret-token';
		server = createServer({ scenariosRoot: scenariosRoot });
		server.listen(0, '127.0.0.1', function () { port = server.address().port; done(); });
	});

	after(function (done) {
		for (const key of Object.keys(saved)) {
			if (saved[key] === undefined) delete process.env[key];
			else process.env[key] = saved[key];
		}
		fs.rmSync(scenariosRoot, { recursive: true, force: true });
		server.close(function () { done(); });
	});

	it('GET /api/bots reports real mount status', async function () {
		const res = await get(port, '/api/bots');
		assert.strictEqual(res.status, 200);
		const body = JSON.parse(res.body);
		const alpha = body.profiles.find(function (p) { return p.name === 'alpha'; });
		assert.ok(alpha, 'alpha missing from ' + res.body);
		assert.strictEqual(alpha.mounted, true);
		assert.strictEqual(alpha.jsModuleCount, 1);
		assert.strictEqual(body.default, 'default');
	});

	it('GET /api/servers never returns a secret', async function () {
		const res = await get(port, '/api/servers');
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.includes('super-secret-token'), false);
		const body = JSON.parse(res.body);
		const season = body.profiles.find(function (p) { return p.name === 'season'; });
		assert.ok(season, 'season missing from ' + res.body);
		assert.strictEqual(season.hasToken, true);
		assert.strictEqual(season.shard, 'season');
	});

	it('GET /api/scenarios/:name/settings reports what will actually be used', async function () {
		const res = await get(port, '/api/scenarios/demo/settings');
		assert.strictEqual(res.status, 200);
		const body = JSON.parse(res.body);
		assert.strictEqual(body.present, true);
		assert.strictEqual(body.settings.bots.main, 'alpha');
		assert.strictEqual(body.effectiveBot, 'alpha');
		assert.strictEqual(body.effectiveServer, 'season');
	});

	it('reports inherited values for a scenario with no settings.json', async function () {
		fs.mkdirSync(path.join(scenariosRoot, 'bare'));
		fs.writeFileSync(path.join(scenariosRoot, 'bare', 'scenario.js'), 'module.exports = {};\n');
		const body = JSON.parse((await get(port, '/api/scenarios/bare/settings')).body);
		assert.strictEqual(body.present, false);
		assert.strictEqual(body.effectiveBot, 'default');
	});

	it('classifies settings.json as its own kind, so the UI can give it a form editor', async function () {
		const files = JSON.parse((await get(port, '/api/scenarios/demo/files')).body);
		const entry = files.find(function (f) { return f.path === 'settings.json'; });
		assert.ok(entry, 'settings.json missing from ' + JSON.stringify(files));
		assert.strictEqual(entry.kind, 'settings');
	});

	it('GET /api/verify/bot verifies a named profile', async function () {
		const body = JSON.parse((await get(port, '/api/verify/bot?profile=alpha')).body);
		assert.strictEqual(body.ok, true);
		assert.strictEqual(body.jsModuleCount, 1);
	});

	it('GET /api/verify/bot explains an unknown profile instead of a bare failure', async function () {
		const body = JSON.parse((await get(port, '/api/verify/bot?profile=nope')).body);
		assert.strictEqual(body.ok, false);
		assert.match(body.error, /unknown bot profile "nope"/);
	});

	it('listing scenarios still costs no extra reads for settings.json', async function () {
		// The scenarios list is the hot path on a Docker bind mount, where each
		// syscall costs milliseconds — settings.json presence must come from the
		// directory read it already does, never from a stat or a read per scenario.
		const list = JSON.parse((await get(port, '/api/scenarios')).body);
		const demo = list.find(function (s) { return s.name === 'demo'; });
		assert.ok(demo.files.includes('settings.json'));
		assert.strictEqual(demo.settings, undefined, 'the list must not embed settings content');
	});
});

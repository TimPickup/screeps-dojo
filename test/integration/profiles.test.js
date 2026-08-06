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
const hostChannel = require('../../src/hostChannel');

const NL = String.fromCharCode(10);
const FIXTURE_BOTS = path.join(__dirname, '..', 'fixtures', 'bots');
const FIXTURE_SCENARIO = path.join(__dirname, '..', 'fixtures', 'profile-scenario');

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
	let saved, emptyEnvFile;

	before(function () {
		saved = {
			DOJO_BOTS_DIR: process.env.DOJO_BOTS_DIR,
			DOJO_BOT_DIR: process.env.DOJO_BOT_DIR,
			DOJO_ENV_FILE: process.env.DOJO_ENV_FILE,
			DOJO_BOT_PROFILE_ALPHA_PATH: process.env.DOJO_BOT_PROFILE_ALPHA_PATH,
			DOJO_BOT_PROFILE_BETA_PATH: process.env.DOJO_BOT_PROFILE_BETA_PATH
		};
		// Resolution merges .env now, so point at an empty one: otherwise this
		// suite would assert on whatever profiles the developer happens to have.
		emptyEnvFile = path.join(os.tmpdir(), 'dojo-empty-' + process.pid + '.env');
		fs.writeFileSync(emptyEnvFile, '', 'utf8');
		process.env.DOJO_ENV_FILE = emptyEnvFile;
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
		fs.rmSync(emptyEnvFile, { force: true });
	});

	function writeSettings(obj) {
		fs.writeFileSync(path.join(scenarioDir, 'settings.json'), JSON.stringify(obj), 'utf8');
	}

	function consoleSaid(result, name) {
		return result.console.some(function (line) { return String(line).indexOf('bot:' + name) !== -1; });
	}

	// THE regression that shipped: profiles live in .env, and docker compose reads
	// that file on the HOST to build the compose file — it does not pass those
	// variables into the container. A runner reading process.env therefore saw
	// "none registered" for a profile the Settings screen was happily listing.
	it('resolves a profile that exists only in .env, not in process.env', async function () {
		const envFile = path.join(os.tmpdir(), 'dojo-envfile-' + process.pid + '.env');
		fs.writeFileSync(envFile, ['DOJO_BOT_PROFILE_BETA_PATH=/host/beta', ''].join('\n'), 'utf8');
		const savedProfile = process.env.DOJO_BOT_PROFILE_BETA_PATH;
		delete process.env.DOJO_BOT_PROFILE_BETA_PATH;
		process.env.DOJO_ENV_FILE = envFile;
		try {
			writeSettings({ bot: 'beta' });
			const result = await runScenario(scenarioDir, { runExpect: true });
			assert.ok(consoleSaid(result, 'beta'), 'console: ' + JSON.stringify(result.console));
		} finally {
			// back to the suite's empty file, NOT deleted — dropping it would let
			// every later test read whatever .env this machine happens to have
			process.env.DOJO_ENV_FILE = emptyEnvFile;
			if (savedProfile !== undefined) process.env.DOJO_BOT_PROFILE_BETA_PATH = savedProfile;
			fs.rmSync(envFile, { force: true });
		}
	});

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
	let server, port, scenariosRoot, saved, emptyEnvFile;

	before(function (done) {
		scenariosRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-profile-api-'));
		const dir = path.join(scenariosRoot, 'demo');
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, 'scenario.js'), 'module.exports = {};\n');
		fs.writeFileSync(path.join(dir, 'settings.json'), '{"bot":"alpha","server":"season"}\n');
		saved = {
			DOJO_BOTS_DIR: process.env.DOJO_BOTS_DIR,
			DOJO_ENV_FILE: process.env.DOJO_ENV_FILE,
			DOJO_BOT_PROFILE_ALPHA_PATH: process.env.DOJO_BOT_PROFILE_ALPHA_PATH,
			DOJO_SCREEPS_PROFILE_SEASON_SHARD: process.env.DOJO_SCREEPS_PROFILE_SEASON_SHARD,
			DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN: process.env.DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN
		};
		emptyEnvFile = path.join(os.tmpdir(), 'dojo-empty-api-' + process.pid + '.env');
		fs.writeFileSync(emptyEnvFile, '', 'utf8');
		process.env.DOJO_ENV_FILE = emptyEnvFile;
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
		fs.rmSync(emptyEnvFile, { force: true });
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
		assert.strictEqual(season.shard, 'season');
		// Profiles stand alone: "season" owns only its shard, so it must NOT
		// report the default profile's token as its own.
		assert.strictEqual(season.hasToken, false);
		const fallback = body.profiles.find(function (p) { return p.name === 'default'; });
		assert.strictEqual(fallback.hasToken, true);
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

	// The browser only ever receives a masked token, so a browser-side rename had
	// to leave it behind and ask for it to be retyped. Doing it here is the whole
	// point: the value moves because this side can see it.
	describe('rename-profile', function () {
		let envFile;

		beforeEach(function () {
			envFile = path.join(os.tmpdir(), 'dojo-rename-' + process.pid + '.env');
			fs.writeFileSync(envFile, [
				'DOJO_BOT_PROFILE_OLD_PATH=/host/old',
				'DOJO_DEFAULT_BOT_PROFILE=old',
				'DOJO_SCREEPS_PROFILE_LIVE_TOKEN=super-secret-token',
				'DOJO_SCREEPS_PROFILE_LIVE_SHARD=shard0',
				''
			].join(NL), 'utf8');
			process.env.DOJO_ENV_FILE = envFile;
		});

		afterEach(function () {
			process.env.DOJO_ENV_FILE = emptyEnvFile;
			fs.rmSync(envFile, { force: true });
		});

		it('carries a secret across, which the browser could never do', async function () {
			const res = await post(port, '/api/env/rename-profile', { kind: 'screeps', from: 'live', to: 'main' });
			assert.strictEqual(res.status, 200);
			const after = fs.readFileSync(envFile, 'utf8');
			assert.ok(after.includes('DOJO_SCREEPS_PROFILE_MAIN_TOKEN=super-secret-token'), after);
			assert.ok(after.includes('DOJO_SCREEPS_PROFILE_MAIN_SHARD=shard0'));
			assert.strictEqual(/DOJO_SCREEPS_PROFILE_LIVE_/.test(after), false, 'the old keys must be gone');
		});

		it('carries the default pointer with the profile it names', async function () {
			// Leaving it behind would point at a profile that no longer exists,
			// which the runner turns into a hard failure on the next run.
			await post(port, '/api/env/rename-profile', { kind: 'bot', from: 'old', to: 'new' });
			const after = fs.readFileSync(envFile, 'utf8');
			assert.ok(after.includes('DOJO_BOT_PROFILE_NEW_PATH=/host/old'));
			assert.ok(after.includes('DOJO_DEFAULT_BOT_PROFILE=new'));
		});

		it('leaves a pointer when the IMPLICIT default is renamed', async function () {
			// With no pointer set, the profile named "default" IS the default.
			// Renaming it without writing one would leave nothing as the default.
			fs.writeFileSync(envFile, ['DOJO_SCREEPS_PROFILE_DEFAULT_SHARD=shard0', ''].join(NL), 'utf8');
			await post(port, '/api/env/rename-profile', { kind: 'screeps', from: 'default', to: 'live' });
			const after = fs.readFileSync(envFile, 'utf8');
			assert.ok(after.includes('DOJO_SCREEPS_PROFILE_LIVE_SHARD=shard0'), after);
			assert.ok(after.includes('DOJO_DEFAULT_SCREEPS_PROFILE=live'), after);
		});

		it('refuses a name that is already taken, and changes nothing', async function () {
			fs.appendFileSync(envFile, 'DOJO_BOT_PROFILE_TAKEN_PATH=/host/taken' + NL, 'utf8');
			const before = fs.readFileSync(envFile, 'utf8');
			const res = await post(port, '/api/env/rename-profile', { kind: 'bot', from: 'old', to: 'taken' });
			assert.strictEqual(res.status, 409);
			assert.strictEqual(fs.readFileSync(envFile, 'utf8'), before);
		});

		it('refuses an unknown profile and an invalid name', async function () {
			assert.strictEqual((await post(port, '/api/env/rename-profile', { kind: 'bot', from: 'ghost', to: 'x' })).status, 404);
			assert.strictEqual((await post(port, '/api/env/rename-profile', { kind: 'bot', from: 'old', to: '../etc' })).status, 400);
			assert.strictEqual((await post(port, '/api/env/rename-profile', { kind: 'nope', from: 'old', to: 'x' })).status, 400);
		});
	});

	it('refuses to queue a request when no host agent is listening', async function () {
		hostChannel.clearStatus();
		const res = await post(port, '/api/host-agent/request', { action: 'recreate' });
		assert.strictEqual(res.status, 409);
		assert.match(JSON.parse(res.body).error, /npm run host-agent/);
		assert.strictEqual(fs.existsSync(hostChannel.REQUEST_PATH), false, 'nothing should be left for a future agent');
	});

	it('refuses an action outside the allow-list even with an agent listening', async function () {
		hostChannel.writeStatus({ heartbeatAt: new Date().toISOString(), actions: hostChannel.ACTIONS });
		try {
			const res = await post(port, '/api/host-agent/request', { action: 'exec' });
			assert.strictEqual(res.status, 400);
			assert.strictEqual(fs.existsSync(hostChannel.REQUEST_PATH), false);
		} finally { hostChannel.clearStatus(); }
	});

	it('queues an allowed action, carrying nothing but its name', async function () {
		hostChannel.writeStatus({ heartbeatAt: new Date().toISOString(), actions: hostChannel.ACTIONS });
		try {
			const res = await post(port, '/api/host-agent/request', { action: 'recreate', command: 'shutdown /s' });
			assert.strictEqual(res.status, 200);
			const written = hostChannel.readRequest();
			assert.deepStrictEqual(Object.keys(written).sort(), ['action', 'id', 'requestedAt']);
			assert.strictEqual(written.action, 'recreate');
		} finally {
			hostChannel.clearStatus();
			hostChannel.clearRequest();
		}
	});

	it('GET /api/host-agent reports no agent as no offered actions', async function () {
		hostChannel.clearStatus();
		const body = JSON.parse((await get(port, '/api/host-agent')).body);
		assert.strictEqual(body.running, false);
		assert.deepStrictEqual(body.actions, [], 'the UI must not offer buttons nothing will answer');
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

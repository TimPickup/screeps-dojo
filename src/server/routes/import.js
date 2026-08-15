'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { pathSafe } = require('../pathSafe');
const { loadEnvConfig } = require('../../envConfig');
const { openSse } = require('../sse');
const screepsProfiles = require('../../screepsProfiles');
const scenarioSettings = require('../../scenarioSettings');
const { expandRoomSpecs } = require('../../import/roomSpecs');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const imports = new Map(); // id -> { history, done, error, subscribers }
let counter = 0;

function broadcast(job, evt) {
	job.history.push(evt);
	for (const sink of job.subscribers) { try { sink(evt); } catch (e) { /* ignore */ } }
}

module.exports = function registerImportRoutes(router, ctx) {
	// The server profile a request is about: the scenario's own choice when it
	// names one, so the activation popup targets the server it will import from.
	function configFor(req) {
		const env = loadEnvConfig();
		const scenario = (req.query.get('scenario') || '').trim();
		if (!scenario) return screepsProfiles.resolve(undefined, env);
		let dir;
		try { dir = pathSafe(ctx.scenariosRoot, scenario); } catch (e) { return screepsProfiles.resolve(undefined, env); }
		const settings = scenarioSettings.load(dir).settings;
		return screepsProfiles.resolve(settings.server, env,
			settings.server ? scenario + '/' + scenarioSettings.FILE_NAME : null);
	}

	// Token status — masked only; never leaks the raw token to the browser.
	router.get('/api/import/token-status', async function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up' }); return; }
		try {
			const { createClient } = require('../../import/screepsClient');
			const client = createClient(configFor(req));
			const status = await client.checkToken();
			ctx.sendJson(res, 200, {
				active: status.active,
				needsActivation: !status.active && Boolean(status.activateUrl),
				authMode: status.authMode,
				secondsLeft: status.secondsLeft,
				maskedUrl: status.maskedUrl
			});
		} catch (e) {
			ctx.sendJson(res, 200, { active: false, needsActivation: true, error: String((e && e.message) || e) });
		}
	});

	// One-click activation: 302-redirect to the secret activation URL so the raw
	// token stays out of the SPA's JS/history (only the browser follows it).
	router.get('/api/import/activate', async function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up' }); return; }
		try {
			const { createClient } = require('../../import/screepsClient');
			const client = createClient(configFor(req));
			const status = await client.checkToken();
			if (status.activateUrl) { res.writeHead(302, { Location: status.activateUrl }); res.end(); return; }
			ctx.sendJson(res, 400, { error: 'no activation url' });
		} catch (e) { ctx.sendJson(res, 500, { error: String((e && e.message) || e) }); }
	});

	// Import rooms into a scenario (spawns scripts/importRoom.js; streams stdout).
	router.post('/api/scenarios/:name/import', function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up' }); return; }
		const name = req.params.name;
		let dir;
		try { dir = pathSafe(ctx.scenariosRoot, name); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		let rooms;
		try { rooms = expandRoomSpecs((req.body && req.body.rooms) || []); }
		catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		const includeMemory = Boolean(req.body && req.body.memory === true);
		const includeSegments = Boolean(req.body && req.body.segments === true);
		const includeMyCreeps = !req.body || req.body.creeps !== false;
		const includeMyStructures = !req.body || req.body.structures !== false;
		const overwrite = Boolean(req.body && req.body.overwrite === true);

		counter += 1;
		const id = 'import-' + Date.now() + '-' + counter;
		const job = { history: [], done: false, error: null, subscribers: new Set() };
		imports.set(id, job);

		const childArgs = ['scripts/importRoom.js', name].concat(rooms);
		if (includeMemory) childArgs.push('--memory');
		if (includeSegments) childArgs.push('--segments');
		if (!includeMyCreeps) childArgs.push('--no-creeps');
		if (!includeMyStructures) childArgs.push('--no-structures');
		if (overwrite) childArgs.push('--overwrite');
		const child = spawn('node', childArgs, { cwd: REPO_ROOT });
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
			if (code === 0) {
				if (ctx.invalidateScenarioMaps) ctx.invalidateScenarioMaps(name);
				broadcast(job, { type: 'done' });
			}
			else { job.error = 'import exited ' + code; broadcast(job, { type: 'failed', error: job.error }); }
		});
		child.on('error', function (err) { job.done = true; job.error = String(err.message || err); broadcast(job, { type: 'failed', error: job.error }); });

		ctx.sendJson(res, 200, { importId: id });
	});

	router.get('/api/import/:id/stream', function (req, res) {
		const sse = openSse(res);
		const job = imports.get(req.params.id);
		if (!job) { sse.send('failed', { error: 'no such import' }); sse.close(); return; }
		for (const evt of job.history) sse.send(evt.type, evt);
		if (!job.done) {
			const sink = function (evt) { sse.send(evt.type, evt); };
			job.subscribers.add(sink);
			res.on('close', function () { job.subscribers.delete(sink); });
		} else {
			sse.close();
		}
	});
};

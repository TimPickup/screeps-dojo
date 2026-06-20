'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { pathSafe } = require('../pathSafe');
const { loadEnvConfig } = require('../envConfig');
const { openSse } = require('../sse');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const imports = new Map(); // id -> { history, done, error, subscribers }
let counter = 0;

function broadcast(job, evt) {
	job.history.push(evt);
	for (const sink of job.subscribers) { try { sink(evt); } catch (e) { /* ignore */ } }
}

module.exports = function registerImportRoutes(router, ctx) {
	// Token status — masked only; never leaks the raw token to the browser.
	router.get('/api/import/token-status', async function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up' }); return; }
		try {
			const { createClient } = require('../../import/screepsClient');
			const client = createClient(loadEnvConfig());
			const status = await client.checkToken();
			ctx.sendJson(res, 200, { active: status.active, needsActivation: !status.active, secondsLeft: status.secondsLeft, maskedUrl: status.maskedUrl });
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
			const client = createClient(loadEnvConfig());
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
		const rooms = (req.body && req.body.rooms) || [];
		if (!Array.isArray(rooms) || rooms.length === 0) { ctx.sendJson(res, 400, { error: 'rooms[] required' }); return; }
		for (const r of rooms) { if (!/^[WE]\d+[NS]\d+$/.test(r)) { ctx.sendJson(res, 400, { error: 'bad room name: ' + r }); return; } }

		counter += 1;
		const id = 'import-' + Date.now() + '-' + counter;
		const job = { history: [], done: false, error: null, subscribers: new Set() };
		imports.set(id, job);

		const child = spawn('node', ['scripts/importRoom.js', name].concat(rooms), { cwd: REPO_ROOT });
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
			if (code === 0) broadcast(job, { type: 'done' });
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

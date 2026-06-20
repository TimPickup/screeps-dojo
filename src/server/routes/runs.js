'use strict';

const fs = require('fs');
const path = require('path');
const { pathSafe } = require('../pathSafe');
const jobManager = require('../jobManager');
const { openSse } = require('../sse');

module.exports = function registerRunRoutes(router, ctx) {
	function start(kind) {
		return function (req, res) {
			if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up — try again shortly' }); return; }
			const body = req.body || {};
			const name = body.scenario;
			if (!name) { ctx.sendJson(res, 400, { error: 'scenario required' }); return; }
			let dir;
			try { dir = pathSafe(ctx.scenariosRoot, name); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
			if (!fs.existsSync(path.join(dir, 'scenario.js'))) { ctx.sendJson(res, 404, { error: 'no such scenario: ' + name }); return; }
			try {
				const out = jobManager.startJob(kind, dir, { record: body.record === true });
				ctx.sendJson(res, 200, out);
			} catch (e) {
				ctx.sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
			}
		};
	}

	router.post('/api/run', start('run'));
	router.post('/api/test', start('test'));

	router.get('/api/jobs/active', function (req, res) {
		ctx.sendJson(res, 200, jobManager.getActive());
	});

	router.post('/api/jobs/:id/abort', function (req, res) {
		const ok = jobManager.abort(req.params.id);
		ctx.sendJson(res, 200, { ok: ok });
	});

	router.get('/api/jobs/:id/stream', function (req, res) {
		const sse = openSse(res);
		const unsubscribe = jobManager.subscribe(req.params.id, function (evt) {
			sse.send(evt.type, evt);
			// terminal events end the stream so a finished/absent job's connection
			// doesn't hang open forever (heartbeating). The browser's EventSource
			// also closes on these (useJobStream), but close server-side too.
			if (evt.type === 'end' || evt.type === 'gone' || evt.type === 'fatal') sse.close();
		});
		res.on('close', unsubscribe);
	});
};

'use strict';

const bootstrap = require('../bootstrap');
const { openSse } = require('../sse');

module.exports = function registerBootstrapRoutes(router, ctx) {
	router.get('/api/bootstrap/status', function (req, res) {
		ctx.sendJson(res, 200, { phase: bootstrap.getPhase() });
	});

	// Streams the install log: replays history, then live lines, then ready/failed.
	router.get('/api/bootstrap/stream', function (req, res) {
		const sse = openSse(res);
		const history = bootstrap.readLog();
		if (history) sse.send('log', { line: history });
		const phase = bootstrap.getPhase();
		if (phase === 'ready') { sse.send('ready', {}); sse.close(); return; }
		if (phase === 'failed') { sse.send('failed', {}); sse.close(); return; }
		const unsubscribe = bootstrap.subscribe(function (evt) {
			sse.send(evt.type, evt);
			if (evt.type === 'ready' || evt.type === 'failed') { ctx.setReady(bootstrap.getPhase() === 'ready'); }
		});
		res.on('close', unsubscribe);
	});
};

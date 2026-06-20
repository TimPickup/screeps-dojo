'use strict';

// Dojo GUI control-plane server. Node built-ins ONLY (no package requires at
// module load) so it can boot on an empty node_modules volume during first-run
// install; routes that need volume packages must lazy-import them.
const http = require('http');
const path = require('path');
const { createRouter } = require('./router');
const { createStatic } = require('./static');
const { RECORDINGS_ROOT } = require('../recording');

const REPO_ROOT = path.join(__dirname, '..', '..');

function readBody(req) {
	return new Promise(function (resolve) {
		const chunks = [];
		let size = 0;
		req.on('data', function (c) { size += c.length; if (size < 5 * 1024 * 1024) chunks.push(c); });
		req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
		req.on('error', function () { resolve(''); });
	});
}

function sendJson(res, code, obj) {
	const body = JSON.stringify(obj === undefined ? null : obj);
	res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(body);
}

function createServer(opts) {
	opts = opts || {};
	const scenariosRoot = opts.scenariosRoot || path.join(REPO_ROOT, 'scenarios');
	const recordingsRoot = opts.recordingsRoot || RECORDINGS_ROOT;
	const distDir = opts.distDir || path.join(REPO_ROOT, 'ui', 'dist');

	const router = createRouter();
	const staticServer = createStatic(distDir);
	const ctx = { sendJson: sendJson, scenariosRoot: scenariosRoot, recordingsRoot: recordingsRoot, repoRoot: REPO_ROOT };

	// readiness (Phase 5 bootstrap fills this in); default ready
	let ready = opts.ready !== undefined ? opts.ready : true;
	ctx.isReady = function () { return ready; };
	ctx.setReady = function (v) { ready = v; };

	router.get('/api/health', function (req, res) { sendJson(res, 200, { ok: true, ready: ready }); });

	const version = require('./version');
	router.get('/api/version', function (req, res) {
		version.getVersionInfo()
			.then(function (info) { sendJson(res, 200, info); })
			.catch(function () { sendJson(res, 200, { current: version.CURRENT, latest: null, updateAvailable: false }); });
	});

	require('./routes/scenarios')(router, ctx);
	require('./routes/recordings')(router, ctx);
	require('./routes/runs')(router, ctx);
	require('./routes/render')(router, ctx);
	require('./routes/files')(router, ctx);
	require('./routes/import')(router, ctx);
	require('./routes/env')(router, ctx);
	require('./routes/bootstrap')(router, ctx);

	const server = http.createServer(function (req, res) {
		let url;
		try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); res.end('bad url'); return; }
		const pathname = url.pathname;

		if (pathname.startsWith('/api/')) {
			const m = router.match(req.method, pathname);
			if (!m) { sendJson(res, 404, { error: 'no route: ' + req.method + ' ' + pathname }); return; }
			req.query = url.searchParams;
			req.params = m.params;
			if (req.method === 'POST' || req.method === 'PUT') {
				readBody(req).then(function (raw) {
					try { req.body = raw ? JSON.parse(raw) : {}; }
					catch (e) { sendJson(res, 400, { error: 'invalid JSON body' }); return; }
					Promise.resolve(m.handler(req, res)).catch(function (e) {
						sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
					});
				});
			} else {
				Promise.resolve(m.handler(req, res)).catch(function (e) {
					sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
				});
			}
			return;
		}
		// the standalone visual editor (embedded by the Edit tab via iframe)
		if (pathname === '/dojo-editor.html') {
			const fs = require('fs');
			const editorPath = path.join(REPO_ROOT, 'editor', 'dojo-editor.html');
			if (fs.existsSync(editorPath)) {
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				fs.createReadStream(editorPath).pipe(res);
				return;
			}
		}
		staticServer.serve(req, res, pathname);
	});

	server.dojo = { router: router, ctx: ctx };
	return server;
}

module.exports = { createServer: createServer, sendJson: sendJson };

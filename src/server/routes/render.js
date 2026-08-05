'use strict';

const fs = require('fs');
const path = require('path');
const { pathSafe } = require('../pathSafe');
const renderManager = require('../renderManager');
const { openSse } = require('../sse');

const TYPES = { '.gif': 'image/gif', '.mp4': 'video/mp4' };
const FONT_FILES = {
	regular: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
	bold: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
};

module.exports = function registerRenderRoutes(router, ctx) {
	router.get('/api/render/font', function (req, res) {
		const bold = Number(req.query.get('weight')) >= 600;
		const file = FONT_FILES[bold ? 'bold' : 'regular'];
		fs.stat(file, function (error, stat) {
			if (error || !stat.isFile()) { ctx.sendJson(res, 404, { error: 'render font unavailable' }); return; }
			res.writeHead(200, {
				'Content-Type': 'font/ttf',
				'Content-Length': stat.size,
				'Cache-Control': 'public, max-age=31536000, immutable'
			});
			fs.createReadStream(file).on('error', function () { res.end(); }).pipe(res);
		});
	});

	// POST /api/render { path: <recordings-rel recording.json>, format, fps?, speed?, pixels? } -> { id }
	router.post('/api/render', function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up — try again shortly' }); return; }
		const body = req.body || {};
		if (!body.path) { ctx.sendJson(res, 400, { error: 'path required' }); return; }
		const format = body.format === 'gif' ? 'gif' : 'mp4';
		if (body.fps !== undefined && !(Number(body.fps) > 0)) { ctx.sendJson(res, 400, { error: 'fps must be a positive number' }); return; }
		const speed = body.speed === undefined ? undefined : Number(body.speed);
		if (speed !== undefined && (!Number.isFinite(speed) || speed <= 0)) { ctx.sendJson(res, 400, { error: 'speed must be a positive number' }); return; }
		if (body.pixels !== undefined && !(Number(body.pixels) > 0)) { ctx.sendJson(res, 400, { error: 'pixels must be a positive number' }); return; }
		let abs;
		try { abs = pathSafe(ctx.recordingsRoot, body.path); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		if (!fs.existsSync(abs)) { ctx.sendJson(res, 404, { error: 'recording not found' }); return; }
		try {
			const out = renderManager.startRender(abs, format, { fps: body.fps, speed: speed, pixels: body.pixels });
			ctx.sendJson(res, 200, out);
		} catch (e) {
			ctx.sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
		}
	});

	router.get('/api/render/:id/stream', function (req, res) {
		const sse = openSse(res);
		const unsubscribe = renderManager.subscribe(req.params.id, function (evt) {
			// translate absolute output file into a recordings-relative download path
			if (evt.type === 'done') {
				const rel = path.relative(ctx.recordingsRoot, evt.file).split(path.sep).join('/');
				sse.send('done', { relPath: rel });
			} else {
				sse.send(evt.type, evt);
			}
		});
		res.on('close', unsubscribe);
	});

	router.post('/api/render/:id/cancel', function (req, res) {
		try {
			ctx.sendJson(res, 200, renderManager.cancelRender(req.params.id));
		} catch (e) {
			ctx.sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
		}
	});

	// GET /api/render/file?path=<recordings-rel export.gif|mp4> -> streams the file
	router.get('/api/render/file', function (req, res) {
		const rel = req.query.get('path');
		if (!rel) { ctx.sendJson(res, 400, { error: 'path required' }); return; }
		let abs;
		try { abs = pathSafe(ctx.recordingsRoot, rel); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		if (!fs.existsSync(abs)) { ctx.sendJson(res, 404, { error: 'not found' }); return; }
		const type = TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
		res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + path.basename(abs) + '"' });
		fs.createReadStream(abs).on('error', function () { res.end(); }).pipe(res);
	});
};

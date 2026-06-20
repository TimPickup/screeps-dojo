'use strict';

// Serves the built React app from ui/dist with SPA fallback. Before the
// frontend is built, serves a small placeholder so the server is usable on its
// own (health + API). No deps.
const fs = require('fs');
const path = require('path');
const { pathSafe } = require('./pathSafe');

const TYPES = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
	'.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
	'.map': 'application/json; charset=utf-8', '.ico': 'image/x-icon'
};

const PLACEHOLDER = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dojo UI</title>'
	+ '<style>body{background:#1a1a1a;color:#ccc;font-family:monospace;padding:40px}'
	+ 'code{color:#65fd62}</style></head><body><h1>Screeps Dojo — server running</h1>'
	+ '<p>The control-plane API is up, but the React frontend is not built yet.</p>'
	+ '<p>Build it with <code>npm run build:ui</code>, then reload.</p>'
	+ '<p>API health: <code>/api/health</code></p></body></html>';

function createStatic(distDir) {
	function serve(req, res, pathname) {
		let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
		if (rel === '') rel = 'index.html';
		let filePath;
		try { filePath = pathSafe(distDir, rel); } catch (e) { res.writeHead(400); res.end('bad path'); return; }

		fs.stat(filePath, function (err, stat) {
			if (!err && stat.isFile()) return sendFile(res, filePath);
			// SPA fallback -> index.html (so client routes resolve)
			const indexPath = path.join(distDir, 'index.html');
			fs.stat(indexPath, function (e2, s2) {
				if (!e2 && s2.isFile()) return sendFile(res, indexPath);
				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(PLACEHOLDER);
			});
		});
	}
	function sendFile(res, filePath) {
		const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
		res.writeHead(200, { 'Content-Type': type });
		fs.createReadStream(filePath).on('error', function () { res.end(); }).pipe(res);
	}
	return { serve: serve };
}

module.exports = { createStatic: createStatic };

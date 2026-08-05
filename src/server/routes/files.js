'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathSafe } = require('../pathSafe');

function kindOf(name) {
	if (/map.*\.json$/i.test(name)) return 'map';
	if (name.endsWith('.js')) return 'js';
	if (name.endsWith('.json')) return 'json';
	return 'other';
}

module.exports = function registerFileRoutes(router, ctx) {
	function scenarioDir(name) { return pathSafe(ctx.scenariosRoot, name); }
	const MAP_CACHE_LIMIT = 4;
	const mapCache = new Map(); // scenario -> { etag, body }
	const mapWatchers = new Map();

	function closeMapWatcher(name) {
		const watcher = mapWatchers.get(name);
		if (!watcher) return;
		mapWatchers.delete(name);
		try { watcher.close(); } catch (e) { /* already closed */ }
	}

	function invalidateScenarioMaps(name) {
		mapCache.delete(name);
		closeMapWatcher(name);
	}
	ctx.invalidateScenarioMaps = invalidateScenarioMaps;

	function cachedScenarioMaps(name) {
		const cached = mapCache.get(name);
		if (!cached) return null;
		mapCache.delete(name);
		mapCache.set(name, cached);
		return cached;
	}

	function cacheScenarioMaps(name, value) {
		mapCache.set(name, value);
		while (mapCache.size > MAP_CACHE_LIMIT) {
			const oldest = mapCache.keys().next().value;
			mapCache.delete(oldest);
			closeMapWatcher(oldest);
		}
	}

	function isFileEntry(entry, full) {
		if (entry.isFile()) return true;
		if (!entry.isSymbolicLink()) return false;
		try { return fs.statSync(full).isFile(); } catch (e) { return false; }
	}

	function watchScenario(name, dir) {
		if (mapWatchers.has(name)) return;
		try {
			const watcher = fs.watch(dir, { persistent: false }, function () { invalidateScenarioMaps(name); });
			watcher.on('error', function () { invalidateScenarioMaps(name); });
			mapWatchers.set(name, watcher);
		} catch (e) { /* explicit UI mutations still invalidate; reload remains available */ }
	}

	function loadScenarioMaps(name, dir) {
		const cached = cachedScenarioMaps(name);
		if (cached) return cached;
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		const names = [];
		for (const entry of entries) {
			if (entry.name[0] === '.' || kindOf(entry.name) !== 'map') continue;
			if (isFileEntry(entry, path.join(dir, entry.name))) names.push(entry.name);
		}
		names.sort();
		const maps = [];
		const errors = [];
		const hash = crypto.createHash('sha1');
		for (const fileName of names) {
			try {
				const raw = fs.readFileSync(path.join(dir, fileName), 'utf8');
				hash.update(fileName).update('\0').update(raw).update('\0');
				maps.push({ path: fileName, map: JSON.parse(raw) });
			} catch (e) {
				errors.push({ path: fileName, error: String((e && e.message) || e) });
			}
		}
		const revision = hash.digest('hex');
		const result = {
			etag: '"' + revision + '"',
			body: JSON.stringify({ maps: maps, errors: errors, revision: revision })
		};
		watchScenario(name, dir);
		cacheScenarioMaps(name, result);
		return result;
	}

	router.get('/api/scenarios/:name/files', function (req, res) {
		let dir;
		try { dir = scenarioDir(req.params.name); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		try {
			const out = [];
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				if (entry.name[0] === '.') continue;
				if (isFileEntry(entry, path.join(dir, entry.name))) out.push({ path: entry.name, kind: kindOf(entry.name) });
			}
			out.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
			ctx.sendJson(res, 200, out);
		} catch (e) {
			ctx.sendJson(res, e && e.code === 'ENOENT' ? 404 : 500,
				{ error: e && e.code === 'ENOENT' ? 'no such scenario' : String((e && e.message) || e) });
		}
	});

	// Bulk read for the Run tab's static scenario preview. Large scenarios can
	// contain hundreds of room maps, so fetching each file separately would turn
	// one preview into hundreds of HTTP requests. This only reads and parses map
	// JSON; it never loads scenario.js or starts a Screeps process.
	router.get('/api/scenarios/:name/maps', function (req, res) {
		const name = req.params.name;
		let dir;
		try { dir = scenarioDir(name); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		try {
			const cached = loadScenarioMaps(name, dir);
			if (req.headers['if-none-match'] === cached.etag) {
				res.writeHead(304, { 'Cache-Control': 'no-cache', 'ETag': cached.etag });
				res.end();
				return;
			}
			res.writeHead(200, {
				'Content-Type': 'application/json; charset=utf-8',
				'Cache-Control': 'no-cache',
				'ETag': cached.etag
			});
			res.end(cached.body);
		} catch (e) {
			ctx.sendJson(res, e && e.code === 'ENOENT' ? 404 : 500,
				{ error: e && e.code === 'ENOENT' ? 'no such scenario' : String((e && e.message) || e) });
		}
	});

	router.get('/api/scenarios/:name/file', function (req, res) {
		const rel = req.query.get('path');
		if (!rel) { ctx.sendJson(res, 400, { error: 'path required' }); return; }
		let abs;
		try { abs = pathSafe(scenarioDir(req.params.name), rel); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		if (!fs.existsSync(abs)) { ctx.sendJson(res, 404, { error: 'not found' }); return; }
		ctx.sendJson(res, 200, { content: fs.readFileSync(abs, 'utf8') });
	});

	// Delete a file in a scenario. scenario.js is protected (it's the scenario).
	router.del('/api/scenarios/:name/file', function (req, res) {
		const rel = req.query.get('path');
		if (!rel) { ctx.sendJson(res, 400, { error: 'path required' }); return; }
		if (path.basename(rel) === 'scenario.js') { ctx.sendJson(res, 400, { error: 'scenario.js is the scenario and cannot be deleted' }); return; }
		let abs;
		try { abs = pathSafe(scenarioDir(req.params.name), rel); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		if (!fs.existsSync(abs)) { ctx.sendJson(res, 404, { error: 'not found' }); return; }
		try { fs.unlinkSync(abs); invalidateScenarioMaps(req.params.name); ctx.sendJson(res, 200, { ok: true }); }
		catch (e) { ctx.sendJson(res, 500, { error: String((e && e.message) || e) }); }
	});

	// Rename a file within a scenario. scenario.js is protected (the runner
	// requires it by name); renaming to scenario.js is likewise refused.
	router.post('/api/scenarios/:name/rename', function (req, res) {
		const body = req.body || {};
		const from = body.from, to = (body.to || '').trim();
		if (!from || !to) { ctx.sendJson(res, 400, { error: 'from and to are required' }); return; }
		if (/[\\/]/.test(to)) { ctx.sendJson(res, 400, { error: 'name cannot contain a path' }); return; }
		if (path.basename(from) === 'scenario.js' || to === 'scenario.js') { ctx.sendJson(res, 400, { error: 'scenario.js cannot be renamed' }); return; }
		let absFrom, absTo;
		try {
			const dir = scenarioDir(req.params.name);
			absFrom = pathSafe(dir, from);
			absTo = pathSafe(dir, to);
		} catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		if (!fs.existsSync(absFrom)) { ctx.sendJson(res, 404, { error: 'not found' }); return; }
		if (fs.existsSync(absTo)) { ctx.sendJson(res, 409, { error: 'a file named "' + to + '" already exists' }); return; }
		try { fs.renameSync(absFrom, absTo); invalidateScenarioMaps(req.params.name); ctx.sendJson(res, 200, { ok: true }); }
		catch (e) { ctx.sendJson(res, 500, { error: String((e && e.message) || e) }); }
	});

	router.put('/api/scenarios/:name/file', function (req, res) {
		const rel = req.query.get('path');
		if (!rel) { ctx.sendJson(res, 400, { error: 'path required' }); return; }
		const body = req.body || {};
		if (typeof body.content !== 'string') { ctx.sendJson(res, 400, { error: 'content (string) required' }); return; }
		let abs;
		try { abs = pathSafe(scenarioDir(req.params.name), rel); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, body.content, 'utf8');
		invalidateScenarioMaps(req.params.name);
		ctx.sendJson(res, 200, { ok: true });
	});
};

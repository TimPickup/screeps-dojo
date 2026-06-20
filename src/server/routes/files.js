'use strict';

const fs = require('fs');
const path = require('path');
const { pathSafe } = require('../pathSafe');

function kindOf(name) {
	if (/map.*\.json$/i.test(name)) return 'map';
	if (name.endsWith('.js')) return 'js';
	if (name.endsWith('.json')) return 'json';
	return 'other';
}

module.exports = function registerFileRoutes(router, ctx) {
	function scenarioDir(name) { return pathSafe(ctx.scenariosRoot, name); }

	router.get('/api/scenarios/:name/files', function (req, res) {
		let dir;
		try { dir = scenarioDir(req.params.name); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		if (!fs.existsSync(dir)) { ctx.sendJson(res, 404, { error: 'no such scenario' }); return; }
		const out = [];
		for (const entry of fs.readdirSync(dir)) {
			if (entry[0] === '.') continue;
			let st;
			try { st = fs.statSync(path.join(dir, entry)); } catch (e) { continue; }
			if (st.isFile()) out.push({ path: entry, kind: kindOf(entry) });
		}
		out.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
		ctx.sendJson(res, 200, out);
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
		try { fs.unlinkSync(abs); ctx.sendJson(res, 200, { ok: true }); }
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
		try { fs.renameSync(absFrom, absTo); ctx.sendJson(res, 200, { ok: true }); }
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
		ctx.sendJson(res, 200, { ok: true });
	});
};

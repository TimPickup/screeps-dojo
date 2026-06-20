'use strict';

const fs = require('fs');
const path = require('path');
const { pathSafe } = require('../pathSafe');
const { createFromTemplate } = require('../scaffold');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Lists top-level files in a scenario dir (scenario dirs are flat: scenario.js,
// map*.json, main.js, memory.json, ...). Skips dotfiles and nested dirs.
function listFiles(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir)) {
		if (entry[0] === '.') continue;
		let st;
		try { st = fs.statSync(path.join(dir, entry)); } catch (e) { continue; }
		if (st.isFile()) out.push(entry);
	}
	return out.sort();
}

module.exports = function registerScenarioRoutes(router, ctx) {
	router.get('/api/scenarios', function (req, res) {
		const root = ctx.scenariosRoot;
		const out = [];
		if (fs.existsSync(root)) {
			for (const name of fs.readdirSync(root).sort()) {
				const dir = path.join(root, name);
				let st;
				try { st = fs.statSync(dir); } catch (e) { continue; }
				if (!st.isDirectory()) continue;
				if (!fs.existsSync(path.join(dir, 'scenario.js'))) continue;
				const files = listFiles(dir);
				const hasMap = files.some(function (f) { return /map.*\.json$/i.test(f); });
				out.push({ name: name, hasMap: hasMap, files: files });
			}
		}
		ctx.sendJson(res, 200, out);
	});

	// Create a new scenario: folder + boilerplate scenario.js + main.js + 2 maps.
	router.post('/api/scenarios', function (req, res) {
		const body = req.body || {};
		const name = (body.name || '').trim();
		if (!NAME_RE.test(name)) { ctx.sendJson(res, 400, { error: 'name must be letters/numbers/dash/underscore' }); return; }
		let dir;
		try { dir = pathSafe(ctx.scenariosRoot, name); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		if (fs.existsSync(dir)) { ctx.sendJson(res, 409, { error: 'a scenario named "' + name + '" already exists' }); return; }
		try {
			createFromTemplate(dir, name);
			ctx.sendJson(res, 200, { name: name });
		} catch (e) {
			ctx.sendJson(res, 500, { error: String((e && e.message) || e) });
		}
	});
};

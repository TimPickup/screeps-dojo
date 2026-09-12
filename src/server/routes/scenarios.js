'use strict';

const fs = require('fs');
const path = require('path');
const { createFromTemplate, listTemplates, listCopyableScenarios } = require('../scaffold');
const {
	RECORDINGS_DIR_NAME, MAX_DEPTH,
	resolveScenarioPath, walkScenarioTree, isScenarioDir, countFolderContents
} = require('../../scenarioTree');

// Governs names the GUI will CREATE, keeping new directories tidy.
// Deliberately NOT applied when reading: the listing shows any directory
// holding a scenario.js, whatever it is called (see src/scenarioTree.js).
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_ -]*$/;

function badName(name) {
	if (!NAME_RE.test(name)) return 'name must start with a letter or number, then letters/numbers/space/dash/underscore';
	if (name === RECORDINGS_DIR_NAME) return '"' + RECORDINGS_DIR_NAME + '" is reserved — every scenario keeps its replays in a folder of that name';
	return null;
}

// The parent a create/move targets: '' is the top level, anything else must be
// an existing FOLDER (not a scenario — scenarios are leaves).
function resolveParent(root, parent) {
	if (!parent) return path.resolve(root);
	const dir = resolveScenarioPath(root, parent);
	let stat;
	try { stat = fs.statSync(dir); } catch (e) {
		const err = new Error('no such folder: ' + parent); err.statusCode = 404; throw err;
	}
	if (!stat.isDirectory() || isScenarioDir(dir)) {
		const err = new Error('not a folder: ' + parent); err.statusCode = 400; throw err;
	}
	return dir;
}

module.exports = function registerScenarioRoutes(router, ctx) {
	// Push the new tree to any open GUI immediately rather than waiting for the
	// watcher's next poll.
	function touch() { if (ctx.scenarioWatch) ctx.scenarioWatch.touch(); }

	function fail(res, e) {
		ctx.sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
	}

	// Route handlers run synchronously (src/server/index.js) and the process
	// installs no uncaughtException handler, so a throw from here would take the
	// server down. Everything is caught and reported.
	function guard(handler) {
		return function (req, res) {
			try { handler(req, res); } catch (e) { fail(res, e); }
		};
	}

	// The whole workspace in one response: folders and scenarios, each as a
	// posix path relative to scenarios/. The GUI builds its tree from these.
	router.get('/api/scenarios', guard(function (req, res) {
		const tree = walkScenarioTree(ctx.scenariosRoot);
		ctx.sendJson(res, 200, tree.scenarios.map(function (s) {
			return { name: s.name, path: s.path, hasMap: s.hasMap, files: s.files };
		}));
	}));

	// The same walk, plus the folders — what the list view actually renders.
	router.get('/api/scenario-tree', guard(function (req, res) {
		const tree = walkScenarioTree(ctx.scenariosRoot);
		ctx.sendJson(res, 200, {
			folders: tree.folders,
			scenarios: tree.scenarios.map(function (s) {
				return { name: s.name, path: s.path, hasMap: s.hasMap, files: s.files };
			})
		});
	}));

	// What the New-scenario dialog offers to start from: the built-in Basic and
	// Blank, plus every directory in examples/. The GUI never keeps its own copy
	// of this list — an example added to examples/ appears here on next load.
	router.get('/api/scenario-templates', guard(function (req, res) {
		ctx.sendJson(res, 200, {
			templates: listTemplates(),
			scenarios: listCopyableScenarios(ctx.scenariosRoot)
		});
	}));

	// Create a new scenario from a template. `parent` (optional) puts it inside
	// an existing folder; `template` (optional) defaults to 'basic'.
	router.post('/api/scenarios', guard(function (req, res) {
		const body = req.body || {};
		const name = (body.name || '').trim();
		const problem = badName(name);
		if (problem) { ctx.sendJson(res, 400, { error: problem }); return; }
		const parentDir = resolveParent(ctx.scenariosRoot, (body.parent || '').trim());
		const dir = path.join(parentDir, name);
		if (fs.existsSync(dir)) { ctx.sendJson(res, 409, { error: 'a scenario or folder named "' + name + '" already exists here' }); return; }
		createFromTemplate(dir, name, (body.template || '').trim() || 'basic', ctx.scenariosRoot);
		touch();
		const rel = path.relative(path.resolve(ctx.scenariosRoot), dir).split(path.sep).join('/');
		ctx.sendJson(res, 200, { name: name, path: rel });
	}));

	// Create an empty folder. `parent` (optional) nests it.
	router.post('/api/scenario-folders', guard(function (req, res) {
		const body = req.body || {};
		const name = (body.name || '').trim();
		const problem = badName(name);
		if (problem) { ctx.sendJson(res, 400, { error: problem }); return; }
		const parentDir = resolveParent(ctx.scenariosRoot, (body.parent || '').trim());
		const dir = path.join(parentDir, name);
		if (fs.existsSync(dir)) { ctx.sendJson(res, 409, { error: 'a scenario or folder named "' + name + '" already exists here' }); return; }
		fs.mkdirSync(dir, { recursive: true });
		touch();
		const rel = path.relative(path.resolve(ctx.scenariosRoot), dir).split(path.sep).join('/');
		ctx.sendJson(res, 200, { name: name, path: rel });
	}));

	// What a delete would take with it — the GUI asks before warning about a
	// non-empty folder, and shows the replay count for a scenario.
	router.get('/api/scenario-entry', guard(function (req, res) {
		const rel = req.query.get('path');
		const dir = resolveScenarioPath(ctx.scenariosRoot, rel);
		if (!fs.existsSync(dir)) { ctx.sendJson(res, 404, { error: 'not found' }); return; }
		if (isScenarioDir(dir)) {
			let recordings = 0;
			try {
				recordings = fs.readdirSync(path.join(dir, RECORDINGS_DIR_NAME), { withFileTypes: true })
					.filter(function (e) { return e.isDirectory(); }).length;
			} catch (e) { /* no recordings yet */ }
			ctx.sendJson(res, 200, { kind: 'scenario', path: rel, recordings: recordings });
			return;
		}
		const counts = countFolderContents(dir);
		ctx.sendJson(res, 200, { kind: 'folder', path: rel, folders: counts.folders, scenarios: counts.scenarios });
	}));

	// Rename a scenario or a folder in place. The directory IS the identity, so
	// this is a plain rename — recordings live inside it and come along.
	router.post('/api/scenario-entry/rename', guard(function (req, res) {
		const body = req.body || {};
		const from = resolveScenarioPath(ctx.scenariosRoot, body.path);
		const to = (body.name || '').trim();
		const problem = badName(to);
		if (problem) { ctx.sendJson(res, 400, { error: problem }); return; }
		if (!fs.existsSync(from)) { ctx.sendJson(res, 404, { error: 'not found' }); return; }
		const target = path.join(path.dirname(from), to);
		if (target === from) { ctx.sendJson(res, 200, { ok: true, path: body.path }); return; }
		// A case-only rename on Windows/macOS resolves to the same directory, so
		// existsSync would refuse it. Compare case-insensitively to spot that.
		if (fs.existsSync(target) && target.toLowerCase() !== from.toLowerCase()) {
			ctx.sendJson(res, 409, { error: 'a scenario or folder named "' + to + '" already exists here' }); return;
		}
		fs.renameSync(from, target);
		if (ctx.invalidateScenarioMaps) ctx.invalidateScenarioMaps(body.path);
		touch();
		const rel = path.relative(path.resolve(ctx.scenariosRoot), target).split(path.sep).join('/');
		ctx.sendJson(res, 200, { ok: true, path: rel });
	}));

	// Move a scenario or folder into another folder ('' = top level).
	router.post('/api/scenario-entry/move', guard(function (req, res) {
		const body = req.body || {};
		const from = resolveScenarioPath(ctx.scenariosRoot, body.path);
		if (!fs.existsSync(from)) { ctx.sendJson(res, 404, { error: 'not found' }); return; }
		const parentDir = resolveParent(ctx.scenariosRoot, (body.parent || '').trim());
		// Moving a folder into itself or its own descendant would detach the
		// subtree from the workspace, so refuse both.
		if (parentDir === from || parentDir.startsWith(from + path.sep)) {
			ctx.sendJson(res, 400, { error: 'a folder cannot be moved into itself' }); return;
		}
		const target = path.join(parentDir, path.basename(from));
		if (target === from) { ctx.sendJson(res, 200, { ok: true, path: body.path }); return; }
		if (fs.existsSync(target)) { ctx.sendJson(res, 409, { error: 'a scenario or folder named "' + path.basename(from) + '" already exists there' }); return; }
		const depth = path.relative(path.resolve(ctx.scenariosRoot), target).split(path.sep).length;
		if (depth > MAX_DEPTH) { ctx.sendJson(res, 400, { error: 'folders can only nest ' + MAX_DEPTH + ' deep' }); return; }
		fs.renameSync(from, target);
		if (ctx.invalidateScenarioMaps) ctx.invalidateScenarioMaps(body.path);
		touch();
		const rel = path.relative(path.resolve(ctx.scenariosRoot), target).split(path.sep).join('/');
		ctx.sendJson(res, 200, { ok: true, path: rel });
	}));

	// Delete a scenario (with its replays) or a folder (with everything in it).
	// The GUI confirms first, and warns separately when a folder is not empty;
	// `force` is how it says the user saw that warning. Deleting a non-empty
	// folder without it is refused here too, so the API cannot be the easy way
	// to lose a subtree.
	router.del('/api/scenario-entry', guard(function (req, res) {
		const rel = req.query.get('path');
		const dir = resolveScenarioPath(ctx.scenariosRoot, rel);
		if (!fs.existsSync(dir)) { ctx.sendJson(res, 404, { error: 'not found' }); return; }
		if (!isScenarioDir(dir)) {
			const counts = countFolderContents(dir);
			const empty = counts.folders === 0 && counts.scenarios === 0;
			if (!empty && req.query.get('force') !== '1') {
				ctx.sendJson(res, 409, {
					error: 'folder is not empty',
					folders: counts.folders,
					scenarios: counts.scenarios
				});
				return;
			}
		}
		fs.rmSync(dir, { recursive: true, force: true });
		if (ctx.invalidateScenarioMaps) ctx.invalidateScenarioMaps(rel);
		touch();
		ctx.sendJson(res, 200, { ok: true });
	}));
};

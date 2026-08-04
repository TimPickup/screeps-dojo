'use strict';

const fs = require('fs');
const path = require('path');
const { pathSafe } = require('../pathSafe');
const { createFromTemplate } = require('../scaffold');

// Governs names the GUI will CREATE, keeping new scenario directories tidy.
// Deliberately NOT applied when reading: the listing below shows any directory
// holding a scenario.js, whatever it is called, and the recordings filter has to
// accept those same names (see resolveScenarioDir in src/recording.js).
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// A directory read reports a symlink as a link, whereas the statSync these
// replace followed it to its target. Keep that behaviour — a scenario symlinked
// in from elsewhere must still list — but make only symlinks pay for a stat.
function isDirEntry(entry, full) {
	if (entry.isDirectory()) return true;
	if (!entry.isSymbolicLink()) return false;
	try { return fs.statSync(full).isDirectory(); } catch (e) { return false; }
}

function isFileEntry(entry, full) {
	if (entry.isFile()) return true;
	if (!entry.isSymbolicLink()) return false;
	try { return fs.statSync(full).isFile(); } catch (e) { return false; }
}

// Lists top-level files in a scenario dir (scenario dirs are flat: scenario.js,
// map*.json, main.js, memory.json, ...). Skips dotfiles and nested dirs.
// Takes the already-read directory entries: withFileTypes answers "is this a
// file?" from the read itself, so a scenario holding 30 maps costs one syscall
// rather than thirty-one.
function listFiles(dir, entries) {
	const out = [];
	for (const entry of entries) {
		if (entry.name[0] === '.') continue;
		if (!isFileEntry(entry, path.join(dir, entry.name))) continue;
		out.push(entry.name);
	}
	return out.sort();
}

module.exports = function registerScenarioRoutes(router, ctx) {
	// One directory read per scenario, and one for the root. The shape this
	// replaced cost a statSync per scenario, an existsSync for scenario.js and a
	// statSync per file inside — which on a Docker bind mount, where each syscall
	// costs milliseconds, was seconds of latency before the list appeared.
	router.get('/api/scenarios', function (req, res) {
		// Route handlers run synchronously (src/server/index.js) and the process
		// installs no uncaughtException handler, so a throw from here would take
		// the server down. Everything is caught and reported as a 500.
		try {
			const root = ctx.scenariosRoot;
			const out = [];
			let top;
			try {
				top = fs.readdirSync(root, { withFileTypes: true });
			} catch (e) {
				// No scenarios directory at all is a legitimate empty state; a
				// permissions or I/O failure is not, and must not be shown to the
				// user as "No scenarios. Copy one from examples/…".
				if (e && e.code !== 'ENOENT') throw e;
				top = [];
			}
			top.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
			for (const entry of top) {
				const dir = path.join(root, entry.name);
				if (!isDirEntry(entry, dir)) continue;
				let entries;
				// one unreadable scenario should not blank the whole list
				try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
				const files = listFiles(dir, entries);
				if (!files.includes('scenario.js')) continue;
				const hasMap = files.some(function (f) { return /map.*\.json$/i.test(f); });
				out.push({ name: entry.name, hasMap: hasMap, files: files });
			}
			ctx.sendJson(res, 200, out);
		} catch (e) {
			ctx.sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
		}
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

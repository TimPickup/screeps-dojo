'use strict';

const fs = require('fs');
const path = require('path');
const { walkScenarioTree, resolveScenarioPath } = require('../scenarioTree');

const REPO_ROOT = path.join(__dirname, '..', '..');

// The two hand-written starting points. Editing the files under templates/
// changes what every new scenario of that kind starts from.
//
//   basic — a committed snapshot of a working two-room economy + combat demo
//           (spawn + RCL-1 controller + sources in W1N1, an unclaimed
//           controller in the connected W0N1, an invader to fight).
//   blank — scenario.js alone: the contract, heavily commented, nothing placed.
const BUILTIN_TEMPLATES = [
	{
		id: 'basic',
		name: 'Basic',
		dir: path.join(REPO_ROOT, 'templates', 'new-scenario'),
		description: 'Two connected rooms, your spawn, sources, a controller to grow to RCL 2, an invader to fight, and a small bundled bot. Runs as-is.'
	},
	{
		id: 'blank',
		name: 'Blank',
		dir: path.join(REPO_ROOT, 'templates', 'blank'),
		description: 'Just scenario.js, commented through: loading maps, seeding Memory, placing creeps, and the optional until()/expect() hooks. Add a room in the Edit tab before it will run.'
	}
];

const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');

// The `//` block at the top of a scenario.js, minus 'use strict' and the
// __SCENARIO_NAME__ header line, as one sentence. Reading it here means an
// example added to examples/ shows up in the GUI with its own description and
// nobody has to maintain a second copy of that text.
function describeFromSource(file) {
	let text;
	try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
	const lines = [];
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line || line === "'use strict';") { if (lines.length) break; continue; }
		if (line.slice(0, 2) !== '//') break;
		const body = line.slice(2).trim();
		if (!body) { if (lines.length) break; continue; }
		if (body.indexOf('__SCENARIO_NAME__') !== -1) continue;
		lines.push(body);
		// One or two lines is a description; the rest is the file's own preamble.
		if (lines.length >= 2) break;
	}
	return lines.join(' ');
}

function isScenarioTemplateDir(dir) {
	try { return fs.statSync(path.join(dir, 'scenario.js')).isFile(); } catch (e) { return false; }
}

// The user's own scenarios, offered as "copy this one". Far more useful in
// practice than the examples — your own scenarios are the real starting
// points — so the GUI offers them as a second picker rather than mixing
// dozens of entries into the first one. `scenariosRoot` is passed in because
// tests point it somewhere else.
function listCopyableScenarios(scenariosRoot) {
	if (!scenariosRoot) return [];
	let tree;
	try { tree = walkScenarioTree(scenariosRoot); } catch (e) { return []; }
	return tree.scenarios.map(function (scenario) {
		const cut = scenario.path.lastIndexOf('/');
		return {
			id: 'scenario:' + scenario.path,
			name: scenario.name,
			// '' is the top level — the GUI shows it as its own group heading.
			group: cut === -1 ? '' : scenario.path.slice(0, cut),
			path: scenario.path
		};
	});
}

// Every template the GUI may offer: the built-ins, then each example. Example
// ids are prefixed so they can never collide with a built-in.
function listTemplates() {
	const out = [];
	for (const tpl of BUILTIN_TEMPLATES) {
		if (!isScenarioTemplateDir(tpl.dir)) continue;
		out.push({ id: tpl.id, name: tpl.name, group: 'Start from', description: tpl.description });
	}
	let entries = [];
	try { entries = fs.readdirSync(EXAMPLES_DIR, { withFileTypes: true }); } catch (e) { entries = []; }
	entries.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
	for (const entry of entries) {
		if (entry.name[0] === '.' || !entry.isDirectory()) continue;
		const dir = path.join(EXAMPLES_DIR, entry.name);
		if (!isScenarioTemplateDir(dir)) continue;
		out.push({
			id: 'example:' + entry.name,
			name: entry.name,
			group: 'Copy an example',
			description: describeFromSource(path.join(dir, 'scenario.js'))
		});
	}
	return out;
}

// Resolves a template id to the directory it copies from. Example ids are
// matched against the listing rather than joined onto a path, and a
// scenario: id goes through the same containment check every other scenario
// path does, so a crafted id cannot name a directory outside examples/ or
// scenarios/.
function resolveTemplateDir(id, scenariosRoot) {
	const wanted = id || 'basic';
	for (const tpl of BUILTIN_TEMPLATES) {
		if (tpl.id === wanted) return tpl.dir;
	}
	if (wanted.slice(0, 8) === 'example:') {
		const name = wanted.slice(8);
		for (const tpl of listTemplates()) {
			if (tpl.id === wanted) return path.join(EXAMPLES_DIR, name);
		}
	}
	if (wanted.slice(0, 9) === 'scenario:' && scenariosRoot) {
		const dir = resolveScenarioPath(scenariosRoot, wanted.slice(9));
		if (isScenarioTemplateDir(dir)) return dir;
	}
	const err = new Error('unknown template: ' + wanted);
	err.statusCode = 400;
	throw err;
}

// Copies a template into targetDir, substituting the scenario name into
// scenario.js's header comment. Top-level FILES only — an example (or a
// scenario you are duplicating) that has a recordings/ directory must not drag
// it along.
function createFromTemplate(targetDir, name, templateId, scenariosRoot) {
	const sourceDir = resolveTemplateDir(templateId, scenariosRoot);
	fs.mkdirSync(targetDir, { recursive: true });
	for (const file of fs.readdirSync(sourceDir)) {
		const src = path.join(sourceDir, file);
		if (!fs.statSync(src).isFile()) continue;
		if (file === 'scenario.js') {
			const text = fs.readFileSync(src, 'utf8').replace(/__SCENARIO_NAME__/g, name);
			fs.writeFileSync(path.join(targetDir, file), text, 'utf8');
		} else {
			fs.copyFileSync(src, path.join(targetDir, file));
		}
	}
}

module.exports = {
	createFromTemplate: createFromTemplate,
	listTemplates: listTemplates,
	listCopyableScenarios: listCopyableScenarios,
	resolveTemplateDir: resolveTemplateDir,
	TEMPLATE_DIR: BUILTIN_TEMPLATES[0].dir
};

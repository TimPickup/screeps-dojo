'use strict';

// Optional per-scenario overrides: scenarios/<name>/settings.json.
//
//   { "bot": "speedrun", "bots": { "enemy": "default" }, "server": "season" }
//
// "bot" is shorthand for bots.main. Values are profile NAMES, never paths: a
// host path that was not bind-mounted when the container was created is
// unreadable from inside it, so accepting one could only fail confusingly.
//
// An absent file means "inherit everything" and is the normal case, so load()
// costs one readFile and never throws for ENOENT.
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'settings.json';
const KNOWN_KEYS = ['bot', 'bots', 'server'];
const MAIN_SIDE = 'main';
const SIDE_RE = /^[a-z0-9][a-z0-9_-]*$/;

function filePath(scenarioDir) { return path.join(scenarioDir, FILE_NAME); }

// { settings, warnings } — warnings are non-fatal (unknown keys), so a typo
// surfaces in the live console and the recording instead of killing the run.
function validate(raw, label) {
	const where = label ? label + ': ' : '';
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error(where + 'expected a JSON object');
	}
	const warnings = [];
	for (const key of Object.keys(raw)) {
		if (!KNOWN_KEYS.includes(key)) warnings.push(where + 'unknown setting "' + key + '" (known: ' + KNOWN_KEYS.join(', ') + ')');
	}

	const bots = {};
	if (raw.bots !== undefined) {
		if (raw.bots === null || typeof raw.bots !== 'object' || Array.isArray(raw.bots)) {
			throw new Error(where + '"bots" must be an object of side -> profile name');
		}
		for (const side of Object.keys(raw.bots)) {
			if (!SIDE_RE.test(side)) throw new Error(where + 'invalid side name "' + side + '"');
			if (typeof raw.bots[side] !== 'string' || !raw.bots[side]) {
				throw new Error(where + '"bots.' + side + '" must be a non-empty profile name');
			}
			bots[side] = raw.bots[side].toLowerCase();
		}
	}
	if (raw.bot !== undefined) {
		if (typeof raw.bot !== 'string' || !raw.bot) throw new Error(where + '"bot" must be a non-empty profile name');
		if (bots[MAIN_SIDE] !== undefined) {
			throw new Error(where + 'declare either "bot" or "bots.' + MAIN_SIDE + '", not both');
		}
		bots[MAIN_SIDE] = raw.bot.toLowerCase();
	}
	if (raw.server !== undefined && (typeof raw.server !== 'string' || !raw.server)) {
		throw new Error(where + '"server" must be a non-empty profile name');
	}

	const settings = { bots: bots };
	if (raw.server !== undefined) settings.server = raw.server.toLowerCase();
	return { settings: settings, warnings: warnings };
}

// Never throws for a missing file; a scenario without settings.json is normal.
function load(scenarioDir) {
	const file = filePath(scenarioDir);
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (e) {
		if (e && e.code === 'ENOENT') return { settings: { bots: {} }, warnings: [], present: false };
		throw e;
	}
	const label = path.basename(scenarioDir) + '/' + FILE_NAME;
	let raw;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		throw new Error(label + ': invalid JSON — ' + String((e && e.message) || e));
	}
	const validated = validate(raw, label);
	validated.present = true;
	return validated;
}

// Writing is deliberately not here: settings.json is saved through the ordinary
// scenario file route like any other file, so there is exactly one write path.
// The editor mirrors validate() in ui/src/components/ScenarioSettingsEditor.
module.exports = {
	FILE_NAME: FILE_NAME,
	KNOWN_KEYS: KNOWN_KEYS,
	MAIN_SIDE: MAIN_SIDE,
	SIDE_RE: SIDE_RE,
	filePath: filePath,
	validate: validate,
	load: load
};

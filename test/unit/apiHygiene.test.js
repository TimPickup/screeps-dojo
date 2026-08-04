'use strict';

// Keeps the SHARED, committed surface — the files a new scenario is copied
// from — free of raw server pokes that skip DojoWorld's facade. A scenario
// author's own scenarios/ is git-ignored and personal, so it is deliberately
// NOT scanned here (the runtime warning in src/serverBoot.js covers those);
// this guards what everyone else starts from.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// Directories whose contents are committed and copied by users.
const SCANNED = ['examples', 'templates', 'test'];

// pattern -> what to do instead. Add to this list as the facade grows a
// replacement. Reads (find/findOne) are deliberately NOT banned: asserting on
// the raw db is exactly what a test should do.
const BANNED = [
	{
		pattern: /\.world\.addRoomObject\s*\(/,
		use: 'world.addObject(room, type, x, y, attrs) — the raw call skips type '
			+ 'defaults, owner resolution, decay/regen clocks and room activation'
	},
	{
		pattern: /\[['"]rooms\.objects['"]\]\s*\.\s*update\s*\(/,
		use: 'world.updateObject(query, changes) — a raw update leaves the room '
			+ 'dormant, so the engine never processes the change'
	},
	{
		pattern: /\[['"]rooms\.objects['"]\]\s*\.\s*(remove|removeWhere)\s*\(/,
		use: 'world.removeObject(query) — a raw delete leaves the room dormant, so '
			+ 'the engine never notices the object is gone'
	}
];

function jsFilesUnder(dir, found) {
	const abs = path.join(ROOT, dir);
	if (!fs.existsSync(abs)) return found;
	for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
		const rel = path.join(dir, entry.name);
		if (entry.isDirectory()) jsFilesUnder(rel, found);
		else if (entry.name.endsWith('.js')) found.push(rel);
	}
	return found;
}

describe('API hygiene', function () {
	it('committed scenarios and tests use the DojoWorld facade, not the raw server', function () {
		const offences = [];
		for (const file of jsFilesUnder('', []).filter(function (f) {
			return SCANNED.some(function (dir) { return f.startsWith(dir + path.sep); });
		})) {
			// this file names the patterns it bans, so it can never be clean
			if (file.endsWith('apiHygiene.test.js')) continue;
			const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
			lines.forEach(function (line, i) {
				// Deliberate raw access — a test for the guard itself, or a suite
				// that drives the bare server on purpose — opts out by saying so on
				// the line or the one above it.
				const exempt = /raw-access-ok/.test(line) || (i > 0 && /raw-access-ok/.test(lines[i - 1]));
				if (exempt) return;
				for (const banned of BANNED) {
					if (banned.pattern.test(line)) {
						offences.push(file + ':' + (i + 1) + '\n      use ' + banned.use);
					}
				}
			});
		}
		assert.deepStrictEqual(offences, [],
			'raw server access in committed files:\n    ' + offences.join('\n    '));
	});
});

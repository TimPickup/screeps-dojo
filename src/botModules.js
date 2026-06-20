'use strict';

// Reads bot code from the read-only /bot mount as { moduleName: sourceString }
// for upload into the game VM (spec §4). allBotModules() is the mini-sim path:
// the entire live codebase with its real main.js.
const fs = require('fs');
const path = require('path');

const DEFAULT_BOT_DIR = process.env.DOJO_BOT_DIR || '/bot';

function loadBotModules(names, botDir) {
	const dir = botDir || DEFAULT_BOT_DIR;
	const modules = {};
	for (const name of names) {
		const file = path.join(dir, name + '.js');
		try {
			modules[name] = fs.readFileSync(file, 'utf8');
		} catch (error) {
			throw new Error('bot module not found or unreadable: ' + name + ' (' + file + '): ' + error.message);
		}
	}
	return modules;
}

function allBotModules(overrides, botDir) {
	const dir = botDir || DEFAULT_BOT_DIR;
	const modules = {};
	for (const file of fs.readdirSync(dir)) {
		if (!file.endsWith('.js')) continue;
		const fullPath = path.join(dir, file);
		if (!fs.statSync(fullPath).isFile()) continue;
		modules[path.basename(file, '.js')] = fs.readFileSync(fullPath, 'utf8');
	}
	return Object.assign(modules, overrides || {});
}

module.exports = { loadBotModules: loadBotModules, allBotModules: allBotModules };

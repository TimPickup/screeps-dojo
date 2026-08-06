'use strict';

// Reads bot code from a mounted bot profile as { moduleName: sourceString } for
// upload into the game VM (spec §4). allBotModules() is the mini-sim path: the
// entire live codebase with its real main.js.
//
// WHICH codebase that is comes from the run's side context, installed by
// src/scenarioRunner.js from the scenario's settings.json before scenario.js is
// required. Resolution happens per CALL, not at module load, because
// test/scenarios.test.js runs every scenario in one process — a directory
// captured at require time would leak the first scenario's bot into the rest.
const fs = require('fs');
const path = require('path');
const botProfiles = require('./botProfiles');

// side -> container dir, e.g. { main: '/bots/speedrun', enemy: '/bots/default' }
let sides = null;

function setSides(resolved) { sides = resolved || null; }
function clearSides() { sides = null; }

// Container directory for a named side. `main` is the scenario's own bot and is
// what allBotModules() uses when given no directory.
function botDir(side) {
	const name = String(side || 'main').toLowerCase();
	if (sides && Object.prototype.hasOwnProperty.call(sides, name)) return sides[name];
	if (name === 'main') return botProfiles.implicitDir(process.env);
	throw new Error('no bot configured for side "' + name + '" — add it to the scenario\'s '
		+ 'settings.json, e.g. { "bots": { "' + name + '": "default" } }');
}

function resolveDir(botDirArg) {
	return botDirArg || botDir('main');
}

function loadBotModules(names, botDirArg) {
	const dir = resolveDir(botDirArg);
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

function allBotModules(overrides, botDirArg) {
	const dir = resolveDir(botDirArg);
	const modules = {};
	let entries;
	try {
		entries = fs.readdirSync(dir);
	} catch (error) {
		throw new Error('bot directory not readable: ' + dir + ': ' + error.message);
	}
	for (const file of entries) {
		if (!file.endsWith('.js')) continue;
		const fullPath = path.join(dir, file);
		if (!fs.statSync(fullPath).isFile()) continue;
		modules[path.basename(file, '.js')] = fs.readFileSync(fullPath, 'utf8');
	}
	return Object.assign(modules, overrides || {});
}

module.exports = {
	loadBotModules: loadBotModules,
	allBotModules: allBotModules,
	botDir: botDir,
	setSides: setSides,
	clearSides: clearSides
};

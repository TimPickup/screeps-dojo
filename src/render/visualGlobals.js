'use strict';

// Installs the globals lib/RoomVisual.js expects when loaded OUTSIDE the game
// VM (Node renderer now, browser editor in Plan 3): game constants, a minimal
// lodash shim (the lib only uses _.some), and Game.time.
const constants = require('@screeps/common/lib/constants');

let installed = false;

function installVisualGlobals(RoomVisualClass) {
	global.RoomVisual = RoomVisualClass;
	if (installed) return;
	installed = true;
	for (const key of Object.keys(constants)) {
		if (key.startsWith('STRUCTURE_') || key.startsWith('RESOURCE_')
			|| key === 'OK' || key === 'ERR_INVALID_ARGS') {
			global[key] = constants[key];
		}
	}
	if (!global._) {
		global._ = {
			some: function (collection, predicate) { return collection.some(predicate); }
		};
	}
	if (!global.Game) global.Game = { time: 0 };
}

module.exports = { installVisualGlobals: installVisualGlobals };

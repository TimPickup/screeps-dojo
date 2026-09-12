'use strict';

// The smallest complete scenario: one room, one creep, one goal flag. Every
// required piece of the scenario.js contract and nothing else.
const fs = require('fs');
const path = require('path');

module.exports = {
	modules: {
		main: fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
	},
	maxTicks: 100,
	setup: async function (world) {
		// Loads every map.*.json in this directory and puts the bot's spawn at
		// { room, x, y }. One room here, but the call is the same for fifty.
		await world.loadAllMaps({ room: 'W0N0', x: 5, y: 2 });
		await world.addCreep({ room: 'W0N0', x: 5, y: 25, name: 'T', body: ['move'] });
	},
	until: function (state) {
		const creep = state.creeps.T;
		if (!creep) return true; // died -> end (expect() will fail on survival)
		const goal = state.flags.goal;
		if (!goal) return false;
		return creep.x === goal.x && creep.y === goal.y;
	},
	expect: function (result, assert) {
		assert.strictEqual(result.endReason, 'until', 'should reach the goal, got ' + result.endReason);
		assert.ok(result.survived.T, 'creep should survive');
		assert.ok(result.ticks < 60, 'straight walk should take well under 60 ticks, took ' + result.ticks);
	}
};

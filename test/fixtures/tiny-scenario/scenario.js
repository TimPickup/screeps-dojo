'use strict';

// Tiny, fully self-contained scenario for unit-testing the runner's options
// (events / cooperative abort / runExpect). No dependency on the /bot mount or
// any external map file: the bot module and the map are both inline, and the
// creep walks 3 tiles to a flag so the run finishes in a handful of ticks.
const fs = require('fs');
const path = require('path');

function flatRoom() {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) {
			row += (x === 0 || x === 49 || y === 0 || y === 49) ? '#' : '.';
		}
		rows.push(row);
	}
	return rows;
}

module.exports = {
	modules: {
		main: fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
	},
	maxTicks: 15,
	setup: async function (world) {
		const map = {
			room: 'W0N0',
			terrain: flatRoom(),
			structures: [],
			flags: [{ name: 'goal', x: 5, y: 8 }]
		};
		await world.loadScenarioMaps([map], { room: 'W0N0', x: 5, y: 2 });
		await world.addCreep({ room: 'W0N0', x: 5, y: 5, name: 'T', body: ['move'] });
	},
	until: function (state) {
		const creep = state.creeps.T;
		if (!creep) return true;
		const goal = state.flags.goal;
		if (!goal) return false;
		return creep.x === goal.x && creep.y === goal.y;
	},
	expect: function (result, assert) {
		assert.strictEqual(result.endReason, 'until', 'should reach the goal, got ' + result.endReason);
		assert.ok(result.survived.T, 'creep should survive');
	}
};

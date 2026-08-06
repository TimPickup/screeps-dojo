'use strict';

// Proves the runner resolves bot profiles from settings.json: `modules` is a
// FUNCTION so it re-evaluates per run (an object literal would be frozen by the
// require cache after the first run, hiding a per-scenario switch), and it takes
// whatever main.js the resolved profile holds. The bot logs its own name every
// tick, so result.console says which codebase ran.
const { allBotModules, botDir } = require('../../../src/botModules');

function flatRoom() {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) row += (x === 0 || x === 49 || y === 0 || y === 49) ? '#' : '.';
		rows.push(row);
	}
	return rows;
}

module.exports = {
	modules: function () { return allBotModules(); },
	// exposed for the test: the directory each side resolved to this run
	resolvedDirs: function () { return { main: botDir('main'), enemy: botDir('enemy') }; },
	maxTicks: 2,
	setup: async function (world) {
		await world.loadScenarioMaps([{
			room: 'W0N0', terrain: flatRoom(), structures: [], flags: []
		}], { room: 'W0N0', x: 5, y: 2 });
		await world.addCreep({ room: 'W0N0', x: 5, y: 5, name: 'T', body: ['move'] });
	},
	expect: function (result, assert) {
		assert.ok(result.console.some(function (line) { return String(line).indexOf('bot:') !== -1; }),
			'the resolved bot should have logged its name');
	}
};

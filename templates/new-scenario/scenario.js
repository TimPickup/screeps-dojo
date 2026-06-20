'use strict';

// Scenario: __SCENARIO_NAME__
// A two-room sandbox: room W1N1 has our spawn + level-1 controller + 2 sources,
// room W2N1 (just west) has an unclaimed controller + 2 sources, connected by
// an exit on their shared edge. Edit the maps in the Edit tab, then Run / Test.

const fs = require('fs');
const path = require('path');
// const { allBotModules } = require('../../src/botModules');

function loadMap(room) {
	return JSON.parse(fs.readFileSync(path.join(__dirname, 'map.' + room + '.json'), 'utf8'));
}

module.exports = {
	// Code uploaded into the game VM. Use a local main.js, OR pull your real
	// modules with allBotModules() to run your whole bot.
	modules: {
		main: fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
	},
	// modules: allBotModules(),

	maxTicks: 500,

	setup: async function (world) {
		// Load both rooms. The bot's spawn goes at { room, x, y }.
		await world.loadScenarioMaps([loadMap('W1N1'), loadMap('W0N1')], { room: 'W1N1', x: 25, y: 25 });

		// Make sure the starting spawn is full (300/300 energy):
		const { db } = await world.world.load();
		await db['rooms.objects'].update({ room: 'W1N1', type: 'spawn' },
			{ $set: { store: { energy: 300 }, storeCapacityResource: { energy: 300 } } });

		// A starter worker creep next to the spawn:
		await world.addCreep({ room: 'W1N1', x: 26, y: 25, name: 'A', body: ['move', 'work', 'carry'] });

		//add an invader
		await world.addCreep({room: 'W0N1', x: 30, y: 25, name: 'invader1', body: ['ranged_attack','attack','move','move'], user: 2 });

		// Add a flag for the bot to target:
		// await world.addFlag({ room: 'W0N1', x: 25, y: 25, name: 'goal' });
	},

	until: function (state) {
		// end as soon as our room controller reaches RCL 2
		const ctrl = state.objects.find(function (o) { return o.type === 'controller' && o.room === 'W1N1'; });
		return !!(ctrl && ctrl.level >= 2);
	},

	expect: function (result, assert) {
		const ctrl = result.finalState.objects.find(function (o) { return o.type === 'controller' && o.room === 'W1N1'; });
		const rcl = ctrl ? ctrl.level : 0;
		assert.ok(rcl >= 2, 'controller should reach RCL 2, got ' + rcl);
		const creepCount = Object.keys(result.finalState.creeps).length;
		assert.ok(creepCount > 1, 'should have more than 1 creep, got ' + creepCount);
	}
};

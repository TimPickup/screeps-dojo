'use strict';

// Season 5, step 1: MINING Thorium.
//
// The narrow one — no reactor, no scoring, just a creep pulling Thorium out of
// the ground so a failure here is unambiguous. `season5-thorium-chain` is the
// same mining plus the transport and the reactor.
const fs = require('fs');
const path = require('path');

module.exports = {
	modules: {
		main: fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
	},
	maxTicks: 120,
	setup: async function (world) {
		// The controller is RCL 6 in the map on purpose: below that the engine
		// zeroes an extractor, and the mineral simply cannot be harvested.
		// The map's own owner:'me' spawn is adopted as the bot's home.
		await world.loadAllMaps();
		await world.addCreep({
			room: 'W0N0', x: 11, y: 11, name: 'miner',
			body: ['work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'carry', 'carry', 'move', 'move']
		});
	},
	until: function (state) {
		return thoriumIn(state, 'container') >= 40;
	},
	expect: function (result, assert) {
		const state = result.finalState;
		const mineral = state.objects.find(function (o) { return o.type === 'mineral'; });
		assert.ok(mineral, 'the Thorium deposit should still be there');
		assert.strictEqual(mineral.mineralType, 'T');

		// Thorium is finite: what came out of the ground is gone from it.
		assert.ok(mineral.mineralAmount < 5000,
			'mining should have drawn the deposit down, still at ' + mineral.mineralAmount);
		// ...and it must never be scheduled to come back.
		assert.strictEqual(mineral.nextRegenerationTime, undefined,
			'Thorium does not regenerate — it should carry no regeneration deadline');

		const mined = 5000 - mineral.mineralAmount;
		const held = thoriumIn(state, 'container') + thoriumIn(state, 'creep');
		assert.strictEqual(held, mined,
			'every unit mined should be accounted for: ' + mined + ' out of the ground, ' + held + ' held');

		assert.strictEqual(result.endReason, 'until',
			'the container should reach 40 Thorium; ended on ' + result.endReason
			+ ' after ' + result.ticks + ' ticks with ' + thoriumIn(state, 'container'));
	}
};

// Total Thorium held by every object of a type.
function thoriumIn(state, type) {
	let total = 0;
	for (const object of state.objects) {
		if (object.type !== type || !object.store) continue;
		total += object.store.T || 0;
	}
	return total;
}

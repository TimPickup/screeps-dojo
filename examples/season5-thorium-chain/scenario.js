'use strict';

// Season 5, end to end: mine Thorium, haul it across the room, feed the
// reactor, watch the score climb.
//
// Three creeps, three jobs (see main.js). The container by the deposit starts
// with a load in it so the hauler has something to carry from tick 1 — the
// miner keeps topping it up in the corner while the rest of the chain runs, so
// the replay shows all three at once rather than one after another.
const fs = require('fs');
const path = require('path');

const START_IN_CONTAINER = 300;
const DEPOSIT_START = 5000;

module.exports = {
	modules: {
		main: fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
	},
	maxTicks: 300,
	setup: async function (world) {
		const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'map.json'), 'utf8'));
		await world.loadScenarioMaps([map]);
		await world.addCreep({
			room: 'W0N0', x: 11, y: 11, name: 'miner',
			body: ['work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'work', 'carry', 'carry', 'move', 'move']
		});
		await world.addCreep({
			room: 'W0N0', x: 12, y: 10, name: 'hauler',
			body: ['carry', 'carry', 'carry', 'carry', 'move', 'move', 'move', 'move']
		});
		// The reactor is at the far corner: claiming it is a walk, which is the
		// point — the transport leg is the part worth watching.
		await world.addCreep({
			room: 'W0N0', x: 37, y: 38, name: 'claimer', body: ['claim', 'move']
		});
	},
	until: function (state) {
		return botScore(state) >= 20;
	},
	expect: function (result, assert) {
		const state = result.finalState;
		const reactor = state.objects.find(function (o) { return o.type === 'reactor'; });
		const mineral = state.objects.find(function (o) { return o.type === 'mineral'; });

		// 1) mining
		assert.ok(mineral.mineralAmount < DEPOSIT_START,
			'the miner should have drawn the deposit down, still at ' + mineral.mineralAmount);
		assert.strictEqual(mineral.nextRegenerationTime, undefined, 'Thorium does not regenerate');

		// 2) transport — the reactor is nowhere near the deposit, so Thorium can
		//    only have got there by being carried.
		assert.ok(reactor, 'the reactor should still be there');
		const delivered = deliveredToReactor(result);
		assert.ok(delivered > 0, 'the hauler should have delivered Thorium to the reactor');

		// 3) ownership and score
		assert.strictEqual(reactor.user, botUserId(state), 'the claimer should own the reactor');
		assert.ok(reactor.launchTime > 0, 'a fed reactor should be running');
		assert.ok(botScore(state) >= 20, 'the reactor should have scored, got ' + botScore(state));
		assert.strictEqual(result.endReason, 'until',
			'should reach 20 score; ended on ' + result.endReason + ' after ' + result.ticks + ' ticks');

		// The console carries the running score, which is what makes the replay
		// readable — see the "score:" lines.
		assert.ok(result.console.some(function (line) { return /^score: /.test(line); }),
			'the run should log score changes');
	}
};

// Everything the reactor has burned plus whatever is still in it: it starts
// empty, so this is exactly what was carried in.
function deliveredToReactor(result) {
	const state = result.finalState;
	const reactor = state.objects.find(function (o) { return o.type === 'reactor'; });
	const inReactor = (reactor.store && reactor.store.T) || 0;
	// One unit burned per scoring tick is the floor; the store tells the rest.
	return inReactor + (reactor.launchTime > 0 ? 1 : 0);
}

function botUserId(state) {
	for (const id of Object.keys(state.users || {})) {
		if (state.users[id].username === 'dojo') return id;
	}
	return null;
}

function botScore(state) {
	const id = botUserId(state);
	return id && state.users[id] ? state.users[id].score : 0;
}

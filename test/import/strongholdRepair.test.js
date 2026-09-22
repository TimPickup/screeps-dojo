'use strict';

const assert = require('assert');
const { planStrongholdRepair, matchBody, matchBehavior } = require('../../src/import/strongholdRepair');

function core(fields) {
	return Object.assign({ _id: 'core1', type: 'invaderCore', room: 'E26S25', level: 3 }, fields);
}
function defender(index, body, fields) {
	return Object.assign({
		_id: 'c' + index, type: 'creep', room: 'E26S25', user: '2', name: 'defender' + index,
		body: body || new Array(25).fill({ type: 'attack' }).concat(new Array(25).fill({ type: 'move' }))
	}, fields);
}

describe('planStrongholdRepair', function () {
	it('does nothing without an invader core', function () {
		const plan = planStrongholdRepair('E26S25', null, [defender(0)]);
		assert.strictEqual(plan.core, null);
		assert.deepStrictEqual(plan.creeps, []);
	});

	it('leaves a stronghold that already carries every field alone', function () {
		const existing = core({ strongholdId: 'sid', strongholdBehavior: 'bunker3', population: [{}] });
		const plan = planStrongholdRepair('E26S25', existing, [defender(0, null, { strongholdId: 'sid' })]);
		assert.strictEqual(plan.core, null);
		assert.deepStrictEqual(plan.creeps, []);
		assert.deepStrictEqual(plan.warnings, []);
	});

	it('mints a strongholdId and hands it to the garrison', function () {
		const plan = planStrongholdRepair('E26S25',
			core({ strongholdBehavior: 'bunker3', population: [{}] }), [defender(0), defender(1)]);
		assert.strictEqual(plan.core.strongholdId, 'E26S25_imported');
		assert.deepStrictEqual(plan.creeps.map(entry => entry.patch),
			[{ strongholdId: 'E26S25_imported' }, { strongholdId: 'E26S25_imported' }]);
	});

	it('derives strongholdBehavior from templateName, then from level', function () {
		const fromTemplate = planStrongholdRepair('E26S25',
			core({ templateName: 'bunker4', level: 4 }), []);
		assert.strictEqual(fromTemplate.core.strongholdBehavior, 'bunker4');
		const fromLevel = planStrongholdRepair('E26S25', core({ level: 5 }), []);
		assert.strictEqual(fromLevel.core.strongholdBehavior, 'bunker5');
	});

	it('warns and gives up when no behavior can be derived', function () {
		const plan = planStrongholdRepair('E26S25', core({ level: 9 }), [defender(0)]);
		assert.strictEqual(plan.core, null);
		assert.match(plan.warnings[0], /no strongholdBehavior/);
	});

	// The core's behavior only drives creeps it can find by name, and only
	// through population — a missing population means nothing moves at all.
	it('rebuilds population from the defenders that were imported', function () {
		const plan = planStrongholdRepair('E26S25',
			core({ strongholdId: 'sid', strongholdBehavior: 'bunker3' }),
			[defender(0, null, { strongholdId: 'sid' }), defender(1, null, { strongholdId: 'sid' })]);
		assert.deepStrictEqual(plan.core.population, [
			{ body: 'fullDefender', behavior: 'simple-melee' },
			{ body: 'fullDefender', behavior: 'simple-melee' }
		]);
	});

	it('keeps the index gap left by a defender that died on the live server', function () {
		const plan = planStrongholdRepair('E26S25',
			core({ strongholdId: 'sid', strongholdBehavior: 'bunker3' }),
			[defender(2, null, { strongholdId: 'sid' })]);
		assert.strictEqual(plan.core.population.length, 3);
		assert.strictEqual(plan.core.population[2].behavior, 'simple-melee');
	});

	it('warns about an NPC creep the core can never bind by name', function () {
		const stray = defender(0, null, { name: 'invader_12345', strongholdId: 'sid' });
		const plan = planStrongholdRepair('E26S25',
			core({ strongholdId: 'sid', strongholdBehavior: 'bunker3' }), [stray]);
		assert.match(plan.warnings[0], /not named defender<n>/);
	});

	it('skips a core still counting down to deploy', function () {
		const plan = planStrongholdRepair('E26S25', core({ deployTime: 4200 }), [defender(0)]);
		assert.strictEqual(plan.core, null);
	});
});

describe('garrison body matching', function () {
	const attackMove = (attack, move) => new Array(attack).fill({ type: 'attack' })
		.concat(new Array(move).fill({ type: 'move' }));

	it('names the engine body an imported creep was built from', function () {
		assert.strictEqual(matchBody(attackMove(25, 25), 3), 'fullDefender');
		assert.strictEqual(matchBody(attackMove(15, 15), 2), 'weakDefender');
		assert.strictEqual(matchBody(
			new Array(44).fill({ type: 'ranged_attack', boost: 'XKHO2' })
				.concat(new Array(6).fill({ type: 'move', boost: 'XZHO2' })), 5), 'fullBoostedRanger');
	});

	it('picks the boosted twin when the body carries boosts', function () {
		const boosted = new Array(25).fill({ type: 'attack', boost: 'UH2O' })
			.concat(new Array(25).fill({ type: 'move' }));
		assert.strictEqual(matchBody(boosted, 4), 'boostedDefender');
	});

	it('routes a WORK body to the fortifier behavior only at bunker4+', function () {
		const worker = new Array(15).fill({ type: 'work' })
			.concat(new Array(15).fill({ type: 'carry' }), new Array(15).fill({ type: 'move' }));
		assert.strictEqual(matchBehavior(worker, 5), 'fortifier');
		assert.strictEqual(matchBehavior(worker, 3), 'simple-melee');
		assert.strictEqual(matchBehavior(attackMove(25, 25), 4), 'coordinated');
	});
});

'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like the other integration suites do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const DojoWorld = require('../../src/dojoWorld');

const FLAT = Array.from({ length: 50 }, function () { return '.'.repeat(50); });

// The bunker3 rampart ring, relative to the core (common/lib/strongholds
// templates): enough of the real layout that the garrison has ramparts to hold.
const RAMPARTS = [[0, 0], [1, 1], [-1, -1], [-1, 1], [-2, -1], [0, -1], [-1, 0], [1, 0],
	[-2, 1], [0, 1], [-2, 2], [-1, 2], [1, 2], [1, -1], [-2, 0]];

// A room snapshot shaped like one the importer produces from a live season
// stronghold: the core and its garrison are present, but the three fields that
// tie them together — strongholdId, strongholdBehavior, population — are not.
// That is the case DojoWorld.repairStronghold exists to fix; without it the
// processor routes the defenders to the roaming invader AI.
function strongholdMap(room, coreX, coreY, extra) {
	const structures = [{ type: 'invaderCore', x: coreX, y: coreY, owner: 'invader', level: 3,
		hits: 100000, hitsMax: 100000 }];
	Object.assign(structures[0], extra || {});
	for (const [dx, dy] of RAMPARTS) {
		structures.push({ type: 'rampart', x: coreX + dx, y: coreY + dy, owner: 'invader',
			hits: 1000000, hitsMax: 1000000 });
	}
	return {
		room: room, terrain: FLAT, structures: structures,
		controller: { x: 5, y: 5 },
		creeps: [0, 1].map(function (index) {
			return {
				name: 'defender' + index, x: coreX, y: coreY + index, owner: 'invader',
				body: new Array(25).fill('attack').concat(new Array(25).fill('move'))
			};
		})
	};
}

function homeMap() {
	return {
		room: 'W1N1', terrain: FLAT,
		controller: { x: 25, y: 25, owner: 'me', level: 8 },
		structures: [{ type: 'spawn', x: 20, y: 20, owner: 'me', name: 'Spawn1' }],
		creeps: []
	};
}

describe('imported stronghold garrison', function () {
	this.timeout(600000);
	let world;
	let db;

	before(async function () {
		world = new DojoWorld({});
		await world.reset();
		await world.loadScenarioMaps([homeMap(), strongholdMap('W2N1', 25, 25)], {
			modules: { main: 'module.exports.loop = function () {};' }
		});
		({ db } = await world.world.load());
		await world.start();
	});

	after(function () {
		if (world) world.stop();
	});

	it('gives the core the behavior and population its level implies', async function () {
		const core = await db['rooms.objects'].findOne({ room: 'W2N1', type: 'invaderCore' });
		assert.strictEqual(core.strongholdBehavior, 'bunker3');
		assert.strictEqual(core.strongholdId, 'W2N1_imported');
		assert.deepStrictEqual(core.population, [
			{ body: 'fullDefender', behavior: 'simple-melee' },
			{ body: 'fullDefender', behavior: 'simple-melee' }
		]);
	});

	it('binds every garrison creep to the core', async function () {
		const creeps = await db['rooms.objects'].find({ room: 'W2N1', type: 'creep', user: '2' });
		assert.strictEqual(creeps.length, 2);
		for (const creep of creeps) assert.strictEqual(creep.strongholdId, 'W2N1_imported');
	});

	// The regression this whole change is about: before the repair the same
	// snapshot produced creeps that walked off their ramparts and killed the
	// intruder, because processor.js routes an Invader creep WITHOUT a
	// strongholdId to intents/creeps/invaders/findAttack.js.
	it('holds the bunker instead of charging an intruder', async function () {
		await world.addCreep({
			room: 'W2N1', x: 40, y: 25, user: world.botUserId, name: 'intruder',
			body: new Array(40).fill('tough').concat(new Array(10).fill('move')),
			ticksToLive: 1500
		});
		// Towers would kill the intruder from anywhere in the room, which would
		// mask whether the CREEPS moved. The creeps are what is under test.
		await world.removeObject({ room: 'W2N1', type: 'tower' });

		const before = await db['rooms.objects'].find({ room: 'W2N1', type: 'creep', user: '2' });
		for (let i = 0; i < 25; i++) await world.tick();

		const core = await db['rooms.objects'].findOne({ room: 'W2N1', type: 'invaderCore' });
		const after = await db['rooms.objects'].find({ room: 'W2N1', type: 'creep', user: '2' });
		const intruder = await db['rooms.objects'].findOne({ room: 'W2N1', name: 'intruder' });

		assert.ok(intruder, 'intruder was killed: the garrison left the bunker and hunted it');
		assert.strictEqual(intruder.x, 40, 'intruder was pushed off its tile');
		for (const creep of after) {
			const distance = Math.max(Math.abs(creep.x - core.x), Math.abs(creep.y - core.y));
			assert.ok(distance <= 3,
				creep.name + ' left the bunker: ' + distance + ' tiles from the core at '
					+ creep.x + ',' + creep.y);
		}
		assert.strictEqual(after.length, before.length);
	});
});

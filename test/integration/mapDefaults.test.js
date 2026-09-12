'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like smoke.js and runScenarioChild.js do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const DojoWorld = require('../../src/dojoWorld');

// Maps authored in the editor put EVERYTHING in structures[] — the loader
// must supply engine defaults (spawn stores, source energy) and must not
// duplicate the controller (addBot claims the map's own controller).
function borderTerrain() {
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

describe('map structures[] defaults', function () {
	this.timeout(600000);
	let world;

	before(async function () {
		world = new DojoWorld();
		await world.reset();
		const map = {
			room: 'W0N0',
			terrain: borderTerrain(),
			structures: [
				{ type: 'controller', x: 22, y: 22, owner: 'me' },
				{ type: 'source', x: 6, y: 28 },
				{ type: 'spawn', x: 30, y: 30, owner: 'me' },
				// An editor-placed power bank: type/x/y only, everything else defaulted.
				{ type: 'powerBank', x: 12, y: 12 },
				// An IMPORTED one: its own haul and its remaining lifetime.
				{ type: 'powerBank', x: 14, y: 14, store: { power: 8727 }, ticksToDecay: 232 }
			],
			flags: []
		};
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadScenarioMaps([map], { room: 'W0N0', x: 18, y: 17 });
		await world.start();
	});

	after(function () {
		if (world) world.stop();
	});

	it('places exactly one controller, claimed by the bot at level 1', async function () {
		const { db } = await world.world.load();
		const controllers = await db['rooms.objects'].find({ room: 'W0N0', type: 'controller' });
		assert.strictEqual(controllers.length, 1, 'no duplicate auto-injected controller');
		assert.strictEqual(controllers[0].x, 22);
		assert.strictEqual(controllers[0].user, world.botUserId, 'addBot claimed the map controller');
		assert.strictEqual(controllers[0].level, 1);
	});

	it('gives map-defined sources engine defaults so they are harvestable', async function () {
		const { db } = await world.world.load();
		const source = await db['rooms.objects'].findOne({ room: 'W0N0', type: 'source' });
		assert.strictEqual(source.energy, 1000);
		assert.strictEqual(source.energyCapacity, 1000);
	});

	it('gives map-defined spawns store/hits/name defaults so they can spawn', async function () {
		const { db } = await world.world.load();
		const spawns = await db['rooms.objects'].find({ room: 'W0N0', type: 'spawn' });
		assert.strictEqual(spawns.length, 2, "addBot's Spawn1 + the map's spawn");
		const mapSpawn = spawns.find(function (spawn) { return spawn.x === 30; });
		assert.strictEqual(mapSpawn.name, 'Spawn2');
		assert.strictEqual(mapSpawn.store.energy, 300);
		assert.strictEqual(mapSpawn.hits, 5000);
		assert.strictEqual(mapSpawn.user, world.botUserId);
	});

	// The engine's `.power` getter is `o.store.power`, and a bank with no hits is
	// destroyed by the first point of damage — so an editor-placed bank needs both
	// filled in or it is useless as a target.
	it('gives a map-defined power bank a store, full hits and a decay clock', async function () {
		const { db } = await world.world.load();
		const gameTime = await world.world.gameTime;
		const bank = await db['rooms.objects'].findOne({ room: 'W0N0', type: 'powerBank', x: 12 });
		assert.ok(bank, 'the power bank was placed');
		assert.strictEqual(bank.store.power, 5000);            // POWER_BANK_CAPACITY_MAX
		assert.strictEqual(bank.hits, 2000000);                // POWER_BANK_HITS
		assert.strictEqual(bank.hitsMax, 2000000);
		// Absolute deadline, in `decayTime` (not nextDecayTime) — a null one would
		// have the engine delete the bank on its first processed tick.
		assert.ok(bank.decayTime > gameTime, 'seeded a live decay deadline');
		assert.strictEqual(bank.nextDecayTime, undefined);
	});

	it("keeps an imported power bank's own power and remaining lifetime", async function () {
		const { db } = await world.world.load();
		const bank = await db['rooms.objects'].findOne({ room: 'W0N0', type: 'powerBank', x: 14 });
		assert.strictEqual(bank.store.power, 8727, 'the map value beats the default');
		assert.strictEqual(bank.hits, 2000000);
		// ticksToDecay is relative on the way in and must not survive on the doc.
		assert.strictEqual(bank.ticksToDecay, undefined);
		assert.ok(bank.decayTime > 0 && bank.decayTime <= 232 + 5, 'rebased onto the sim clock');
	});
});

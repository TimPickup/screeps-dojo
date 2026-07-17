'use strict';

const assert = require('assert');
// constructed directly on purpose (not via src/drivers.js): this suite tests
// the mockup driver itself, below the engine seam
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
				{ type: 'spawn', x: 30, y: 30, owner: 'me' }
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
});

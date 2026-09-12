'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like smoke.js and runScenarioChild.js do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DojoWorld = require('../../src/dojoWorld');

// Fully walled 50x50 room — walls on both sides of a shared edge are a
// valid (if impassable) edge pair, which is all this suite needs.
function walledRoom(name, structures) {
	const rows = ['#'.repeat(50)];
	for (let y = 1; y < 49; y++) rows.push('#' + '.'.repeat(48) + '#');
	rows.push('#'.repeat(50));
	return { room: name, terrain: rows, controller: { x: 5, y: 5 }, structures: structures || [], creeps: [] };
}

// world.loadAllMaps() is the one-call form of "load this whole scenario
// directory": every map.*.json, then the usual loadScenarioMaps.
describe('world.loadAllMaps', function () {
	this.timeout(600000);
	let world;
	let dir;

	before(async function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-loadall-'));
		// W0N0 carries the bot's own spawn, so no botOptions are needed; W1N0 is
		// a second room that must come along without being named anywhere.
		fs.writeFileSync(path.join(dir, 'map.W0N0.json'), JSON.stringify(
			walledRoom('W0N0', [{ type: 'spawn', x: 10, y: 25, owner: 'me', name: 'Spawn1' }])));
		fs.writeFileSync(path.join(dir, 'map.W1N0.json'), JSON.stringify(
			walledRoom('W1N0', [{ type: 'tower', x: 20, y: 20 }])));

		world = new DojoWorld({ scenarioDir: dir });
		await world.reset();
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadAllMaps();
	});

	after(function () {
		if (world) world.stop();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('loads every map in the scenario dir without naming any of them', async function () {
		const { db } = await world.world.load();
		const rooms = await db.rooms.find({});
		const names = rooms.map(function (r) { return r._id; }).sort();
		assert.deepStrictEqual(names, ['W0N0', 'W1N0']);
	});

	it('places the objects from a map nobody passed explicitly', async function () {
		const { db } = await world.world.load();
		const towers = await db['rooms.objects'].find({ room: 'W1N0', type: 'tower' });
		assert.strictEqual(towers.length, 1, 'W1N0 tower should have been placed');
	});

	it('adopts the map spawn as the bot home, as loadScenarioMaps does', async function () {
		const { db } = await world.world.load();
		const spawns = await db['rooms.objects'].find({ room: 'W0N0', type: 'spawn' });
		assert.strictEqual(spawns.length, 1, 'the bootstrap spawn should be gone');
		assert.strictEqual(spawns[0].name, 'Spawn1');
		assert.strictEqual(spawns[0].user, world.botUserId);
	});
});

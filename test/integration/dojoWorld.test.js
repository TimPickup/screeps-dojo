'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like smoke.js and runScenarioChild.js do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DojoWorld = require('../../src/dojoWorld');

describe('DojoWorld', function () {
	this.timeout(600000);
	let world;

	before(async function () {
		world = new DojoWorld();
		await world.reset();
		const map = JSON.parse(fs.readFileSync(
			path.join(__dirname, '..', '..', 'test', 'fixtures', 'scout-flee-map.json'), 'utf8'));
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadScenarioMaps([map], { room: 'W0N0', x: 5, y: 2 });
		await world.addCreep({ room: 'W0N0', x: 5, y: 25, name: 'T', body: ['move'] });
		await world.start();
	});

	after(function () {
		if (world) world.stop();
	});

	it('loads terrain into the server', async function () {
		const terrain = await world.world.getTerrain('W0N0');
		assert.strictEqual(terrain.get(25, 10), 'wall');   // wall column
		assert.strictEqual(terrain.get(10, 25), 'plain');  // open floor
	});

	it('readState reports the bot creep and the goal flag', async function () {
		const state = await world.readState();
		// >= 1 rather than === 1: sibling tests that share this world may have
		// already advanced the clock, so we only assert time has started.
		assert.ok(state.gameTime >= 1);
		assert.deepStrictEqual(
			{ x: state.creeps.T.x, y: state.creeps.T.y, hits: state.creeps.T.hits },
			{ x: 5, y: 25, hits: 100 });
		assert.deepStrictEqual(
			{ x: state.flags.goal.x, y: state.flags.goal.y, room: state.flags.goal.room },
			{ x: 45, y: 25, room: 'W0N0' });
	});

	it('ticks without error and time advances', async function () {
		const before = (await world.readState()).gameTime;
		await world.tick();
		const after = (await world.readState()).gameTime;
		assert.strictEqual(after, before + 1);
	});

	it('addFlag throws when a flag with the same name already exists', async function () {
		await assert.rejects(
			() => world.addFlag('goal', 'W0N0', 10, 10, {}),
			/already exists/
		);
	});

	it('enemy creep appears in hostileCreeps and not creeps', async function () {
		const enemyBot = await world.addEnemyBot({
			username: 'enemyReviewTest',
			room: 'W0N0',
			x: 40,
			y: 2,
			modules: { main: 'module.exports.loop = function () {};' }
		});
		await world.addCreep({ room: 'W0N0', x: 40, y: 25, name: 'ET', body: ['move'], user: enemyBot.id });
		const state = await world.readState();
		assert.ok(state.hostileCreeps.ET, 'ET should appear in hostileCreeps');
		assert.strictEqual(state.hostileCreeps.ET.user, enemyBot.id);
		assert.strictEqual(state.creeps.ET, undefined, 'ET must not appear in creeps');
	});
});

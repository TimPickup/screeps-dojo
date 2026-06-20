'use strict';

const assert = require('assert');
const { createServer, TerrainMatrix } = require('../../src/serverBoot');

describe('invader AI (spec risk #2)', function () {
	this.timeout(600000);
	let server;

	before(async function () {
		server = createServer();
		await server.world.reset(); // seeds NPC users Invader('2') and Source Keeper('3')
		await server.world.addRoom('W0N0');
		await server.world.setTerrain('W0N0', new TerrainMatrix());
		await server.world.addRoomObject('W0N0', 'controller', 10, 10, { level: 0 });

		const bot = await server.world.addBot({
			username: 'victimOwner', room: 'W0N0', x: 40, y: 40,
			modules: { main: 'module.exports.loop = function () {};' }
		});
		await server.world.addRoomObject('W0N0', 'creep', 25, 25, {
			user: bot.id, name: 'victim',
			body: [{ type: 'move', hits: 100 }],
			hits: 100, hitsMax: 100, store: {}, storeCapacity: 0,
			fatigue: 0, spawning: false, notifyWhenAttacked: false
		});
		await server.world.addRoomObject('W0N0', 'creep', 27, 25, {
			user: '2', name: 'invader1',
			body: [{ type: 'attack', hits: 100 }, { type: 'move', hits: 100 }],
			hits: 200, hitsMax: 200, store: {}, storeCapacity: 0,
			fatigue: 0, spawning: false, notifyWhenAttacked: false
		});
		await server.start();
	});

	after(function () {
		if (server) server.stop();
	});

	it('moves toward or attacks the victim within 5 ticks', async function () {
		const { db } = await server.world.load();
		const before = await db['rooms.objects'].findOne({ room: 'W0N0', name: 'invader1' });
		for (let i = 0; i < 5; i++) await server.tick();
		const invader = await db['rooms.objects'].findOne({ room: 'W0N0', name: 'invader1' });
		const victim = await db['rooms.objects'].findOne({ room: 'W0N0', name: 'victim' });
		const moved = invader.x !== before.x || invader.y !== before.y;
		const attacked = victim.hits < 100;
		assert.ok(moved || attacked,
			'invader idle: still at (' + invader.x + ',' + invader.y + '), victim hits ' + victim.hits);
	});
});

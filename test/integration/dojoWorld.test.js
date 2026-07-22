'use strict';

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

describe('DojoWorld multi-room processing', function () {
	this.timeout(600000);
	let world;

	// Fully walled 50x50 room — walls on both sides of a shared edge are a
	// valid (if impassable) edge pair, which is all these tests need.
	function walledRoom(name) {
		const rows = ['#'.repeat(50)];
		for (let y = 1; y < 49; y++) rows.push('#' + '.'.repeat(48) + '#');
		rows.push('#'.repeat(50));
		return { room: name, terrain: rows, controller: { x: 5, y: 5 }, structures: [], creeps: [] };
	}

	// One shared four-room world (tests below are ordered, like the DojoWorld
	// suite above): W0N0 holds the bot's spawn, W1N0 an idle creep the bot
	// never sends intents for, W2N0 nothing but its neutral controller, and
	// W3N0 a pile of dropped energy. The bot's loop is empty, so any room
	// activity we observe comes from the activation model, not from intents.
	before(async function () {
		world = new DojoWorld();
		await world.reset();
		const home = walledRoom('W0N0');
		const remote = walledRoom('W1N0');
		remote.creeps.push({ name: 'idler', x: 10, y: 10, owner: 'me', body: ['move'] });
		const inert = walledRoom('W2N0');
		const litter = walledRoom('W3N0');
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadScenarioMaps([home, remote, inert, litter], { room: 'W0N0', x: 10, y: 10 });
		await world.world.addRoomObject('W3N0', 'energy', 10, 10, { energy: 1000, resourceType: 'energy' });
		await world.start();
		for (let i = 0; i < 3; i++) await world.tick();
	});

	after(function () {
		if (world) world.stop();
	});

	// Regression: the engine only processes rooms in its per-tick ACTIVE_ROOMS
	// set, and addBot seeds only the HOME room. A second loaded room where the
	// bot never submits intents was therefore never processed at all — creeps
	// there did not age (the engine stamps ageTime on first processing), sources
	// did not regenerate, controllers did not downgrade. On a real server the
	// processor's own in-use predicate keeps any room with a player-owned
	// object hot; a creep is such an object, so its room must keep ticking.
	it('processes a loaded room the bot has no intents in (creeps age)', async function () {
		const { db } = await world.world.load();
		const idler = await db['rooms.objects'].findOne({ room: 'W1N0', type: 'creep', name: 'idler' });
		assert.ok(idler, 'the idler creep should still exist');
		assert.ok(idler.ageTime, 'W1N0 should be processed: the engine stamps ageTime on '
			+ 'the first tick a room is simulated, got ' + idler.ageTime);
	});

	// After a tick, ACTIVE_ROOMS holds exactly the rooms the engine's in-use
	// predicate re-activated for the NEXT tick. A room with nothing in use
	// must drop out of it — that is vanilla dormancy — and must carry a
	// force-update alarm so it is not frozen forever.
	it('lets a room with nothing in use go dormant after its first pass', async function () {
		const { db, env } = await world.world.load();
		const active = await env.smembers(env.keys.ACTIVE_ROOMS);
		assert.ok(active.includes('W0N0'), 'home room must stay active (the spawn is player-owned)');
		assert.ok(active.includes('W1N0'), 'the idler creep must keep its room active');
		assert.ok(!active.includes('W2N0'), 'an inert room must go dormant');
		const doc = await db.rooms.findOne({ _id: 'W2N0' });
		assert.ok(doc.nextForceUpdateTime, 'a dormant room must carry a force-update alarm');
	});

	// The mockup has no backend cron jobs, so DojoWorld itself must play the
	// roomsForceUpdate role: wake a dormant room when its alarm comes due and
	// re-arm the alarm for the next cycle.
	it('force-updates a dormant room when its alarm comes due', async function () {
		const { db } = await world.world.load();
		const due = await world.world.gameTime;
		await db.rooms.update({ _id: 'W2N0' }, { $set: { nextForceUpdateTime: due } });
		await world.tick();
		const rearmed = (await db.rooms.findOne({ _id: 'W2N0' })).nextForceUpdateTime;
		assert.ok(rearmed > due, 'waking a dormant room must re-arm its alarm, got ' + rearmed);
	});

	// Dropped energy decays per PROCESSED tick, and the engine's predicate
	// re-activates any room holding energy precisely so that decay never
	// pauses. A creepless room with a pile on the floor must keep ticking.
	it('dropped energy keeps its room awake and decays tick over tick', async function () {
		const { db, env } = await world.world.load();
		const pile = await db['rooms.objects'].findOne({ room: 'W3N0', type: 'energy' });
		assert.ok(pile.energy < 1000, 'dropped energy must decay every tick, got ' + pile.energy);
		const active = await env.smembers(env.keys.ACTIVE_ROOMS);
		assert.ok(active.includes('W3N0'), 'a room holding dropped energy must not sleep');
	});

	// Injecting a creep mid-run must wake a dormant room immediately — the
	// real backend's world-mutating API calls activateRoom for the same
	// reason. Without this the new creep would sit frozen (no ageTime) until
	// the room's next force update.
	it('a creep dropped into a dormant room wakes it immediately', async function () {
		await world.addCreep({ room: 'W2N0', x: 12, y: 12, name: 'dropIn', body: ['move'] });
		await world.tick();
		const { db } = await world.world.load();
		const dropIn = await db['rooms.objects'].findOne({ room: 'W2N0', type: 'creep', name: 'dropIn' });
		assert.ok(dropIn, 'the dropped-in creep should exist');
		assert.ok(dropIn.ageTime, 'the dormant room must wake for its new creep, got ' + dropIn.ageTime);
	});
});

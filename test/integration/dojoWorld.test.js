'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like smoke.js and runScenarioChild.js do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DojoWorld = require('../../src/dojoWorld');

// Fully walled 50x50 room — walls on both sides of a shared edge are a
// valid (if impassable) edge pair, which is all these suites need.
function walledRoom(name) {
	const rows = ['#'.repeat(50)];
	for (let y = 1; y < 49; y++) rows.push('#' + '.'.repeat(48) + '#');
	rows.push('#'.repeat(50));
	return { room: name, terrain: rows, controller: { x: 5, y: 5 }, structures: [], creeps: [] };
}

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

	// A placed creep gets everything the engine would only hand a spawned one:
	// a death clock, and — since a scenario creep can never visit a lab —
	// boosted parts, with the carry boost reflected in its capacity.
	it('addCreep stamps a lifetime and builds boosted parts', async function () {
		await world.addCreep({
			room: 'W0N0', x: 6, y: 25, name: 'B', body: ['carry', 'carry', 'move'],
			boosts: { carry: 'XKH2O' }, ticksToLive: 400
		});
		const gameTime = await world.world.gameTime;
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ room: 'W0N0', type: 'creep', name: 'B' });
		assert.deepStrictEqual(doc.body.map(function (part) { return part.boost; }),
			['XKH2O', 'XKH2O', undefined]);
		assert.strictEqual(doc.storeCapacity, 400);   // XKH2O quadruples carry: 2 x 50 x 4
		assert.strictEqual(doc.ageTime, gameTime + 400);
		assert.strictEqual(doc.storeCapacityResource, undefined,
			'a creep must carry storeCapacity only — storeCapacityResource makes '
			+ 'store.getCapacity()/getFreeCapacity() return null');
	});

	it('defaults a creep lifetime to the engine value for its body', async function () {
		const gameTime = await world.world.gameTime;
		await world.addCreep({ room: 'W0N0', x: 7, y: 25, name: 'claimer', body: ['claim', 'move'] });
		await world.addCreep({ room: 'W0N0', x: 8, y: 25, name: 'worker', body: ['work', 'move'] });
		const { db } = await world.world.load();
		const claimer = await db['rooms.objects'].findOne({ room: 'W0N0', type: 'creep', name: 'claimer' });
		const worker = await db['rooms.objects'].findOne({ room: 'W0N0', type: 'creep', name: 'worker' });
		assert.strictEqual(claimer.ageTime - gameTime, 600);   // CREEP_CLAIM_LIFE_TIME
		assert.strictEqual(worker.ageTime - gameTime, 1500);   // CREEP_LIFE_TIME
	});

	// Map creeps are placed through addCreep, so a creep painted into a map is
	// built exactly like one a scenario adds by hand — same lifetime, same
	// boosts — while the map's own hits/store still win.
	it('places map creeps through addCreep', async function () {
		await world.placeMapObjects([{
			room: 'W0N0',
			creeps: [{
				name: 'fromMap', x: 9, y: 25, owner: 'me',
				body: ['tough', 'carry'], boosts: { tough: 'XGHO2' }, hits: 150
			}]
		}]);
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ room: 'W0N0', type: 'creep', name: 'fromMap' });
		assert.strictEqual(doc.user, world.botUserId);
		assert.strictEqual(doc.body[0].boost, 'XGHO2');
		assert.deepStrictEqual([doc.hits, doc.hitsMax], [150, 200]);
		assert.ok(doc.ageTime > 0, 'a map creep needs a death clock too, got ' + doc.ageTime);
	});

});

// addObject is the general placement path — type defaults, owner resolution,
// relative-to-absolute clocks, room activation, and the new id back. One world
// for the whole suite; the tests place their objects on separate tiles and
// never tick, so they do not interact.
describe('DojoWorld addObject', function () {
	this.timeout(600000);
	let world;

	before(async function () {
		world = new DojoWorld();
		await world.reset();
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadScenarioMaps([walledRoom('W0N0')], { room: 'W0N0', x: 10, y: 10 });
	});

	after(function () {
		if (world) world.stop();
	});

	it('fills in type defaults, resolves the owner and returns the id', async function () {
		const id = await world.addObject('W0N0', 'tower', 11, 25, { owner: 'me' });
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ _id: id });
		assert.ok(id, 'addObject must return the new _id');
		assert.strictEqual(doc.type, 'tower');
		assert.strictEqual(doc.user, world.botUserId);            // 'me' resolved
		assert.deepStrictEqual([doc.hits, doc.hitsMax], [3000, 3000]);   // from structureDefaults
		assert.deepStrictEqual(doc.storeCapacityResource, { energy: 1000 });
		assert.strictEqual(doc.owner, undefined, 'owner is an input, not a doc field');
	});

	// An imported map keeps the live server's object ids because the bot encodes
	// source ids in creep names — `id` has to land as the doc's `_id`.
	it('keeps a supplied id as the doc _id', async function () {
		const id = await world.addObject('W0N0', 'source', 24, 25, { id: 'liveSourceId1' });
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ _id: 'liveSourceId1' });
		assert.strictEqual(id, 'liveSourceId1');
		assert.ok(doc, 'the source should be stored under its live id');
		assert.strictEqual(doc.id, undefined, 'id is an input, not a doc field');
	});

	it('wakes the room it inserts into', async function () {
		const { env } = await world.world.load();
		// clears shared state for this suite — safe only because nothing here
		// ticks or reads ACTIVE_ROOMS afterwards
		await env.del(env.keys.ACTIVE_ROOMS);
		await world.addObject('W0N0', 'container', 12, 25, {});
		const active = await env.smembers(env.keys.ACTIVE_ROOMS);
		assert.ok(active.includes('W0N0'), 'inserting an object must activate its room');
	});

	// placeMapObjects loads a whole map with activation deferred, then wakes the
	// room once at the end, so the opt-out has to actually opt out.
	it('activate: false leaves the room asleep', async function () {
		const { env } = await world.world.load();
		await env.del(env.keys.ACTIVE_ROOMS);
		await world.addObject('W0N0', 'container', 26, 25, { activate: false });
		// smembers answers undefined, not [], for a set with nothing in it
		const active = (await env.smembers(env.keys.ACTIVE_ROOMS)) || [];
		assert.ok(!active.includes('W0N0'), 'activate:false must not wake the room, got ' + JSON.stringify(active));
	});

	// addObject(type 'creep') and addCreep are two spellings of one code path,
	// so the generic form must produce a fully built creep, not a bare doc.
	it('routes creeps through addCreep', async function () {
		const id = await world.addObject('W0N0', 'creep', 13, 25, {
			name: 'viaAddObject', body: ['carry', 'move'], boosts: { carry: 'KH' }
		});
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ _id: id });
		assert.strictEqual(doc.body[0].boost, 'KH');
		assert.strictEqual(doc.storeCapacity, 100);     // KH doubles carry: 1 x 50 x 2
		assert.ok(doc.ageTime > 0, 'got ' + doc.ageTime);
		assert.strictEqual(doc.user, world.botUserId);
	});

	it('addSpawn returns the new id too', async function () {
		const id = await world.addSpawn({ room: 'W0N0', x: 27, y: 25, name: 'Spawn9' });
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ _id: id });
		assert.ok(id, 'addSpawn must return the new _id');
		assert.strictEqual(doc.name, 'Spawn9');
		assert.strictEqual(doc.user, world.botUserId);
	});

	// A dropped pile keeps its size in a field named after the resource; a
	// literal `amount` field is ignored by the runtime and then goes stale.
	it('stores a dropped resource amount where the engine reads it', async function () {
		const id = await world.addObject('W0N0', 'energy', 14, 25, { amount: 250, resourceType: 'energy' });
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ _id: id });
		assert.strictEqual(doc.energy, 250);
		assert.strictEqual(doc.amount, undefined);
	});

	// Decay handlers fire on `!nextDecayTime || gameTime >= nextDecayTime-1`, so
	// an unseeded road/rampart decays on the first tick its room is processed.
	it('seeds a decay clock, and ticksToDecay overrides it', async function () {
		const gameTime = await world.world.gameTime;
		const roadId = await world.addObject('W0N0', 'road', 16, 25, {});
		const rampartId = await world.addObject('W0N0', 'rampart', 17, 25, { owner: 'me', ticksToDecay: 42 });
		const { db } = await world.world.load();
		const road = await db['rooms.objects'].findOne({ _id: roadId });
		const rampart = await db['rooms.objects'].findOne({ _id: rampartId });
		assert.strictEqual(road.nextDecayTime - gameTime, 1000);   // ROAD_DECAY_TIME
		assert.strictEqual(rampart.nextDecayTime - gameTime, 42);
		assert.strictEqual(rampart.ticksToDecay, undefined, 'the relative input must not reach the doc');
	});

	// powerBank/deposit use `decayTime`, not `nextDecayTime` — and are deleted
	// outright when it comes due, so a null clock removes them instantly.
	it('uses the right decay field per type', async function () {
		const gameTime = await world.world.gameTime;
		const id = await world.addObject('W0N0', 'powerBank', 18, 25, { store: { power: 1000 } });
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ _id: id });
		assert.strictEqual(doc.decayTime - gameTime, 5000);        // POWER_BANK_DECAY
		assert.strictEqual(doc.nextDecayTime, undefined);
	});

	it('does not give a decay clock to types that have none', async function () {
		const id = await world.addObject('W0N0', 'constructedWall', 19, 25, { hits: 100, hitsMax: 100 });
		const { db } = await world.world.load();
		const doc = await db['rooms.objects'].findOne({ _id: id });
		// a constructedWall's decayTime means a temporary newbie wall — seeding
		// one would make every wall in an imported base expire
		assert.strictEqual(doc.decayTime, undefined);
		assert.strictEqual(doc.nextDecayTime, undefined);
	});

	// Both regen handlers only run their clock while the node is empty, so a
	// full source must not carry one.
	it('seeds a regeneration clock only for a depleted node', async function () {
		const gameTime = await world.world.gameTime;
		const fullId = await world.addObject('W0N0', 'source', 20, 25, {});
		const emptyId = await world.addObject('W0N0', 'source', 21, 25, { energy: 0 });
		const timedId = await world.addObject('W0N0', 'source', 22, 25, { energy: 0, ticksToRegeneration: 17 });
		const mineralId = await world.addObject('W0N0', 'mineral', 23, 25, { mineralType: 'H', mineralAmount: 0 });
		const { db } = await world.world.load();
		const full = await db['rooms.objects'].findOne({ _id: fullId });
		const empty = await db['rooms.objects'].findOne({ _id: emptyId });
		const timed = await db['rooms.objects'].findOne({ _id: timedId });
		const mineral = await db['rooms.objects'].findOne({ _id: mineralId });
		assert.strictEqual(full.nextRegenerationTime, undefined, 'a full source has nothing pending');
		assert.strictEqual(empty.nextRegenerationTime - gameTime, 300);       // ENERGY_REGEN_TIME
		assert.strictEqual(timed.nextRegenerationTime - gameTime, 17);
		assert.strictEqual(mineral.nextRegenerationTime - gameTime, 50000);   // MINERAL_REGEN_TIME
		assert.strictEqual(timed.ticksToRegeneration, undefined, 'the relative input must not reach the doc');
	});

	it('refuses flags, which are not room objects', async function () {
		await assert.rejects(
			() => world.addObject('W0N0', 'flag', 15, 25, { name: 'nope' }),
			/use addFlag/
		);
	});
});

describe('DojoWorld spawn adoption', function () {
	this.timeout(600000);
	let world;

	after(function () {
		if (world) world.stop();
	});

	// Regression: adopting a map spawn places a bootstrap 'Spawn1' on the same
	// tile and removes it after placeMapObjects. A map spawn that is ITSELF
	// named 'Spawn1' (the natural name for a home spawn) must survive that
	// cleanup — a name-based removal deletes both docs and the scenario
	// silently starts with no spawn at all.
	it('keeps a map spawn named Spawn1 on the adopted home tile', async function () {
		world = new DojoWorld();
		await world.reset();
		const map = JSON.parse(fs.readFileSync(
			path.join(__dirname, '..', '..', 'test', 'fixtures', 'scout-flee-map.json'), 'utf8'));
		map.structures = [
			// store energy 123 tells the map's spawn apart from the bootstrap
			// (which starts with the stock 300)
			{ type: 'spawn', x: 10, y: 25, owner: 'me', name: 'Spawn1', store: { energy: 123 } }
		];
		world.modules = { main: 'module.exports.loop = function () {};' };
		// no botOptions: the map spawn is adopted as the bot home
		await world.loadScenarioMaps([map]);
		const { db } = await world.world.load();
		const spawns = await db['rooms.objects'].find({ room: 'W0N0', type: 'spawn' });
		assert.strictEqual(spawns.length, 1,
			'exactly one spawn should remain after adoption, got ' + spawns.length);
		assert.strictEqual(spawns[0].name, 'Spawn1');
		assert.strictEqual(spawns[0].store.energy, 123,
			'the surviving spawn should be the map-defined one, not the bootstrap');
	});
});

describe('DojoWorld multi-room processing', function () {
	this.timeout(600000);
	let world;

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
		await world.addObject('W3N0', 'energy', 10, 10, { amount: 1000, resourceType: 'energy' });
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

	it('idle room is not active', async function () {
		const { env } = await world.world.load();
		const active = await env.smembers(env.keys.ACTIVE_ROOMS);
		assert.ok(!active.includes('W2N0'), 'an idle room must not be active');
	});

	// Injecting a creep mid-run must wake a dormant room immediately — the
	// real backend's world-mutating API calls activateRoom for the same
	// reason. Without this the new creep would sit frozen (no ageTime) until
	// the room's next force update.
	it('a creep dropped into a dormant room wakes it immediately and goes dormant again when the creep dies', async function () {
		await world.addCreep({ room: 'W2N0', x: 12, y: 12, name: 'dropIn', body: ['move'], ticksToLive: 10 });
		await world.tick();
		const { db, env } = await world.world.load();
		const dropIn = await db['rooms.objects'].findOne({ room: 'W2N0', type: 'creep', name: 'dropIn' });
		assert.ok(dropIn, 'the dropped-in creep should exist');
		assert.ok(dropIn.ageTime, 'the dormant room must wake for its new creep, got ' + dropIn.ageTime);

		const active = await env.smembers(env.keys.ACTIVE_ROOMS);
		assert.ok(active.includes('W2N0'), 'a room that was dormant must wake for a new creep');

		//check after more ticks that the creep has died and the room is no longer active
		let activeFor = 0;
		let aliveFor = 1;
		for (let i = 0; i < 150; i++) {
			const dropIn2 = await db['rooms.objects'].findOne({ room: 'W2N0', type: 'creep', name: 'dropIn' });
			if (dropIn2) {
				aliveFor++;
			} else {
				const active2 = await env.smembers(env.keys.ACTIVE_ROOMS);
				if (active2.includes('W2N0')) {
					activeFor++;
				} else {
					break;				
				}
			}
			
			await world.tick();
		}
		
		assert.strictEqual(aliveFor, 10, 'the dropped-in creep should have died after 10 ticks. It lived for ' + aliveFor + ' ticks');
		
		assert.ok(activeFor < 100, 'a room with no objects must go dormant again. It was active for ' + activeFor + ' ticks after the creep died');
	});

});

// An NPC room holds NOTHING the engine's in-use predicate counts: a keeper lair
// carries no user at all, and keepers are user '3', which the predicate excludes
// by name (engine processor.js). Left alone such a room never re-activates
// itself, so its lair is never processed, its nextSpawnTime never comes due, and
// no keeper is ever born — or at best it stutters on the force-update cadence,
// firing ~100 ticks late with its creeps frozen in between.
//
// So placing a keeperLair or invaderCore pins its room permanently active
// (ALWAYS_ACTIVE_TYPES -> keepRoomActive): the room doc carries `active`, and
// the processor re-activates any room whose doc has it, every pass, for free.
describe('DojoWorld NPC room activation', function () {
	this.timeout(600000);
	let world;

	after(function () {
		if (world) world.stop();
	});

	it('a lone keeper lair spawns its keeper and keeps its room active', async function () {
		world = new DojoWorld();
		await world.reset();
		const home = walledRoom('W0N0');
		const keeperRoom = walledRoom('W1N0');
		keeperRoom.structures.push({ type: 'keeperLair', x: 25, y: 25 });
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadScenarioMaps([home, keeperRoom], { room: 'W0N0', x: 10, y: 10 });
		await world.start();

		const { db, env } = await world.world.load();
		const lair = await db['rooms.objects'].findOne({ room: 'W1N0', type: 'keeperLair' });
		assert.ok(lair, 'the keeper lair should exist');
		assert.ok(lair.nextSpawnTime, 'the lair needs a first-spawn deadline, got ' + lair.nextSpawnTime);
		assert.strictEqual((await db.rooms.findOne({ _id: 'W1N0' })).active, true,
			'placing a lair must pin its room active');

		// KEEPER_FIRST_SPAWN_DELAY is 5 and the engine fires a lair on
		// `gameTime >= nextSpawnTime - 1`, so a room that is really being
		// processed produces its keeper about 5 ticks in. Two bounds on purpose:
		// the loop limit tells "never spawned at all" apart from the `ticks <= 6`
		// assertion below, which catches a room that only wakes on the ~100-tick
		// force-update cadence.
		const LIMIT = 8;
		let keeper = null;
		let ticks = 0;
		while (ticks < LIMIT && !keeper) {
			await world.tick();
			ticks++;
			keeper = await db['rooms.objects'].findOne({ room: 'W1N0', type: 'creep', user: '3' });
		}
		assert.ok(keeper, 'a lone keeper lair must still spawn its keeper — none after ' + LIMIT + ' ticks');
		assert.ok(ticks <= 6, 'the keeper should appear about 5 ticks in, took ' + ticks);
		assert.strictEqual(keeper.name, 'Keeper' + lair._id);

		// The pinned room re-activates itself through the processor, so unlike a
		// dojo-side pre-tick sweep it IS visible in ACTIVE_ROOMS between ticks.
		const active = await env.smembers(env.keys.ACTIVE_ROOMS);
		assert.ok(active.includes('W1N0'),
			'a pinned room must stay in ACTIVE_ROOMS, got ' + JSON.stringify(active));

		// Stronger still: prove the room is actually PROCESSED, not merely
		// scheduled. Damage the keeper and the lair schedules a replacement
		// (engine keeper-lairs/tick.js re-arms on `!keeper || keeper.hits < 5000`).
		const lairAfterSpawn = await db['rooms.objects'].findOne({ _id: lair._id });
		assert.strictEqual(lairAfterSpawn.nextSpawnTime, null,
			'the lair should have consumed its first-spawn deadline');
		await db['rooms.objects'].update({ _id: keeper._id }, { $set: { hits: 100 } });
		await world.tick();
		const lairRearmed = await db['rooms.objects'].findOne({ _id: lair._id });
		assert.ok(lairRearmed.nextSpawnTime,
			'a keeper room must keep ticking after its first keeper: the lair should '
			+ 'reschedule for a damaged keeper, got ' + lairRearmed.nextSpawnTime);
	});

	// The other NPC engine: an invader core has to keep ticking to deploy and
	// spawn its defenders, and its user ('2') is inactive, so the predicate skips
	// it the same way.
	it('an invader core pins its room too', async function () {
		world = new DojoWorld();
		await world.reset();
		const home = walledRoom('W0N0');
		const coreRoom = walledRoom('W1N0');
		coreRoom.structures.push({ type: 'invaderCore', x: 25, y: 25, owner: 'invader' });
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadScenarioMaps([home, coreRoom], { room: 'W0N0', x: 10, y: 10 });
		await world.start();

		const { db, env } = await world.world.load();
		assert.strictEqual((await db.rooms.findOne({ _id: 'W1N0' })).active, true,
			'placing an invader core must pin its room active');
		for (let i = 0; i < 3; i++) await world.tick();
		const core = await db['rooms.objects'].findOne({ room: 'W1N0', type: 'invaderCore' });
		assert.ok(core, 'the invader core should survive its own processing');
		const active = await env.smembers(env.keys.ACTIVE_ROOMS);
		assert.ok(active.includes('W1N0'),
			'an invader core room must stay active, got ' + JSON.stringify(active));
	});
});
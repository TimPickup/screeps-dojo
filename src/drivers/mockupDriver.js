'use strict';

// The screeps-server-mockup engine driver: the only file (with serverBoot.js,
// which boots and guards the mockup server itself) that touches mockup/server
// internals. DojoWorld owns everything engine-agnostic — type defaults, decay
// and regeneration clocks, owner resolution, map orchestration — and calls
// down into one of these per world for anything that reads or writes engine
// storage. A second engine implements this same method list and nothing else.
//
// The driver contract, by group:
//   lifecycle    reset() start() stop() tick()
//   time         gameTime()
//   rooms        createRoom(room) setTerrain(room, tiles)
//                activateRoom(room) keepRoomActive(room)
//   objects      insertObject(room, type, x, y, doc) findObjects(query)
//                updateObjectById(id, update) removeObjectsWhere(query)
//   bots         addBot(options) subscribeBotErrors(userId, onError)
//                seedMemory(userId, json) seedSegments(userId, segments)
//   flags        addFlag(userId, room, flag) readFlags()
//   engine       constant(name) engineFeatures()
//   observation  captureFrame(botUserId) captureTerrain()
//
// `world` (the raw mockup world) is exposed for the mockup-specific
// integration tests that assert against the underlying db; nothing engine
// agnostic may rely on it.
//
// This file is required LAZILY by DojoWorld — never from module top level of
// any shared file — so that selecting a different engine keeps
// screeps-server-mockup entirely unloaded (it is not even installed outside
// the container).
const { createServer, TerrainMatrix, getMockEngineFeatures } = require('../serverBoot');
const { parseFlags, serializeFlags } = require('../mapFormat');
const warnings = require('../harnessWarnings');

// How long a dormant room sleeps between forced processing passes (see
// activateSimRooms). Vanilla's roomsForceUpdate uses 90 + up to 20 random
// jitter; a deterministic 100 keeps scenario runs reproducible.
const FORCE_UPDATE_INTERVAL = 100;

class MockupDriver {
	constructor() {
		this.server = createServer();
	}

	get world() {
		return this.server.world;
	}

	async reset() {
		await this.server.world.reset();
	}

	async start() {
		// The engine writes to the same collections the raw-access guard watches,
		// and in the fast in-process mode it does so in THIS process — so the
		// guard stands down while the engine is the one running (see
		// src/harnessWarnings.js).
		warnings.suspend();
		try {
			await this.server.start();
		} finally {
			warnings.resume();
		}
	}

	stop() {
		this.server.stop();
	}

	async tick() {
		await this.activateSimRooms();
		warnings.suspend();
		try {
			await this.server.tick();
		} finally {
			warnings.resume();
		}
	}

	async gameTime() {
		return this.world.gameTime;
	}

	engineFeatures() {
		return getMockEngineFeatures();
	}

	// One engine constant, by name, from the running server (@screeps/common) —
	// so dojo never keeps its own copy of a game number the server can change
	// under it. Returns undefined when unavailable; DojoWorld turns that into
	// a loud error.
	constant(name) {
		return this.server.constants ? this.server.constants[name] : undefined;
	}

	// The engine only processes rooms listed in its per-tick ACTIVE_ROOMS set
	// — the driver DRAINS that set as it reads it (getAllRoomsNames), so it is
	// a work list for one tick, never a lasting state.
	//
	// A real server refills the set from three sources:
	// (1) the processor re-activates any room its own in-use predicate
	//     matches — owned controller, player-owned objects, dropped energy,
	//     tombstones, nukes, portals (engine processor.js). The mockup runs
	//     the same processor, so this works here untouched.
	// (2) player intents activate their target rooms (driver saveUserIntents
	//     — also already working here).
	// (3) backend cron jobs: roomsForceUpdate wakes every DORMANT room every
	//     90-110 ticks so absolute-time mechanics (source regen, decay,
	//     controller downgrade) still advance, and NPC rooms — keeper lairs,
	//     invader cores, whose user-'2'/'3' objects the processor's predicate
	//     deliberately ignores — are kept alive by the stronghold/invader
	//     crons (backend-local cronjobs.js).
	//
	// The mockup has no crons at all, so (3) is missing entirely: a dormant
	// room would be frozen FOREVER rather than for ~100 ticks — creeps left
	// there never age (the engine never even stamps ageTime), sources never
	// regenerate, controllers never downgrade, keeper lairs never spawn. This
	// plays the roomsForceUpdate role before every tick, on a deterministic
	// 100-tick cadence where the real cron jitters (90 + up to 20), because a
	// test harness wants reproducible runs.
	//
	// A room's FIRST pass is not this method's job: addObject/addCreep already
	// wake a room when something is placed in it, and placeMapObjects wakes
	// every room it loads. So a room seen here with no alarm yet is only armed,
	// not activated — otherwise every inert room in the world would be
	// processed once at startup for nothing.
	//
	// NPC rooms do NOT rely on this: a keeper lair or invader core pins its
	// room permanently active when it is placed (see keepRoomActive), so it
	// runs every tick instead of stuttering on the 100-tick cadence.
	async activateSimRooms() {
		const { db, env } = await this.world.load();
		const gameTime = await this.world.gameTime;

		// Whatever is missing from ACTIVE_ROOMS right now was not re-activated
		// by the engine at the end of last tick — it is dormant.
		const activeRooms = new Set(await env.smembers(env.keys.ACTIVE_ROOMS));
		const rooms = await db.rooms.find({});
		for (const room of rooms) {
			if (activeRooms.has(room._id)) continue;
			if (!room.nextForceUpdateTime || gameTime >= room.nextForceUpdateTime) {
				if (room.nextForceUpdateTime) await env.sadd(env.keys.ACTIVE_ROOMS, room._id);
				await db.rooms.update({ _id: room._id }, { $set: { nextForceUpdateTime: gameTime + FORCE_UPDATE_INTERVAL } });
			}
		}
	}

	// --- rooms ------------------------------------------------------------

	// setRoom rather than addRoom: addRoom stamps `active: true` on the
	// room doc, and the engine re-activates any room whose doc carries
	// that flag every time it is processed (processor.js "may be set in
	// intents") — saveRoomInfo $sets fields and never removes one, so
	// the flag is sticky and the room can never go dormant.
	async createRoom(roomName) {
		await this.world.setRoom(roomName, 'normal', false);
	}

	// `tiles` is parseTerrain output: [{ x, y, type }] for every non-plain tile.
	async setTerrain(roomName, tiles) {
		const terrain = new TerrainMatrix();
		for (const tile of tiles) terrain.set(tile.x, tile.y, tile.type);
		await this.world.setTerrain(roomName, terrain);
	}

	// Wakes a room for the next tick. ACTIVE_ROOMS is the engine's per-tick
	// work list: a dormant room (or one no player intent has ever touched)
	// ignores whatever we drop into it until something re-activates it, which
	// is why the real backend activates a room from its world-mutating API.
	// One tick only: ACTIVE_ROOMS is drained as the driver reads it. Never set
	// `db.rooms.active` here — that pins the room forever (see keepRoomActive),
	// and a one-off wake must let the room fall asleep again.
	async activateRoom(roomName) {
		const { env } = await this.world.load();
		await env.sadd(env.keys.ACTIVE_ROOMS, roomName);
	}

	// The opposite: pins a room active permanently, at a one-off cost of a
	// single field write and nothing per tick.
	//
	// The processor reads the room's own doc each time it processes the room
	// (driver getRoomInfo -> db.rooms.findOne) and re-activates it for the next
	// tick when the doc carries `active`:
	//     if (roomInfo.active) { activateRoom = true; delete roomInfo.active; }   // processor.js
	// That `delete` cannot clear the STORED flag, because the doc is persisted
	// with `saveRoomInfo = db.rooms.update({_id}, {$set: roomInfo})` and `$set`
	// never unsets a key that is simply absent. So the flag survives every pass
	// and the room re-activates itself for as long as it is set — the engine
	// does the work, we pay nothing per tick.
	//
	// Undo it with an explicit `$set: { active: false }`; nothing else will.
	async keepRoomActive(roomName) {
		const { db } = await this.world.load();
		await db.rooms.update({ _id: roomName }, { $set: { active: true } });
		await this.activateRoom(roomName);
	}

	// --- objects ----------------------------------------------------------

	// Inserts ONE fully-built object doc. Defaults, owner resolution and clocks
	// are DojoWorld's job — by the time a doc reaches the driver it is exactly
	// what the engine should see. Returns the stored doc (with its _id).
	async insertObject(room, type, x, y, doc) {
		return this.world.addRoomObjectUnchecked(room, type, x, y, doc);
	}

	async findObjects(query) {
		const { db } = await this.world.load();
		return db['rooms.objects'].find(query);
	}

	async updateObjectById(id, update) {
		const { db } = await this.world.load();
		await db['rooms.objects'].updateUnchecked({ _id: id }, update);
	}

	async removeObjectsWhere(query) {
		const { db } = await this.world.load();
		await db['rooms.objects'].removeWhereUnchecked(query);
	}

	// --- bots ---------------------------------------------------------------

	// Returns the engine's bot handle. Contract beyond this driver: `id`, a
	// `console(expression)` method, and EventEmitter 'console' events carrying
	// (logs, results) — the runner and evalInBot rely on exactly those.
	async addBot(options) {
		return this.world.addBot(options);
	}

	// Surface bot runtime crashes. An uncaught exception in the bot's loop
	// (typo, bad API call, pathfinding into an unloaded room…) is otherwise
	// invisible: the mock server's User forwards console.log lines but drops
	// the error, so the bot just silently does nothing. We subscribe to the
	// raw console channel ourselves and hand each error string to the caller.
	async subscribeBotErrors(userId, onError) {
		const { pubsub } = this.server.common.storage;
		await pubsub.subscribe('user:' + userId + '/console', (event) => {
			let parsed; try { parsed = JSON.parse(event); } catch (e) { return; }
			const err = parsed && (parsed.error || (parsed.messages && parsed.messages.error));
			if (!err) return;
			onError(String(err));
		});
	}

	// Overwrites a user's Memory blob (addBot seeds it to '{}').
	async seedMemory(userId, json) {
		const { env } = await this.world.load();
		await env.set(env.keys.MEMORY + userId, json);
	}

	// Seeds RawMemory segment contents; `segments` maps segmentNumber -> string.
	async seedSegments(userId, segments) {
		const { env } = await this.world.load();
		for (const key of Object.keys(segments)) {
			await env.hset(env.keys.MEMORY_SEGMENTS + userId, Number(key), segments[key]);
		}
	}

	// --- flags --------------------------------------------------------------

	// Flags are NOT room objects: one doc per (user, room) in 'rooms.flags',
	// data string in the engine wire format (spec §5).
	async addFlag(userId, room, flag) {
		const { db } = await this.world.load();
		const entry = serializeFlags([{
			name: flag.name, x: flag.x, y: flag.y,
			color: flag.color, secondaryColor: flag.secondaryColor
		}]);
		const existing = await db['rooms.flags'].findOne({ room: room, user: userId });
		if (existing) {
			const existingFlags = parseFlags(existing.data);
			if (existingFlags.some(function (f) { return f.name === flag.name; })) {
				throw new Error('flag ' + flag.name + ' already exists in ' + room + ' for this user');
			}
			await db['rooms.flags'].update({ _id: existing._id }, { $set: { data: existing.data + '|' + entry } });
		} else {
			await db['rooms.flags'].insert({ room: room, user: userId, data: entry });
		}
	}

	// Every flag in the world, parsed out of the wire format:
	// [{ name, room, x, y, user }].
	async readFlags() {
		const { db } = await this.world.load();
		const flagDocs = await db['rooms.flags'].find({});
		const flags = [];
		for (const doc of flagDocs) {
			for (const flag of parseFlags(doc.data)) {
				flags.push({ name: flag.name, room: doc.room, x: flag.x, y: flag.y, user: doc.user });
			}
		}
		return flags;
	}

	// --- recording capture (spec §7) ----------------------------------------

	// Full-fidelity frame for the recorder: raw object docs (positions, hits,
	// store, actionLog with attack/heal/say), flag docs, and the per-room
	// engine event log. Richer than readState on purpose: anything not
	// recorded can't be rendered later.
	async captureFrame(botUserId) {
		const { db, env } = await this.world.load();
		const gameTime = await this.world.gameTime;
		// CPU the bot used this tick. The engine runtime persists it to the user doc each tick
		// (@screeps/driver runtime/make.js: $set.lastUsedCpu = usedTime), so we can read it here without
		// advancing the world. ms of CPU; null if unavailable (e.g. a tick the bot was skipped).
		let cpu = null;
		if (botUserId) {
			try {
				const users = await db.users.find({ _id: botUserId });
				if (users && users[0] && typeof users[0].lastUsedCpu === 'number') cpu = users[0].lastUsedCpu;
			} catch (error) { /* cpu unavailable for this tick */ }
		}
		const objects = await db['rooms.objects'].find({});
		const flags = await db['rooms.flags'].find({});
		const roomNames = new Set();
		for (const object of objects) {
			if (object.room) roomNames.add(object.room);
		}
		const eventLog = {};
		for (const roomName of roomNames) {
			try {
				const raw = await env.hget(env.keys.ROOM_EVENT_LOG, roomName);
				eventLog[roomName] = raw ? JSON.parse(raw) : [];
			} catch (error) {
				eventLog[roomName] = [];
			}
		}
		// The bot's own RoomVisual draws (paths, island outlines, etc.). The
		// engine stores them per user/room/tick at key roomVisual:<user>,<room>,<time>
		// (driver/runtime/make.js). Capture for the main bot so replays/preview
		// can show them. The just-run tick's visuals are keyed at gameTime (try
		// gameTime-1 as a fallback for any off-by-one in timing).
		const visuals = {};
		if (botUserId) {
			for (const roomName of roomNames) {
				try {
					let raw = await env.get(env.keys.ROOM_VISUAL + botUserId + ',' + roomName + ',' + gameTime);
					if (!raw) raw = await env.get(env.keys.ROOM_VISUAL + botUserId + ',' + roomName + ',' + (gameTime - 1));
					if (raw) visuals[roomName] = raw;
				} catch (error) { /* no visuals for this room */ }
			}
		}
		return { gameTime: gameTime, cpu: cpu, objects: objects, flags: flags, eventLog: eventLog, visuals: visuals };
	}

	// Terrain as the map-format char rows, read back from the server, keyed
	// by room name. Captured once per recording (terrain never changes).
	async captureTerrain() {
		const { db } = await this.world.load();
		const roomDocs = await db.rooms.find({});
		const terrainByRoom = {};
		for (const doc of roomDocs) {
			const matrix = await this.world.getTerrain(doc._id);
			const rows = [];
			for (let y = 0; y < 50; y++) {
				let row = '';
				for (let x = 0; x < 50; x++) {
					const type = matrix.get(x, y);
					row += type === 'wall' ? '#' : type === 'swamp' ? '~' : '.';
				}
				rows.push(row);
			}
			terrainByRoom[doc._id] = rows;
		}
		return terrainByRoom;
	}
}

module.exports = MockupDriver;

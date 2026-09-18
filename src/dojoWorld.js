'use strict';

// Facade over screeps-server-mockup (spec §3): the only file that touches
// mockup/server internals. Runner, loader, and (later) recorder use this API.
const fs = require('fs');
const path = require('path');
const { createServer, TerrainMatrix } = require('./serverBoot');
const { parseTerrain, serializeFlags, parseFlags, validateEdges, autoMirror } = require('./mapFormat');
const warnings = require('./harnessWarnings');
const botModules = require('./botModules');
const modRegistry = require('./mods');

// Not a game constant: the engine hardcodes 100 per part when it builds a body
// (processor/intents/spawns/create-creep.js). Everything else here comes from
// the engine's own constants at runtime — see engineConstant().
const BODY_PART_HITS = 100;
// Owner values on a map that are NOT another player: my bot, the two NPC users,
// and the two spellings of an unowned controller. Anything else is a player
// label from the importer (src/import/ownerLabels.js).
const NON_PLAYER_OWNERS = new Set(['me', 'invader', 'sourceKeeper', 'neutral', 'unclaimed']);

// Name of the throwaway spawn addBot forces into an imported player's room.
// Distinctive so removing it can never match a spawn the map itself defines.
const SEED_SPAWN_PREFIX = '__dojo_seed_';

const NPC_USER_IDS = { invader: '2', sourceKeeper: '3' };
// Types that are NOT rooms.objects docs — inserting one there is silently
// inert, so addObject sends the caller to the method that knows better.
const NON_ROOM_OBJECT_TYPES = { flag: 'addFlag' };

// Placing one of these pins its room permanently active (see keepRoomActive).
// They are the NPC engines of a room and must keep ticking to do their job —
// a keeper lair to respawn its keeper, an invader core to deploy and spawn —
// but the processor's in-use predicate ignores exactly them: a lair carries no
// user at all, and keepers are user '3', which processor.js excludes by name.
// Left to the force-update cadence they would fire ~100 ticks late and their
// creeps would stand frozen in between, which is no use in a benchmark.
const ALWAYS_ACTIVE_TYPES = { keeperLair: true, invaderCore: true };

// Decay clocks, as ABSOLUTE game ticks: which field a type's deadline lives in
// (the engine uses two different names) and the ENGINE CONSTANT naming the
// lifetime to seed when a caller supplies no `ticksToDecay` — resolved from the
// running server, never copied here. Verified against the engine's own
// handlers: road/container/rampart re-arm `nextDecayTime` in
// processor/intents/<type>/tick.js, powerBank/deposit are removed on
// `decayTime` in processor.js. A type absent here has no decay clock — notably
// constructedWall, whose `decayTime` means a temporary newbie/respawn wall.
const DECAY_CLOCKS = {
	road: { field: 'nextDecayTime', constant: 'ROAD_DECAY_TIME' },
	// The engine re-arms an owned room's containers at CONTAINER_DECAY_TIME_OWNED
	// once it sees the controller, which map loading claims only after the
	// containers are placed — pass ticksToDecay when the first decay tick has to
	// be exact.
	container: { field: 'nextDecayTime', constant: 'CONTAINER_DECAY_TIME' },
	rampart: { field: 'nextDecayTime', constant: 'RAMPART_DECAY_TIME' },
	powerBank: { field: 'decayTime', constant: 'POWER_BANK_DECAY' },
	deposit: { field: 'decayTime', constant: 'DEPOSIT_DECAY_TIME' }
};

// Regeneration clocks for the resource nodes, same absolute-tick idea. Both
// engine handlers only run the clock while the node is EMPTY (a full source
// has no pending regeneration), so a default is seeded only when depleted.
const REGEN_CLOCKS = {
	source: { field: 'nextRegenerationTime', constant: 'ENERGY_REGEN_TIME' },
	mineral: { field: 'nextRegenerationTime', constant: 'MINERAL_REGEN_TIME' }
};
// Ticks after load until a keeper lair (loaded without an explicit
// nextSpawnTime) produces its FIRST source keeper. The engine's own default is
// ENERGY_REGEN_TIME (300) — far too long for a combat sandbox; respawn after a
// keeper dies still follows the engine's normal 300-tick cycle.
const KEEPER_FIRST_SPAWN_DELAY = 5;

// How long a dormant room sleeps between forced processing passes (see
// activateSimRooms). Vanilla's roomsForceUpdate uses 90 + up to 20 random
// jitter; a deterministic 100 keeps scenario runs reproducible.
const FORCE_UPDATE_INTERVAL = 100;

// Engine-required fields for objects defined in a map's structures[] array
// (the editor exports sources/spawns/etc. that way). Without these the engine
// breaks subtly: a spawn with no store can't spawn, a source with no energy
// can't be harvested. Values mirror engine constants (SPAWN_ENERGY_START 300,
// SPAWN_HITS 5000, TOWER_CAPACITY 1000, CONTAINER_CAPACITY 2000, ...).
// Map-provided values always win over these defaults.
function structureDefaults(type, spawnIndex) {
	switch (type) {
		case 'spawn':
			return {
				name: 'Spawn' + spawnIndex,
				store: { energy: 300 }, storeCapacityResource: { energy: 300 },
				hits: 5000, hitsMax: 5000, spawning: null, notifyWhenAttacked: true
			};
		case 'source':
			return { energy: 1000, energyCapacity: 1000 };
		case 'extension':
			return {
				store: { energy: 0 }, storeCapacityResource: { energy: 50 },
				hits: 1000, hitsMax: 1000, notifyWhenAttacked: true
			};
		case 'container':
			return { store: {}, storeCapacity: 2000, hits: 250000, hitsMax: 250000 };
		case 'tower':
			return {
				store: { energy: 0 }, storeCapacityResource: { energy: 1000 },
				hits: 3000, hitsMax: 3000, notifyWhenAttacked: true
			};
		case 'storage':
			return { store: {}, storeCapacity: 1000000, hits: 10000, hitsMax: 10000, notifyWhenAttacked: true };
		// Other store-bearing structures: an imported one with an empty store omits
		// the `store` field, and the engine/runtime's `.store` getter does
		// Object.entries(store) — which throws on undefined and crashes any bot creep
		// that inspects it. A default empty store keeps them safe.
		case 'link':
			return { store: {}, storeCapacityResource: { energy: 800 }, cooldown: 0, hits: 1000, hitsMax: 1000, notifyWhenAttacked: true };
		case 'terminal':
			return { store: {}, storeCapacity: 300000, hits: 3000, hitsMax: 3000, notifyWhenAttacked: true };
		case 'lab':
			return { store: {}, storeCapacityResource: { energy: 2000 }, cooldown: 0, hits: 500, hitsMax: 500, notifyWhenAttacked: true };
		case 'factory':
			return { store: {}, storeCapacity: 50000, cooldown: 0, hits: 1000, hitsMax: 1000, notifyWhenAttacked: true };
		case 'powerSpawn':
			return { store: {}, storeCapacityResource: { energy: 5000, power: 100 }, hits: 5000, hitsMax: 5000, notifyWhenAttacked: true };
		case 'nuker':
			return { store: {}, storeCapacityResource: { energy: 300000, G: 5000 }, hits: 1000, hitsMax: 1000, notifyWhenAttacked: true };
		// The engine's `.power` getter is literally `o.store.power` (game/structures.js),
		// so a bank with no store crashes any bot creep that looks at one; and with
		// no hits it is destroyed by the first point of damage instead of taking
		// POWER_BANK_HITS (2,000,000) worth, which is the whole point of a bank.
		// A default bank is a FULL vanilla one (POWER_BANK_CAPACITY_MAX 5000) — a
		// map's own `store` wins, so an imported season bank keeps its real haul.
		case 'powerBank':
			return { store: { power: 5000 }, hits: 2000000, hitsMax: 2000000 };
		case 'mineral':
			return { mineralType: 'H', density: 3 };
		default:
			return {};
	}
}

class DojoWorld {
	// options.mods    — active mod IDs (src/mods.js), for mod-supplied object
	//                   defaults and for the run's metadata
	// options.modfile — the mods.json the engine must read; absent means vanilla
	constructor(options) {
		options = options || {};
		this.mods = options.mods || [];
		this.server = createServer(options.modfile ? { modfile: options.modfile } : undefined);
		this.bot = null;        // main bot User (set by addMainBot)
		this.botUserId = null;
		// Imported player label -> that player's real user id in this sim, filled
		// in by bindMapPlayers for the labels settings.json assigned a bot to.
		this.playerUserIds = {};
		this.modules = null;    // set by the runner before setup() runs
		// The scenario's own directory, so loadMap/loadMaps can find its
		// map.*.json without every scenario.js repeating fs+path boilerplate.
		// Null when a world is built directly (tests), which those two report.
		this.scenarioDir = options.scenarioDir || null;
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

	// --- world building -------------------------------------------------

	// The four neighbouring room names for a room name like 'E29N39'. Screeps
	// coords: E/W is the horizontal axis (E0 and W0 adjacent), N/S vertical;
	// in a room y=0 is the north edge, y=49 the south edge.
	neighborRooms(roomName) {
		const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName);
		if (!m) return {};
		const hx = m[1] === 'E' ? Number(m[2]) : -Number(m[2]) - 1;
		const vy = m[3] === 'N' ? Number(m[4]) : -Number(m[4]) - 1;
		const col = (h) => (h >= 0 ? 'E' + h : 'W' + (-h - 1));
		const row = (v) => (v >= 0 ? 'N' + v : 'S' + (-v - 1));
		return {
			west: col(hx - 1) + row(vy),
			east: col(hx + 1) + row(vy),
			north: col(hx) + row(vy + 1),
			south: col(hx) + row(vy - 1)
		};
	}

	// Walls off (sets '#') any room border whose neighbour isn't also loaded,
	// mutating the in-memory maps' terrain (never the files on disk).
	sealExteriorExits(maps) {
		const loaded = new Set(maps.map((m) => m.room));
		for (const map of maps) {
			if (!Array.isArray(map.terrain) || map.terrain.length !== 50) continue;
			const nb = this.neighborRooms(map.room);
			const rows = map.terrain.map((r) => r.split(''));
			if (!loaded.has(nb.west)) for (let y = 0; y < 50; y++) rows[y][0] = '#';
			if (!loaded.has(nb.east)) for (let y = 0; y < 50; y++) rows[y][49] = '#';
			if (!loaded.has(nb.north)) for (let x = 0; x < 50; x++) rows[0][x] = '#';
			if (!loaded.has(nb.south)) for (let x = 0; x < 50; x++) rows[49][x] = '#';
			map.terrain = rows.map((r) => r.join(''));
		}
	}

	async createRoomsFromMaps(maps, options) {
		const mismatches = validateEdges(maps);
		if (mismatches.length > 0) {
			if (options && options.autoMirror) {
				autoMirror(maps);
			} else {
				throw new Error('map edge mismatches: ' + JSON.stringify(mismatches)
					+ ' (pass { autoMirror: true } to fix automatically)');
			}
		}
		// Failsafe: seal any room border that leads OUT of the loaded set. The
		// engine's PathFinder throws "Could not load terrain data" the moment a
		// creep paths through an open exit into a room the scenario never loaded,
		// so moveTo near such an edge silently crashes. Walling exterior exits
		// keeps single-room (and partially-loaded) scenarios self-contained.
		// Opt out with { sealExteriorExits: false } when you load every neighbour.
		if (!options || options.sealExteriorExits !== false) {
			this.sealExteriorExits(maps);
		}
		for (const map of maps) {
			// setRoom rather than addRoom: addRoom stamps `active: true` on the
			// room doc, and the engine re-activates any room whose doc carries
			// that flag every time it is processed (processor.js "may be set in
			// intents") — saveRoomInfo $sets fields and never removes one, so
			// the flag is sticky and the room can never go dormant.
			await this.world.setRoom(map.room,'normal',false);
			const terrain = new TerrainMatrix();
			for (const tile of parseTerrain(map.terrain)) terrain.set(tile.x, tile.y, tile.type);
			await this.world.setTerrain(map.room, terrain);
			// Controllers must exist BEFORE addBot runs: mockup's addBot throws
			// without one, and it claims the room's controller (sets user +
			// level 1) itself. Place the map's controller now — from the
			// top-level field or a structures[] entry (the editor exports the
			// latter). placeMapObjects skips controllers to avoid duplicates.
			//
			// A map WITHOUT a controller stays without one unless it is named
			// in options.placeholderControllers (or that option is absent, the
			// legacy behaviour for direct callers): the engine decides a room's
			// source capacity by whether a controller exists at all
			// (sources/tick.js — no controller means a keeper/centre room at
			// SOURCE_ENERGY_KEEPER_CAPACITY, 4000), so a hidden placeholder in an
			// imported centre room silently turned its sources into 1500 ones.
			const structuresController = (map.structures || []).find(function (entry) {
				return entry.type === 'controller';
			});
			const controller = map.controller || structuresController;
			// Unchecked (not addObject) on purpose: this runs BEFORE the bot
			// exists, so there is no owner to resolve yet — applyMapControllers
			// claims them afterwards — and a controller has neither type defaults
			// nor a clock. Waking the room here would be pointless too: nothing
			// else is in it yet.
			if (controller) {
				await this.world.addRoomObjectUnchecked(map.room, 'controller', controller.x, controller.y, {
					level: controller.level || 0, progress: 0
				});
			} else {
				const wanted = options && options.placeholderControllers;
				if (!wanted || wanted.indexOf(map.room) !== -1) await this.ensurePlaceholderController(map.room);
			}
		}
	}

	// The placeholder controller addBot needs: a level-0 one at (0,0), the
	// border wall corner, never walkable. No-op when the room already has one.
	async ensurePlaceholderController(room) {
		const { db } = await this.world.load();
		const existing = await db['rooms.objects'].findOne({ room: room, type: 'controller' });
		if (existing) return false;
		await this.world.addRoomObjectUnchecked(room, 'controller', 0, 0, { level: 0 });
		return true;
	}

	async addMainBot(botOptions) {
		const options = Object.assign({ username: 'dojo', modules: this.modules || {} }, botOptions);
		this.bot = await this.world.addBot(options);
		this.botUserId = this.bot.id;

		// Surface bot runtime crashes. An uncaught exception in the bot's loop
		// (typo, bad API call, pathfinding into an unloaded room…) is otherwise
		// invisible: the mock server's User forwards console.log lines but drops
		// the error, so the bot just silently does nothing. We subscribe to the
		// raw console channel ourselves and keep the errors for the runner.
		this._botErrors = [];
		this._lastBotError = null;
		try {
			const { pubsub } = this.server.common.storage;
			await pubsub.subscribe('user:' + this.botUserId + '/console', (event) => {
				let parsed; try { parsed = JSON.parse(event); } catch (e) { return; }
				const err = parsed && (parsed.error || (parsed.messages && parsed.messages.error));
				if (!err) return;
				const s = String(err);
				if (s === this._lastBotError) return; // collapse the same error repeating every tick
				this._lastBotError = s;
				this._botErrors.push(s);
			});
		} catch (e) { /* pubsub shape differs — non-fatal, just no error capture */ }
		// screeps-server-mockup sets safeMode: 20000 on the controller when addBot
		// runs, which prevents invader attacks for 20000 ticks — clear it so the
		// sim reflects real-world conditions (spec §3: harness must not mask bugs).
		await this.updateObject({ room: options.room, type: 'controller' }, { safeMode: 0 });
		return this.bot;
	}

	// Returns and clears bot runtime errors captured since the last call.
	takeBotErrors() {
		if (!this._botErrors || this._botErrors.length === 0) return [];
		const out = this._botErrors.slice();
		this._botErrors.length = 0;
		return out;
	}

	// Overwrites the main bot's Memory blob (addBot seeds it to '{}').
	// `memory` may be a JSON string or a plain object.
	async seedMemory(memory) {
		if (!this.botUserId) throw new Error('seedMemory: add the main bot first');
		const { env } = await this.world.load();
		const json = typeof memory === 'string' ? memory : JSON.stringify(memory);
		await env.set(env.keys.MEMORY + this.botUserId, json);
	}

	// Seeds RawMemory segment contents. `segments` is a map of
	// segmentNumber -> string. The bot still selects active segments at runtime.
	async seedSegments(segments) {
		if (!this.botUserId) throw new Error('seedSegments: add the main bot first');
		const { env } = await this.world.load();
		for (const key of Object.keys(segments)) {
			const value = segments[key];
			await env.hset(env.keys.MEMORY_SEGMENTS + this.botUserId, Number(key),
				typeof value === 'string' ? value : JSON.stringify(value));
		}
	}

	// Read every stored segment, including ones not active in the last tick.
	async captureRecordingMemory() {
		const { env } = await this.world.load();
		const ids = Array.from({ length: 100 }, (unused, id) => id);
		const values = await env.hmget(env.keys.MEMORY_SEGMENTS + this.botUserId, ids);
		const segments = {};
		for (const id of ids) {
			if (values[id] !== undefined && values[id] !== null) segments[id] = values[id];
		}
		return {
			memory: await env.get(env.keys.MEMORY + this.botUserId),
			segments: segments,
			playerUserIds: this.playerUserIds
		};
	}

	async addEnemyBot(botOptions) {
		// A scenario may drop an enemy into a room whose map has no controller
		// (loadScenarioMaps only seeds the placeholder in the main bot's home).
		if (botOptions && botOptions.room) await this.ensurePlaceholderController(botOptions.room);
		return this.world.addBot(botOptions);
	}

	// Removes the spawn(s) addBot forced into a room — for scenarios that want
	// the bot to start spawnless (e.g. probing a base plan with vision from a
	// creep, then placing the spawn where the bot's own planner wants it).
	async removeSpawns(room) {
		return this.removeObject({ room: room, type: 'spawn' });
	}

	// Inserts a spawn mid-run (the sandbox equivalent of a player placing
	// their first spawn). Same doc shape addBot uses. Returns the new _id.
	async addSpawn(spawnOptions) {
		const userId = spawnOptions.user === undefined ? this.botUserId : this.resolveOwner(spawnOptions.user);
		if (!userId) throw new Error('addSpawn: no user (add the main bot first or pass user)');
		return this.addObject(spawnOptions.room, 'spawn', spawnOptions.x, spawnOptions.y, {
			user: userId, name: spawnOptions.name || 'Spawn1',
			store: { energy: 300 }, storeCapacityResource: { energy: 300 },
			hits: 5000, hitsMax: 5000, spawning: null, notifyWhenAttacked: true,
			activate: spawnOptions.activate
		});
	}

	// Evaluates a console expression inside the main bot's VM and returns the
	// result string. The expression executes during the NEXT tick, so this
	// advances the world by one tick.
	async evalInBot(expression) {
		if (!this.bot) throw new Error('evalInBot: add the main bot first');
		const bot = this.bot;
		const resultPromise = new Promise(function (resolve) {
			function onConsole(logs, results) {
				if (results && results.length > 0) {
					bot.removeListener('console', onConsole);
					resolve(results[0]);
				}
			}
			bot.on('console', onConsole);
		});
		await this.bot.console(expression);
		await this.tick();
		return Promise.race([
			resultPromise,
			new Promise(function (unused, reject) {
				setTimeout(function () { reject(new Error('evalInBot: no result within 10s')); }, 10000);
			})
		]);
	}

	resolveOwner(owner) {
		if (owner === undefined || owner === null) return undefined;
		if (owner === 'me') {
			if (!this.botUserId) throw new Error("owner 'me' used before the main bot was added");
			return this.botUserId;
		}
		if (NPC_USER_IDS[owner]) return NPC_USER_IDS[owner];
		// An imported player the scenario assigned a bot to: the map's label
		// resolves to the user bindMapPlayers created for them.
		if (this.playerUserIds[owner]) return this.playerUserIds[owner];
		// user ids are STRINGS in the engine DB ('2' = Invader, '3' = Source
		// Keeper); normalize so a scenario writing `user: 2` still gets
		// engine-driven NPC behavior instead of a silent unknown user
		return String(owner);
	}

	async placeMapObjects(maps) {
		// addBot already created Spawn1; map-defined spawns get Spawn2, Spawn3...
		let spawnIndex = 2;
		// Absolute tick at which keeper lairs without an explicit nextSpawnTime
		// fire their first keeper (see the keeperLair handling below).
		const firstKeeperSpawn = (await this.world.gameTime) + KEEPER_FIRST_SPAWN_DELAY;
		for (const map of maps) {
			// Every object goes through addObject/addCreep so a map-loaded world is
			// built exactly like a scenario-built one — same type defaults, same
			// owner resolution. Activation is deferred to one call per room at the
			// end rather than one per object.
			for (const structure of map.structures || []) {
				// controllers were placed in createRoomsFromMaps (addBot needs
				// one to exist and claims it itself) — skip to avoid duplicates
				if (structure.type === 'controller') continue;
				const attributes = Object.assign({}, structure, { activate: false });
				if (structure.type === 'spawn' && !structure.name) {
					attributes.name = 'Spawn' + spawnIndex;
					spawnIndex++;
				}
				// Never load a spawn stuck mid-spawn: an imported in-progress `spawning`
				// object references the live server's game time, which never elapses in
				// the sim, so the spawn jams forever and the colony can't replace creeps.
				if (structure.type === 'spawn') attributes.spawning = null;
				// Imported invader cores carry season effects (e.g. 1001 invulnerability).
				// An importer that knew the source tick rebased them to `ticksRemaining`
				// (applied in applyClocks); an older map carries the raw far-future
				// season endTime, which would leave the core permanently invulnerable.
				if (structure.type === 'invaderCore' && Array.isArray(attributes.effects)) {
					attributes.effects = attributes.effects.filter(function (effect) {
						return effect && typeof effect.ticksRemaining === 'number';
					});
				}
				// Imported keeper lairs carry nextSpawnTime: null, which makes the engine
				// wait a full ENERGY_REGEN_TIME (300 ticks) before the FIRST keeper appears.
				// Seed a near-term first spawn instead so keepers are present quickly. This
				// touches only the first spawn: after a keeper dies the engine reschedules
				// itself (+300), so respawn timing is unchanged. An explicit map value wins.
				if (structure.type === 'keeperLair' && (attributes.nextSpawnTime === null || attributes.nextSpawnTime === undefined)) {
					attributes.nextSpawnTime = firstKeeperSpawn;
				}
				await this.addObject(map.room, structure.type, structure.x, structure.y, attributes);
			}
			// sources/minerals: the map entry IS the attribute set (its `id` keeps
			// the live server's object id, which creep names encode).
			for (const source of map.sources || []) {
				await this.addObject(map.room, 'source', source.x, source.y,
					Object.assign({}, source, { activate: false }));
			}
			for (const mineral of map.minerals || []) {
				await this.addObject(map.room, 'mineral', mineral.x, mineral.y,
					Object.assign({}, mineral, { activate: false }));
			}
			for (const flag of map.flags || []) {
				await this.addFlag(flag.name, map.room, flag.x, flag.y, flag);
			}
			for (const creep of map.creeps || []) {
				await this.addCreep(Object.assign({}, creep, {
					room: map.room,
					owner: creep.owner === undefined ? 'me' : creep.owner,
					activate: false
				}));
			}
			await this.activateRoom(map.room);
		}
	}

	// --- reading the scenario's own map files ----------------------------

	// The scenario directory this world was built for, or a pointed error: a
	// world constructed by hand (tests, tools) has no scenario to read from.
	requireScenarioDir(method) {
		if (!this.scenarioDir) {
			throw new Error('world.' + method + ': this world has no scenarioDir — it is set by the '
				+ 'scenario runner, so this only works from a scenario\'s setup(world). '
				+ 'Pass one explicitly with new DojoWorld({ scenarioDir: __dirname }).');
		}
		return this.scenarioDir;
	}

	// One map by room name: the scenario's own map.<room>.json, parsed.
	loadMap(room) {
		const dir = this.requireScenarioDir('loadMap');
		const file = 'map.' + room + '.json';
		if (!fs.existsSync(path.join(dir, file))) {
			const found = this.mapFileNames();
			throw new Error('world.loadMap: no ' + file + ' in ' + dir + ' — this scenario has '
				+ (found.length ? found.join(', ') : 'no map files'));
		}
		return this.readMapFile(file);
	}

	// EVERY map in the scenario directory, parsed, ordered by file name so a
	// run is reproducible (loadScenarioMaps adopts the FIRST owner:'me' spawn
	// it finds as the bot's home).
	loadMaps() {
		const dir = this.requireScenarioDir('loadMaps');
		const files = this.mapFileNames();
		if (files.length === 0) {
			throw new Error('world.loadMaps: no map.*.json in ' + dir
				+ ' — add a room in the Edit tab, or import one with npm run import-room');
		}
		const maps = files.map(this.readMapFile, this);
		// A duplicate like `map.E27S23 (1).json` (an editor or download copy)
		// would load the same room twice and build a subtly broken world; say so
		// here, where the file name is still in hand.
		const seen = {};
		for (let i = 0; i < maps.length; i++) {
			const room = maps[i].room;
			if (!room) throw new Error('world.loadMaps: ' + files[i] + ' has no "room" field');
			if (seen[room] !== undefined) {
				throw new Error('world.loadMaps: two maps for room ' + room + ' ('
					+ seen[room] + ' and ' + files[i] + ') — delete or rename one');
			}
			seen[room] = files[i];
		}
		return maps;
	}

	// Load the whole scenario directory into the world in one call: every
	// map.*.json, then the usual loadScenarioMaps (bot, objects, controllers).
	// Same arguments as loadScenarioMaps, minus the maps.
	async loadAllMaps(botOptions, options) {
		return this.loadScenarioMaps(this.loadMaps(), botOptions, options);
	}

	// map.json and map.<anything>.json, sorted; raw.*.json snapshots,
	// memory.json, segments.json and settings.json are not maps.
	mapFileNames() {
		return fs.readdirSync(this.requireScenarioDir('loadMaps'))
			.filter(function (f) { return /^map\.(.*\.)?json$/.test(f); })
			.sort();
	}

	readMapFile(file) {
		const full = path.join(this.scenarioDir, file);
		try {
			return JSON.parse(fs.readFileSync(full, 'utf8'));
		} catch (e) {
			throw new Error('world.loadMap: could not read ' + file + ' — ' + e.message);
		}
	}

	// Convenience: rooms + terrain, then the main bot, then owned objects/flags
	// (owner 'me' needs the bot's user id to exist first).
	//
	// The bot's home spawn: pass it explicitly via botOptions { room, x, y }, OR
	// just include a spawn with owner 'me' in a loaded map and it's adopted
	// automatically — an imported base shouldn't have to restate coordinates the
	// map already carries. (The mockup's addBot always bootstraps its own Spawn1
	// and needs a location, so when we adopt a map spawn we place that bootstrap
	// on the same tile and drop it afterwards, leaving the map's named spawn.)
	async loadScenarioMaps(maps, botOptions, options) {
		const opts = Object.assign({}, botOptions);
		const home = this.findHomeSpawn(maps);
		// Only the bot's home room gets a placeholder controller when its map
		// has none; every other controller-less map loads as the engine's own
		// keeper/centre room (see createRoomsFromMaps).
		const homeRoom = opts.room !== undefined ? opts.room : (home ? home.room : undefined);
		await this.createRoomsFromMaps(maps, Object.assign({}, options, {
			placeholderControllers: homeRoom === undefined ? [] : [homeRoom]
		}));

		const adoptHome = home && opts.room === undefined && opts.x === undefined && opts.y === undefined;
		if (adoptHome) { opts.room = home.room; opts.x = home.x; opts.y = home.y; }
		if (opts.room === undefined) {
			throw new Error('loadScenarioMaps: no bot spawn — pass botOptions { room, x, y }, '
				+ "or include a spawn with owner 'me' in a loaded map");
		}

		const bot = await this.addMainBot(opts);
		// Remember the bootstrap Spawn1's doc id NOW, while it is the only spawn
		// in the world — the map's own spawn may legitimately be named 'Spawn1'
		// too (the natural name for a home spawn), so the cleanup below must
		// remove exactly this doc, never match by name.
		let bootstrapSpawnId = null;
		if (adoptHome) {
			const { db } = await this.world.load();
			const bootstrap = await db['rooms.objects'].findOne({ room: home.room, type: 'spawn', x: home.x, y: home.y });
			bootstrapSpawnId = bootstrap ? bootstrap._id : null;
		}
		// Imported players become real users BEFORE their objects are placed, so
		// placeMapObjects resolves their label straight to a user id — no
		// after-the-fact reassignment pass.
		await this.bindMapPlayers(maps);
		if (options && options.memory !== undefined) await this.seedMemory(options.memory);
		if (options && options.segments !== undefined) await this.seedSegments(options.segments);
		await this.placeMapObjects(maps);
		await this.applyMapControllers(maps);

		if (adoptHome && bootstrapSpawnId !== null) {
			// addBot's bootstrap Spawn1 now overlaps the map's real spawn; remove
			// the placeholder so only the map-defined spawn remains.
			await this.removeObject({ _id: bootstrapSpawnId });
		}
		return bot;
	}

	// First spawn across the loaded maps that will belong to the bot (owner
	// 'me'), as { room, x, y } — used to adopt a map's own spawn as the bot home.
	findHomeSpawn(maps) {
		for (const map of maps || []) {
			for (const structure of map.structures || []) {
				if (structure.type === 'spawn' && structure.owner === 'me') {
					return { room: map.room, x: structure.x, y: structure.y };
				}
			}
		}
		return null;
	}

	// --- imported players -------------------------------------------------

	// Every owner label across the maps that is another PLAYER — not my bot,
	// not an NPC, not an unowned controller. Sorted, so a run binds them in the
	// same order every time.
	mapPlayerLabels(maps) {
		const labels = new Set();
		const consider = function (owner) {
			if (typeof owner !== 'string' || !owner) return;
			if (NON_PLAYER_OWNERS.has(owner)) return;
			labels.add(owner);
		};
		for (const map of maps || []) {
			for (const structure of map.structures || []) consider(structure.owner);
			for (const creep of map.creeps || []) consider(creep.owner);
			if (map.controller) consider(map.controller.owner);
		}
		return Array.from(labels).sort();
	}

	// Where to seed an imported player's bootstrap user. addBot demands a room
	// with a controller and inserts a spawn there, so we prefer the player's own
	// base and fall back to wherever else they have objects — the bootstrap
	// spawn is removed immediately afterwards either way.
	findPlayerHome(maps, label) {
		const withController = (maps || []).filter(function (map) {
			return map.controller || (map.structures || []).some(function (s) { return s.type === 'controller'; });
		});
		for (const map of withController) {
			const spawn = (map.structures || []).find(function (s) {
				return s.type === 'spawn' && s.owner === label;
			});
			if (spawn) return { room: map.room, x: spawn.x, y: spawn.y };
		}
		for (const map of withController) {
			if (map.controller && map.controller.owner === label) {
				return { room: map.room, x: map.controller.x, y: map.controller.y };
			}
		}
		for (const map of withController) {
			const owns = (map.structures || []).some(function (s) { return s.owner === label; })
				|| (map.creeps || []).some(function (c) { return c.owner === label; });
			if (owns) return { room: map.room, x: map.controller.x, y: map.controller.y };
		}
		return null;
	}

	// Turns each imported player label that settings.json assigned a bot to
	// (`bots: { "<label>": "<profile>" }`) into a real user running that code.
	// A label nobody assigned is left alone: its objects load under the raw
	// label exactly as before, which is what scenarios that bind their own
	// imported owners rely on.
	async bindMapPlayers(maps) {
		const sides = botModules.configuredSides();
		const unassigned = [];
		for (const label of this.mapPlayerLabels(maps)) {
			const dir = label === 'main' ? null : sides[label];
			if (!dir) { unassigned.push(label); continue; }
			const home = this.findPlayerHome(maps, label);
			if (!home) {
				warnings.warn('imported player "' + label + '" has a bot assigned but no room with a '
					+ 'controller to place them in — their objects load unbound');
				continue;
			}
			const seedSpawnName = SEED_SPAWN_PREFIX + label;
			const bot = await this.world.addBot({
				username: label, room: home.room, x: home.x, y: home.y,
				spawnName: seedSpawnName,
				modules: botModules.allBotModules(null, dir)
			});
			this.playerUserIds[label] = bot.id;
			// addBot bootstraps a spawn and a level-1 controller with a 20000-tick
			// safe mode. The map carries the player's real spawn and RCL
			// (applyMapControllers restores the controller), and an imported base
			// nothing can attack would make a siege scenario meaningless.
			await this.removeObject({ room: home.room, type: 'spawn', name: seedSpawnName });
			await this.updateObject({ room: home.room, type: 'controller' }, { safeMode: 0 });
		}
		if (unassigned.length > 0) {
			console.log('[dojo] imported players with no bot assigned (their objects load inert): '
				+ unassigned.join(', ') + ' — assign one in settings.json, e.g. { "bots": { "'
				+ unassigned[0] + '": "default" } }');
		}
		return this.playerUserIds;
	}

	// Applies each map controller's saved owner + level. Controllers are placed
	// unowned in createRoomsFromMaps (addBot needs one to exist before the bot's
	// user id does); here — after the bot exists — we claim/unclaim them so a
	// controller saved as owner:'me' level:3 loads that way, and owner:'neutral'
	// (or 'unclaimed', or no owner) loads as an unclaimed level-0 controller.
	async applyMapControllers(maps) {
		const { db } = await this.world.load();
		for (const map of maps) {
			const c = (map.structures || []).find(function (s) { return s.type === 'controller'; }) || map.controller;
			if (!c) continue;
			const claimed = c.owner != null && c.owner !== 'neutral' && c.owner !== 'unclaimed';
			const set = claimed
				? { user: this.resolveOwner(c.owner), level: c.level || 1, progress: 0 }
				: { user: null, level: 0, progress: 0, reservation: null, downgradeTime: null };
			await this.updateObject({ room: map.room, type: 'controller' }, set);
		}
	}

	// --- direct object placement ----------------------------------------

	// The general form of addCreep/addSpawn: insert ONE object into a room with
	// the engine-required fields for its type filled in (structureDefaults), its
	// owner resolved to a user id, and the room woken so the engine actually
	// processes it. Returns the new object's _id.
	//
	// Signature mirrors the mockup's world.addRoomObject on purpose — prefer this
	// one: the raw call skips defaults and room activation, so an object added
	// through it can sit inert in a dormant room forever.
	//
	// `attributes` are engine doc fields plus four conveniences:
	//   owner    — 'me' | 'invader' | 'sourceKeeper' | user id, resolved to `user`
	//              (an explicit `user` wins, as in addCreep)
	//   id       — the live server's id, kept as `_id` (map imports rely on this)
	//   amount   — dropped resources: stored in the field the engine reads
	//   activate — false to skip waking the room (bulk loads that wake it once)
	// plus the relative clocks `ticksToDecay` (road/container/rampart/powerBank/
	// deposit) and `ticksToRegeneration` (source/mineral), which become the
	// absolute deadlines the engine reads — see applyClocks for the defaults.
	// A map's own structures[]/sources[] entry can be passed straight through:
	// its type/x/y keys are dropped rather than written into the doc.
	async addObject(room, type, x, y, attributes) {
		if (NON_ROOM_OBJECT_TYPES[type]) {
			throw new Error('addObject: ' + type + ' is not a room object — use '
				+ NON_ROOM_OBJECT_TYPES[type] + '() instead');
		}
		const doc = Object.assign({}, attributes);
		// Older end-state exports included Loki's collection bookkeeping.
		// Preserve game IDs, but never insert another collection's internal ID.
		delete doc.$loki;
		delete doc.meta;
		const activate = doc.activate !== false;
		delete doc.activate;
		// Creeps need a body, boosts and a death clock built for them, so the
		// generic path is just a spelling of addCreep — same code, same doc.
		if (type === 'creep') {
			return this.addCreep(Object.assign(doc, { room: room, x: x, y: y, activate: activate }));
		}
		delete doc.type;
		delete doc.x;
		delete doc.y;
		if (doc.id !== undefined) { doc._id = doc.id; delete doc.id; }
		const owner = doc.user !== undefined ? doc.user : doc.owner;
		delete doc.owner;
		if (owner !== undefined) doc.user = this.resolveOwner(owner);
		// A dropped pile stores its size in a field NAMED after the resource
		// ('energy: 200'); the runtime's `.amount` getter reads o[o.resourceType]
		// (engine game/resources.js), so a literal `amount` field is ignored and
		// then goes stale as the engine mutates the real one.
		if (doc.amount !== undefined) {
			doc[doc.resourceType || 'energy'] = doc.amount;
			delete doc.amount;
		}
		// Mod defaults sit BETWEEN the built-in ones and the scenario's own: a
		// selected mod may know something vanilla does not (a Thorium mineral
		// needs an amount or Season 5 deletes it), but the scenario still wins.
		const withDefaults = Object.assign({}, structureDefaults(type, 1),
			modRegistry.objectDefaults(this.mods, type, doc), doc);
		await this.applyClocks(type, withDefaults);
		const result = await this.world.addRoomObjectUnchecked(room, type, x, y, withDefaults);
		// An NPC engine pins its room regardless of `activate` — that flag only
		// defers the immediate wake (bulk loads wake the room once at the end),
		// while pinning is a standing property of what was just placed.
		if (ALWAYS_ACTIVE_TYPES[type]) await this.keepRoomActive(room);
		if (activate) await this.activateRoom(room);
		return result && result._id;
	}

	// Edits objects already in the world — the counterpart to addObject, and the
	// reason a scenario no longer needs the db. `query` is a rooms.objects
	// selector ({ room, type }, { _id }, { name }...); `changes` is either plain
	// fields, which are wrapped in $set for you, or an explicit operator document
	// ({ $set: ... }, { $inc: ... }) whose $set half gets the same treatment.
	//
	// Applies addObject's input conveniences against each matched object's own
	// type: `owner` resolved to a user id, `amount` written to the field the
	// runtime reads, and relative clocks turned absolute. Clocks are only
	// converted here, never defaulted — bumping a rampart's hits must not also
	// reset its decay deadline.
	//
	// Wakes every room it touched, because a change the engine never processes
	// is a change the bot never sees. Returns how many objects were updated.
	async updateObject(query, changes) {
		const { db } = await this.world.load();
		const matched = await db['rooms.objects'].find(query);
		const rooms = new Set();
		for (const doc of matched) {
			await db['rooms.objects'].updateUnchecked({ _id: doc._id }, await this.buildUpdate(doc, changes));
			if (doc.room) rooms.add(doc.room);
		}
		for (const room of rooms) await this.activateRoom(room);
		return matched.length;
	}

	// The update document for one matched object: normalizes the fields being
	// set and leaves any other operator ($inc, $unset...) untouched.
	async buildUpdate(doc, changes) {
		const hasOperators = Object.keys(changes).some(function (key) { return key.charAt(0) === '$'; });
		const fields = Object.assign({}, hasOperators ? changes.$set : changes);
		if (fields.owner !== undefined) {
			fields.user = this.resolveOwner(fields.owner);
			delete fields.owner;
		}
		if (fields.amount !== undefined) {
			fields[fields.resourceType || doc.resourceType || 'energy'] = fields.amount;
			delete fields.amount;
		}
		await this.applyClocks(doc.type, fields, false);
		if (!hasOperators) return { $set: fields };
		return Object.assign({}, changes, Object.keys(fields).length ? { $set: fields } : {});
	}

	// Deletes objects and wakes the rooms they were in: the engine has to run a
	// tick to notice a structure is gone. Same selector as updateObject; returns
	// how many objects were removed.
	async removeObject(query) {
		const { db } = await this.world.load();
		const matched = await db['rooms.objects'].find(query);
		if (!matched.length) return 0;
		await db['rooms.objects'].removeWhereUnchecked(query);
		const rooms = new Set();
		for (const doc of matched) if (doc.room) rooms.add(doc.room);
		for (const room of rooms) await this.activateRoom(room);
		return matched.length;
	}

	// Converts the relative clocks a scenario thinks in (`ticksToDecay`,
	// `ticksToRegeneration`) into the absolute game ticks the engine reads.
	// Mutates doc. `seedDefaults` fills in the engine's own lifetime when the
	// caller gives neither — right for a NEW object, wrong for an update, where
	// it would silently reset the clock of every road you touched for some
	// unrelated reason.
	//
	// Not cosmetic: every decay handler fires on
	// `!object.nextDecayTime || gameTime >= object.nextDecayTime-1`, so a road,
	// container or rampart loaded WITHOUT a clock takes a decay hit on the very
	// first tick its room is processed, and only then gets a proper clock — an
	// imported base quietly loses a slice of its walls at tick 1. powerBank and
	// deposit are worse: they are removed when `gameTime >= decayTime-1`, and
	// `null - 1` is -1, so a null decayTime deletes the object immediately.
	async applyClocks(type, doc, seedDefaults) {
		const decay = DECAY_CLOCKS[type];
		const regen = REGEN_CLOCKS[type];
		const seed = seedDefaults !== false;
		// One gameTime read at most, and only when a clock is actually in play.
		let gameTime = null;
		const now = async () => (gameTime === null ? (gameTime = await this.world.gameTime) : gameTime);
		// Generic relative clocks from an import: `ticks: { cooldownTime: 12,
		// deployTime: 300, ... }` becomes the absolute field the engine reads, and
		// an effect's `ticksRemaining` becomes its `endTime`.
		if (doc.ticks && typeof doc.ticks === 'object') {
			for (const field of Object.keys(doc.ticks)) {
				if (typeof doc.ticks[field] === 'number') doc[field] = (await now()) + doc.ticks[field];
			}
			delete doc.ticks;
		}
		if (Array.isArray(doc.effects)) {
			const effects = [];
			for (const effect of doc.effects) {
				if (!effect || typeof effect !== 'object') continue;
				const copy = Object.assign({}, effect);
				if (typeof copy.ticksRemaining === 'number') {
					copy.endTime = (await now()) + copy.ticksRemaining;
					delete copy.ticksRemaining;
				}
				effects.push(copy);
			}
			doc.effects = effects;
		}
		if (!decay && !regen) return;
		if (decay) {
			if (doc.ticksToDecay !== undefined) {
				doc[decay.field] = (await now()) + doc.ticksToDecay;
			} else if (seed && (doc[decay.field] === undefined || doc[decay.field] === null)) {
				doc[decay.field] = (await now()) + this.engineConstant(decay.constant);
			}
		}
		// A mod may declare a resource finite — Season 5 Thorium never comes
		// back, it is deleted when it runs out — in which case a regeneration
		// deadline on it is wrong, and visible to the bot and the inspector.
		if (regen && !modRegistry.suppressesRegen(this.mods, type, doc)) {
			// A full node has nothing pending — the engine's handlers only run
			// their clock while it is empty, so seeding one would just show a
			// bogus ticksToRegeneration to the bot.
			const depleted = type === 'source'
				? (doc.energy || 0) < (doc.energyCapacity || 0)
				: !(doc.mineralAmount > 0);
			if (doc.ticksToRegeneration !== undefined) {
				doc[regen.field] = (await now()) + doc.ticksToRegeneration;
			} else if (seed && depleted && doc[regen.field] === undefined) {
				doc[regen.field] = (await now()) + this.engineConstant(regen.constant);
			}
		}
		delete doc.ticksToDecay;
		delete doc.ticksToRegeneration;
	}

	// Places a creep directly, no spawn involved. The doc mirrors the one the
	// engine's own spawn intent writes, plus the two fields only a pre-placed
	// creep needs:
	//   ageTime — the engine backfills a full lifetime on the first tick it
	//     processes a creep that has none, so omitting it still dies on time,
	//     but `creep.ticksToLive` reads undefined until then and a
	//     partially-aged creep is impossible to set up. We always stamp it.
	//   boost   — a scenario creep can never have visited a lab, so boosted
	//     parts have to be born boosted.
	// Options: room, x, y, name, body (required); user/owner, boosts,
	// ticksToLive or ageTime, store, hits, hitsMax, activate (all optional).
	// Returns the new creep's _id.
	async addCreep(creepOptions) {
		if (!creepOptions.name) throw new Error('addCreep: name is required');
		if (!Array.isArray(creepOptions.body) || creepOptions.body.length === 0) {
			throw new Error('addCreep: body is required (' + creepOptions.name + ')');
		}
		const owner = creepOptions.user !== undefined ? creepOptions.user : creepOptions.owner;
		const userId = owner === undefined ? this.botUserId : this.resolveOwner(owner);
		if (!userId) throw new Error('addCreep: no user (add the main bot first or pass user)');
		const bodyParts = this.buildCreepBody(creepOptions.body, creepOptions.boosts);
		const fullHits = bodyParts.length * BODY_PART_HITS;
		const creepDoc = {
			user: userId, name: creepOptions.name,
			body: bodyParts,
			hits: creepOptions.hits !== undefined ? creepOptions.hits : fullHits,
			hitsMax: creepOptions.hitsMax !== undefined ? creepOptions.hitsMax : fullHits,
			store: creepOptions.store || {},
			// storeCapacity ONLY, never storeCapacityResource: the latter marks an
			// object as holding a fixed set of resource types (extensions, towers),
			// and on a creep it makes store.getCapacity()/getFreeCapacity() return
			// null and every non-listed resource read as capacity 0.
			storeCapacity: this.creepStoreCapacity(bodyParts),
			ageTime: await this.creepAgeTime(bodyParts, creepOptions),
			fatigue: 0, spawning: false, notifyWhenAttacked: false
		};
		// An imported creep keeps the live server's id, like every other object.
		if (creepOptions.id !== undefined) creepDoc._id = creepOptions.id;
		const result = await this.world.addRoomObjectUnchecked(creepOptions.room, 'creep', creepOptions.x, creepOptions.y, creepDoc);
		// The engine only simulates rooms in ACTIVE_ROOMS, so a creep dropped
		// into a room nothing else keeps hot would sit frozen until that room's
		// next force update.
		if (creepOptions.activate !== false) await this.activateRoom(creepOptions.room);
		return result && result._id;
	}

	// Body in the engine's doc shape. A `body` entry is either a part type
	// ('work') or an already-built { type, boost } object; `boosts` maps a part
	// TYPE to the compound every part of that type carries
	// ({ tough: 'XGHO2', move: 'XZHO2' }). A boost on the entry itself wins.
	buildCreepBody(body, boosts) {
		return (body || []).map(function (part) {
			const type = typeof part === 'string' ? part : part.type;
			const boost = (part && part.boost !== undefined) ? part.boost
				: (boosts ? boosts[type] : undefined);
			const built = { type: type, hits: BODY_PART_HITS };
			if (boost) built.boost = boost;
			return built;
		});
	}

	// One engine constant, by name, from the running server (@screeps/common) —
	// so dojo never keeps its own copy of a game number the server can change
	// under it. Throws rather than falling back to a stale literal: a silently
	// wrong lifetime or capacity is far harder to spot than a missing constant.
	engineConstant(name) {
		const value = this.server.constants ? this.server.constants[name] : undefined;
		if (value === undefined) {
			throw new Error('engine constant ' + name + ' is unavailable from the server');
		}
		return value;
	}

	// Carry capacity of a built body, honouring carry boosts (the engine's own
	// BOOSTS.carry[compound].capacity multiplier).
	creepStoreCapacity(bodyParts) {
		const carryCapacity = this.engineConstant('CARRY_CAPACITY');
		const boostTable = this.engineConstant('BOOSTS').carry || {};
		let capacity = 0;
		for (const part of bodyParts) {
			if (part.type !== 'carry') continue;
			const boost = part.boost ? boostTable[part.boost] : null;
			capacity += carryCapacity * ((boost && boost.capacity) || 1);
		}
		return capacity;
	}

	// Absolute tick the creep dies on: an explicit `ageTime` wins, else
	// `ticksToLive` counted from now, else the engine lifetime for this body.
	async creepAgeTime(bodyParts, options) {
		if (options.ageTime !== undefined) return options.ageTime;
		const hasClaim = bodyParts.some(function (part) { return part.type === 'claim'; });
		const ticksToLive = options.ticksToLive !== undefined ? options.ticksToLive
			: this.engineConstant(hasClaim ? 'CREEP_CLAIM_LIFE_TIME' : 'CREEP_LIFE_TIME');
		return (await this.world.gameTime) + ticksToLive;
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

	// Flags are NOT room objects: one doc per (user, room) in 'rooms.flags',
	// data string in the engine wire format (spec §5).
	async addFlag(name, room, x, y, flagOptions) {
		const options = flagOptions || {};
		const userId = options.user === undefined ? this.botUserId : this.resolveOwner(options.user);
		if (!userId) throw new Error('addFlag: no user (add the main bot first or pass user)');
		const { db } = await this.world.load();
		const entry = serializeFlags([{
			name: name, x: x, y: y,
			color: options.color, secondaryColor: options.secondaryColor
		}]);
		const existing = await db['rooms.flags'].findOne({ room: room, user: userId });
		if (existing) {
			const existingFlags = parseFlags(existing.data);
			if (existingFlags.some(function (f) { return f.name === name; })) {
				throw new Error('flag ' + name + ' already exists in ' + room + ' for this user');
			}
			await db['rooms.flags'].update({ _id: existing._id }, { $set: { data: existing.data + '|' + entry } });
		} else {
			await db['rooms.flags'].insert({ room: room, user: userId, data: entry });
		}
	}

	// --- recording capture (spec §7) --------------------------------------

	// Full-fidelity frame for the recorder: raw object docs (positions, hits,
	// store, actionLog with attack/heal/say), flag docs, and the per-room
	// engine event log. Richer than readState on purpose: anything not
	// recorded can't be rendered later.
	async captureFrame() {
		const { db, env } = await this.world.load();
		const gameTime = await this.world.gameTime;
		// CPU the bot used this tick. The engine runtime persists it to the user doc each tick
		// (@screeps/driver runtime/make.js: $set.lastUsedCpu = usedTime), so we can read it here without
		// advancing the world. ms of CPU; null if unavailable (e.g. a tick the bot was skipped).
		let cpu = null;
		if (this.botUserId) {
			try {
				const users = await db.users.find({ _id: this.botUserId });
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
		if (this.botUserId) {
			for (const roomName of roomNames) {
				try {
					let raw = await env.get(env.keys.ROOM_VISUAL + this.botUserId + ',' + roomName + ',' + gameTime);
					if (!raw) raw = await env.get(env.keys.ROOM_VISUAL + this.botUserId + ',' + roomName + ',' + (gameTime - 1));
					if (raw) visuals[roomName] = raw;
				} catch (error) { /* no visuals for this room */ }
			}
		}
		return {
			gameTime: gameTime, cpu: cpu, objects: objects, flags: flags,
			eventLog: eventLog, visuals: visuals, users: await this.readUsers()
		};
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

	// --- observation -----------------------------------------------------

	// { userId: { username, score } } for every user in the world, NPCs included.
	// `score` is 0 rather than absent when the engine has never written one, so a
	// scenario can compare it without knowing whether a mod that scores is loaded.
	async readUsers() {
		const { db } = await this.world.load();
		const users = {};
		for (const doc of await db.users.find({})) {
			users[doc._id] = {
				username: doc.username,
				score: typeof doc.score === 'number' ? doc.score : 0
			};
		}
		return users;
	}


	// Snapshot read from the DB between ticks (spec §4): the runner and
	// scenario until()/expect() see ONLY this, never bot internals.
	async readState() {
		if (!this.botUserId) throw new Error('readState: add the main bot first (creep ownership is classified against it)');
		const { db } = await this.world.load();
		const gameTime = await this.world.gameTime;
		const objects = await db['rooms.objects'].find({});
		const flagDocs = await db['rooms.flags'].find({});

		const state = {
			gameTime: gameTime, creeps: {}, hostileCreeps: {}, flags: {}, objects: objects,
			// Score is a USER field, not a room object: Season 5 reactors pay the
			// reactor's owner (bulkUsers.inc(user, 'score')), so until() and
			// expect() can only see scoring through here.
			users: await this.readUsers()
		};
		for (const object of objects) {
			if (object.type !== 'creep') continue;
			const creep = {
				name: object.name, room: object.room, x: object.x, y: object.y,
				hits: object.hits, hitsMax: object.hitsMax, store: object.store, user: object.user
			};
			// Everything not owned by the main bot (scripted enemies, invaders '2', SK '3')
			// lands in hostileCreeps; distinguish by the `user` field.
			if (object.user === this.botUserId) state.creeps[object.name] = creep;
			else state.hostileCreeps[object.name] = creep;
		}
		for (const doc of flagDocs) {
			for (const flag of parseFlags(doc.data)) {
				state.flags[flag.name] = { name: flag.name, room: doc.room, x: flag.x, y: flag.y, user: doc.user };
			}
		}
		return state;
	}
}

module.exports = DojoWorld;

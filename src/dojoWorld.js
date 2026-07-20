'use strict';

// Facade over screeps-server-mockup (spec §3): the only file that touches
// mockup/server internals. Runner, loader, and (later) recorder use this API.
const { createServer, TerrainMatrix } = require('./serverBoot');
const { parseTerrain, serializeFlags, parseFlags, validateEdges, autoMirror } = require('./mapFormat');

const BODY_PART_HITS = 100;
const CARRY_CAPACITY = 50;
const NPC_USER_IDS = { invader: '2', sourceKeeper: '3' };
// Ticks after load until a keeper lair (loaded without an explicit
// nextSpawnTime) produces its FIRST source keeper. The engine's own default is
// ENERGY_REGEN_TIME (300) — far too long for a combat sandbox; respawn after a
// keeper dies still follows the engine's normal 300-tick cycle.
const KEEPER_FIRST_SPAWN_DELAY = 5;

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
			return { energy: 1000, energyCapacity: 1000, ticksToRegeneration: 300 };
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
		case 'mineral':
			return { mineralType: 'H', density: 3, mineralAmount: 3000 };
		default:
			return {};
	}
}

class DojoWorld {
	constructor() {
		this.server = createServer();
		this.bot = null;        // main bot User (set by addMainBot)
		this.botUserId = null;
		this.modules = null;    // set by the runner before setup() runs
	}

	get world() {
		return this.server.world;
	}

	async reset() {
		await this.server.world.reset();
	}

	async start() {
		await this.server.start();
	}

	stop() {
		this.server.stop();
	}

	async tick() {
		await this.activateNpcRooms();
		await this.server.tick();
	}

	// The engine only processes rooms listed in its per-tick ACTIVE_ROOMS set,
	// which is filled from player intents (and a room's own prior-tick activity).
	// NPC rooms — source-keeper lairs, invader cores — carry no player intents,
	// so without a nudge the engine never simulates them: keeper lairs never tick
	// (nextSpawnTime stays null forever) and no source keepers / invaders spawn.
	// The real backend keeps such rooms permanently active; we mirror that by
	// re-seeding every room that holds a keeper lair, an invader core, or any
	// NPC-owned (user '2'/'3') object back into ACTIVE_ROOMS before each tick.
	// ACTIVE_ROOMS is drained as the processor reads it, so this must run every
	// tick, before server.tick().
	async activateNpcRooms() {
		const { db, env } = await this.world.load();
		const npcObjects = await db['rooms.objects'].find({
			$or: [{ type: 'keeperLair' }, { type: 'invaderCore' }, { user: '2' }, { user: '3' }]
		});
		const rooms = new Set();
		for (const object of npcObjects) if (object.room) rooms.add(object.room);
		for (const room of rooms) await env.sadd(env.keys.ACTIVE_ROOMS, room);
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
			await this.world.addRoom(map.room);
			const terrain = new TerrainMatrix();
			for (const tile of parseTerrain(map.terrain)) terrain.set(tile.x, tile.y, tile.type);
			await this.world.setTerrain(map.room, terrain);
			// Controllers must exist BEFORE addBot runs: mockup's addBot throws
			// without one, and it claims the room's controller (sets user +
			// level 1) itself. Place the map's controller now — from the
			// top-level field or a structures[] entry (the editor exports the
			// latter) — and only fall back to an auto-inject at (0,0) (the
			// border wall corner, never walkable) when the map has neither.
			// placeMapObjects skips controllers to avoid duplicates.
			const structuresController = (map.structures || []).find(function (entry) {
				return entry.type === 'controller';
			});
			const controller = map.controller || structuresController;
			if (controller) {
				await this.world.addRoomObject(map.room, 'controller', controller.x, controller.y, {
					level: controller.level || 0, progress: 0
				});
			} else {
				await this.world.addRoomObject(map.room, 'controller', 0, 0, { level: 0 });
			}
		}
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
		const { db } = await this.world.load();
		await db['rooms.objects'].update({ room: options.room, type: 'controller' }, { $set: { safeMode: 0 } });
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

	async addEnemyBot(botOptions) {
		return this.world.addBot(botOptions);
	}

	// Removes the spawn(s) addBot forced into a room — for scenarios that want
	// the bot to start spawnless (e.g. probing a base plan with vision from a
	// creep, then placing the spawn where the bot's own planner wants it).
	async removeSpawns(room) {
		const { db } = await this.world.load();
		await db['rooms.objects'].removeWhere({ room: room, type: 'spawn' });
	}

	// Inserts a spawn mid-run (the sandbox equivalent of a player placing
	// their first spawn). Same doc shape addBot uses.
	async addSpawn(spawnOptions) {
		const userId = spawnOptions.user === undefined ? this.botUserId : this.resolveOwner(spawnOptions.user);
		if (!userId) throw new Error('addSpawn: no user (add the main bot first or pass user)');
		await this.world.addRoomObject(spawnOptions.room, 'spawn', spawnOptions.x, spawnOptions.y, {
			user: userId, name: spawnOptions.name || 'Spawn1',
			store: { energy: 300 }, storeCapacityResource: { energy: 300 },
			hits: 5000, hitsMax: 5000, spawning: null, notifyWhenAttacked: true
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
			for (const structure of map.structures || []) {
				// controllers were placed in createRoomsFromMaps (addBot needs
				// one to exist and claims it itself) — skip to avoid duplicates
				if (structure.type === 'controller') continue;
				const attributes = Object.assign(
					{},
					structureDefaults(structure.type, spawnIndex),
					structure
				);
				if (structure.type === 'spawn' && !structure.name) spawnIndex++;
				delete attributes.type;
				delete attributes.x;
				delete attributes.y;
				delete attributes.owner;
				if (structure.owner !== undefined) attributes.user = this.resolveOwner(structure.owner);
				// Never load a spawn stuck mid-spawn: an imported in-progress `spawning`
				// object references the live server's game time, which never elapses in
				// the sim, so the spawn jams forever and the colony can't replace creeps.
				if (structure.type === 'spawn') attributes.spawning = null;
				// Imported invader cores carry season effects (e.g. 1001 invulnerability)
				// whose endTime is a far-future season tick — in the sim that leaves the
				// core permanently invulnerable. Clear them so it can be attacked.
				if (structure.type === 'invaderCore') attributes.effects = [];
				// Imported keeper lairs carry nextSpawnTime: null, which makes the engine
				// wait a full ENERGY_REGEN_TIME (300 ticks) before the FIRST keeper appears.
				// Seed a near-term first spawn instead so keepers are present quickly. This
				// touches only the first spawn: after a keeper dies the engine reschedules
				// itself (+300), so respawn timing is unchanged. An explicit map value wins.
				if (structure.type === 'keeperLair' && (attributes.nextSpawnTime === null || attributes.nextSpawnTime === undefined)) {
					attributes.nextSpawnTime = firstKeeperSpawn;
				}
				await this.world.addRoomObject(map.room, structure.type, structure.x, structure.y, attributes);
			}
			for (const source of map.sources || []) {
				const sourceAttrs = {
					energy: source.energy !== undefined ? source.energy : 1000,
					energyCapacity: source.energyCapacity !== undefined ? source.energyCapacity : 1000,
					ticksToRegeneration: 300
				};
				// keep the live id so creep names that encode it still resolve via getObjectById
				if (source.id) sourceAttrs._id = source.id;
				await this.world.addRoomObject(map.room, 'source', source.x, source.y, sourceAttrs);
			}
			for (const mineral of map.minerals || []) {
				const mineralAttrs = {
					mineralType: mineral.mineralType, density: mineral.density || 3,
					mineralAmount: mineral.mineralAmount || 3000
				};
				if (mineral.id) mineralAttrs._id = mineral.id;
				await this.world.addRoomObject(map.room, 'mineral', mineral.x, mineral.y, mineralAttrs);
			}
			for (const flag of map.flags || []) {
				await this.addFlag(flag.name, map.room, flag.x, flag.y, flag);
			}
			for (const creep of map.creeps || []) {
				const userId = this.resolveOwner(creep.owner === undefined ? 'me' : creep.owner);
				const bodyParts = creep.body.map(function (type) { return { type: type, hits: BODY_PART_HITS }; });
				const carryParts = creep.body.filter(function (type) { return type === 'carry'; }).length;
				await this.world.addRoomObject(map.room, 'creep', creep.x, creep.y, {
					user: userId, name: creep.name,
					body: bodyParts,
					hits: creep.hits !== undefined ? creep.hits : bodyParts.length * BODY_PART_HITS,
					hitsMax: creep.hitsMax !== undefined ? creep.hitsMax : bodyParts.length * BODY_PART_HITS,
					store: creep.store || {}, storeCapacity: carryParts * CARRY_CAPACITY,
					fatigue: 0, spawning: false, notifyWhenAttacked: false
				});
			}
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
		await this.createRoomsFromMaps(maps, options);

		const opts = Object.assign({}, botOptions);
		const home = this.findHomeSpawn(maps);
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
		if (options && options.memory !== undefined) await this.seedMemory(options.memory);
		if (options && options.segments !== undefined) await this.seedSegments(options.segments);
		await this.placeMapObjects(maps);
		await this.applyMapControllers(maps);

		if (adoptHome && bootstrapSpawnId !== null) {
			// addBot's bootstrap Spawn1 now overlaps the map's real spawn; remove
			// the placeholder so only the map-defined spawn remains.
			const { db } = await this.world.load();
			await db['rooms.objects'].removeWhere({ _id: bootstrapSpawnId });
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
			await db['rooms.objects'].update({ room: map.room, type: 'controller' }, { $set: set });
		}
	}

	// --- direct object placement ----------------------------------------

	async addCreep(creepOptions) {
		if (!creepOptions.name) throw new Error('addCreep: name is required');
		const userId = creepOptions.user === undefined ? this.botUserId : this.resolveOwner(creepOptions.user);
		if (!userId) throw new Error('addCreep: no user (add the main bot first or pass user)');
		const bodyParts = creepOptions.body.map(function (type) {
			return { type: type, hits: BODY_PART_HITS };
		});
		const carryParts = creepOptions.body.filter(function (type) { return type === 'carry'; }).length;
		await this.world.addRoomObject(creepOptions.room, 'creep', creepOptions.x, creepOptions.y, {
			user: userId, name: creepOptions.name,
			body: bodyParts,
			hits: bodyParts.length * BODY_PART_HITS, hitsMax: bodyParts.length * BODY_PART_HITS,
			store: {}, storeCapacity: carryParts * CARRY_CAPACITY,
			fatigue: 0, spawning: false, notifyWhenAttacked: false
		});
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

	// --- observation -----------------------------------------------------

	// Snapshot read from the DB between ticks (spec §4): the runner and
	// scenario until()/expect() see ONLY this, never bot internals.
	async readState() {
		if (!this.botUserId) throw new Error('readState: add the main bot first (creep ownership is classified against it)');
		const { db } = await this.world.load();
		const gameTime = await this.world.gameTime;
		const objects = await db['rooms.objects'].find({});
		const flagDocs = await db['rooms.flags'].find({});

		const state = { gameTime: gameTime, creeps: {}, hostileCreeps: {}, flags: {}, objects: objects };
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

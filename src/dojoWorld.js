'use strict';

// The world facade (spec §3): runner, loader, and recorder use this API and
// nothing below it. The class splits in two along the engine seam (issue #1):
// this file keeps every engine-agnostic decision — type defaults, decay and
// regeneration clocks, owner resolution, map orchestration, input validation —
// and a driver (src/drivers/) does the actual reads and writes against one
// engine's storage. Drivers are required lazily, so loading this file pulls in
// no engine at all: a future in-process engine has to be able to run outside
// the container, where screeps-server-mockup is not even installed.
const { parseTerrain, validateEdges, autoMirror } = require('./mapFormat');

// Engines by name, as require PATHS rather than required modules — the whole
// point of the seam is that a driver's engine stack loads only when a world
// is actually constructed against it.
const DRIVERS = { mockup: './drivers/mockupDriver' };

// Not a game constant: the engine hardcodes 100 per part when it builds a body
// (processor/intents/spawns/create-creep.js). Everything else here comes from
// the engine's own constants at runtime — see engineConstant().
const BODY_PART_HITS = 100;
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
		case 'mineral':
			return { mineralType: 'H', density: 3 };
		default:
			return {};
	}
}

class DojoWorld {
	// `options.engine` picks the driver ('mockup' is the default and, so far,
	// the only one). Selection is a constructor concern on purpose: by the
	// time a DojoWorld exists its engine is loaded and fixed.
	constructor(options) {
		const engine = (options && options.engine) || 'mockup';
		if (!DRIVERS[engine]) {
			throw new Error("unknown engine '" + engine + "' — available: " + Object.keys(DRIVERS).join(', '));
		}
		const Driver = require(DRIVERS[engine]);
		this.driver = new Driver();
		this.bot = null;        // main bot User (set by addMainBot)
		this.botUserId = null;
		this.modules = null;    // set by the runner before setup() runs
	}

	// The raw mockup world — the mockup-only escape hatch the integration
	// tests assert against. Nothing engine-agnostic may rely on it.
	get world() {
		return this.driver.world;
	}

	async reset() {
		await this.driver.reset();
	}

	async start() {
		await this.driver.start();
	}

	stop() {
		this.driver.stop();
	}

	async tick() {
		await this.driver.tick();
	}

	// What the underlying engine can and cannot simulate — the runner surfaces
	// this on the start event so scenarios can adapt to a partial engine.
	engineFeatures() {
		return this.driver.engineFeatures();
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
			await this.driver.createRoom(map.room);
			await this.driver.setTerrain(map.room, parseTerrain(map.terrain));
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
			// Straight to the driver (not addObject) on purpose: this runs BEFORE
			// the bot exists, so there is no owner to resolve yet —
			// applyMapControllers claims them afterwards — and a controller has
			// neither type defaults nor a clock. Waking the room here would be
			// pointless too: nothing else is in it yet.
			if (controller) {
				await this.driver.insertObject(map.room, 'controller', controller.x, controller.y, {
					level: controller.level || 0, progress: 0
				});
			} else {
				await this.driver.insertObject(map.room, 'controller', 0, 0, { level: 0 });
			}
		}
	}

	async addMainBot(botOptions) {
		const options = Object.assign({ username: 'dojo', modules: this.modules || {} }, botOptions);
		this.bot = await this.driver.addBot(options);
		this.botUserId = this.bot.id;

		// Surface bot runtime crashes. An uncaught exception in the bot's loop
		// (typo, bad API call, pathfinding into an unloaded room…) is otherwise
		// invisible: the bot just silently does nothing. The driver watches the
		// engine's error channel; the dedup here collapses the same error
		// repeating every tick, and takeBotErrors hands the rest to the runner.
		this._botErrors = [];
		this._lastBotError = null;
		try {
			await this.driver.subscribeBotErrors(this.botUserId, (err) => {
				if (err === this._lastBotError) return;
				this._lastBotError = err;
				this._botErrors.push(err);
			});
		} catch (e) { /* error channel unavailable — non-fatal, just no error capture */ }
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
		const json = typeof memory === 'string' ? memory : JSON.stringify(memory);
		await this.driver.seedMemory(this.botUserId, json);
	}

	// Seeds RawMemory segment contents. `segments` is a map of
	// segmentNumber -> string. The bot still selects active segments at runtime.
	async seedSegments(segments) {
		if (!this.botUserId) throw new Error('seedSegments: add the main bot first');
		const normalized = {};
		for (const key of Object.keys(segments)) {
			const value = segments[key];
			normalized[key] = typeof value === 'string' ? value : JSON.stringify(value);
		}
		await this.driver.seedSegments(this.botUserId, normalized);
	}

	async addEnemyBot(botOptions) {
		return this.driver.addBot(botOptions);
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
		const firstKeeperSpawn = (await this.driver.gameTime()) + KEEPER_FIRST_SPAWN_DELAY;
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
			const matched = await this.driver.findObjects({ room: home.room, type: 'spawn', x: home.x, y: home.y });
			bootstrapSpawnId = matched.length ? matched[0]._id : null;
		}
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

	// Applies each map controller's saved owner + level. Controllers are placed
	// unowned in createRoomsFromMaps (addBot needs one to exist before the bot's
	// user id does); here — after the bot exists — we claim/unclaim them so a
	// controller saved as owner:'me' level:3 loads that way, and owner:'neutral'
	// (or 'unclaimed', or no owner) loads as an unclaimed level-0 controller.
	async applyMapControllers(maps) {
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
		const withDefaults = Object.assign({}, structureDefaults(type, 1), doc);
		await this.applyClocks(type, withDefaults);
		const result = await this.driver.insertObject(room, type, x, y, withDefaults);
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
		const matched = await this.driver.findObjects(query);
		const rooms = new Set();
		for (const doc of matched) {
			await this.driver.updateObjectById(doc._id, await this.buildUpdate(doc, changes));
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
		const matched = await this.driver.findObjects(query);
		if (!matched.length) return 0;
		await this.driver.removeObjectsWhere(query);
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
		if (!decay && !regen) return;
		const seed = seedDefaults !== false;
		// One gameTime read at most, and only when a clock is actually in play.
		let gameTime = null;
		const now = async () => (gameTime === null ? (gameTime = await this.driver.gameTime()) : gameTime);
		if (decay) {
			if (doc.ticksToDecay !== undefined) {
				doc[decay.field] = (await now()) + doc.ticksToDecay;
			} else if (seed && (doc[decay.field] === undefined || doc[decay.field] === null)) {
				doc[decay.field] = (await now()) + this.engineConstant(decay.constant);
			}
		}
		if (regen) {
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
		const result = await this.driver.insertObject(creepOptions.room, 'creep', creepOptions.x, creepOptions.y, {
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
		});
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

	// One engine constant, by name, from the running engine — so dojo never
	// keeps its own copy of a game number the engine can change under it.
	// Throws rather than falling back to a stale literal: a silently wrong
	// lifetime or capacity is far harder to spot than a missing constant.
	engineConstant(name) {
		const value = this.driver.constant(name);
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
		return (await this.driver.gameTime()) + ticksToLive;
	}

	// Wakes a room for the next tick — see the driver's activateRoom for why a
	// room even needs waking (the engine's ACTIVE_ROOMS work list).
	async activateRoom(roomName) {
		await this.driver.activateRoom(roomName);
	}

	// Pins a room active permanently (NPC rooms must run every tick, not on the
	// force-update cadence) — mechanics in the driver's keepRoomActive.
	async keepRoomActive(roomName) {
		await this.driver.keepRoomActive(roomName);
	}

	// Flags are NOT room objects — the driver stores them in the engine's own
	// flag format; this end resolves and validates the owner.
	async addFlag(name, room, x, y, flagOptions) {
		const options = flagOptions || {};
		const userId = options.user === undefined ? this.botUserId : this.resolveOwner(options.user);
		if (!userId) throw new Error('addFlag: no user (add the main bot first or pass user)');
		await this.driver.addFlag(userId, room, {
			name: name, x: x, y: y,
			color: options.color, secondaryColor: options.secondaryColor
		});
	}

	// --- recording capture (spec §7) --------------------------------------

	// Full-fidelity frame for the recorder: raw object docs, flags, the per-room
	// engine event log, RoomVisual draws, cpu. Assembled by the driver — what a
	// frame can carry is a property of the engine.
	async captureFrame() {
		return this.driver.captureFrame(this.botUserId);
	}

	// Terrain as the map-format char rows, keyed by room name. Captured once
	// per recording (terrain never changes).
	async captureTerrain() {
		return this.driver.captureTerrain();
	}

	// --- observation -----------------------------------------------------

	// Snapshot read from the DB between ticks (spec §4): the runner and
	// scenario until()/expect() see ONLY this, never bot internals.
	async readState() {
		if (!this.botUserId) throw new Error('readState: add the main bot first (creep ownership is classified against it)');
		const gameTime = await this.driver.gameTime();
		const objects = await this.driver.findObjects({});

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
		for (const flag of await this.driver.readFlags()) {
			state.flags[flag.name] = flag;
		}
		return state;
	}
}

module.exports = DojoWorld;

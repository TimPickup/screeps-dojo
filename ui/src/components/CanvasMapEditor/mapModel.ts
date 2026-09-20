import { BODY_PART_HITS, STRUCTURE_HITS, rampartHitsFor, roadHitsFor } from './gameData';

export interface EditableObject extends Record<string, unknown> {
	type: string;
	x: number;
	y: number;
	owner?: string;
	store?: Record<string, number>;
	level?: number;
	id?: string;
	mineralType?: string;
	density?: number;
	name?: string;
	body?: unknown;
	boosts?: Record<string, string>;
}

export interface EditableFlag extends Record<string, unknown> {
	name: string;
	x: number;
	y: number;
	// COLOR_* (1..10). The loader passes both straight to the engine's flag
	// serializer (src/dojoWorld.js addFlag), so they round-trip as-is.
	color?: number;
	secondaryColor?: number;
}

export interface EditableMap {
	room: string;
	terrain: string[];
	// Everything that lives on a tile, creeps included: one array keeps
	// selection, deletion, dragging and the properties panel uniform. It is
	// split back into the map file's structures/sources/minerals/creeps/
	// controller sections on serialize.
	structures: EditableObject[];
	flags: EditableFlag[];
	// Entries in the file's `creeps` array with no usable x/y. The editor
	// cannot show them on a tile, but a map file is the user's data — they are
	// preserved verbatim and written back out rather than quietly dropped.
	strayCreeps: unknown[];
	extra: Record<string, unknown>;
}

const MODELLED_TOP_LEVEL = new Set(['room', 'terrain', 'structures', 'flags', 'sources', 'minerals', 'controller', 'creeps']);
// Only the three fields the structure serializer writes in a fixed position,
// plus the two it writes conditionally. EVERYTHING else on a structure passes
// through untouched.
//
// This list used to also hold level/mineralType/density/energy/energyCapacity/
// mineralAmount — which meant a lab loaded with a mineral lost `mineralType`
// and `mineralAmount` the moment the editor saved the file, and a stronghold's
// invader core lost `level: 0`. A structure is not a source or a mineral, so
// there was never a reason to strip those from it.
const STRUCTURE_MANAGED = new Set(['type', 'x', 'y', 'owner', 'store']);
// Creep fields the serializer writes itself; anything else on a creep (hits,
// hitsMax, ticksToLive, fatigue, an imported id …) passes through untouched.
const CREEP_MANAGED = new Set(['type', 'x', 'y', 'owner', 'store', 'name', 'body', 'boosts']);
const FLAG_MANAGED = new Set(['name', 'x', 'y']);

function randomObjectId(): string {
	const bytes = new Uint8Array(12);
	if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
	else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function positioned(value: unknown): value is Record<string, unknown> & { x: number; y: number } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const object = value as Record<string, unknown>;
	return typeof object.x === 'number' && Number.isFinite(object.x)
		&& typeof object.y === 'number' && Number.isFinite(object.y);
}

export function parseEditableMap(input: string | unknown): { map: EditableMap | null; error: string | null } {
	try {
		const raw = typeof input === 'string' ? JSON.parse(input) : input;
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('map must be an object');
		const source = raw as Record<string, unknown>;
		if (typeof source.room !== 'string' || !source.room) throw new Error('missing room');
		if (!Array.isArray(source.terrain) || source.terrain.length !== 50) throw new Error('terrain must contain 50 rows');
		const terrain = source.terrain.map((row, index) => {
			if (typeof row !== 'string' || row.length !== 50) throw new Error(`terrain row ${index} must contain 50 tiles`);
			return row;
		});

		const structures: EditableObject[] = [];
		for (const value of (Array.isArray(source.structures) ? source.structures : [])) {
			if (!positioned(value) || typeof value.type !== 'string') continue;
			const object = { ...value } as EditableObject;
			if ((object.type === 'source' || object.type === 'mineral') && !object.id) object.id = randomObjectId();
			structures.push(object);
		}
		for (const value of (Array.isArray(source.sources) ? source.sources : [])) {
			if (!positioned(value)) continue;
			const object: EditableObject = { type: 'source', x: value.x, y: value.y, id: String(value.id || randomObjectId()) };
			if (value.energy != null) object.energy = value.energy;
			if (value.energyCapacity != null) object.energyCapacity = value.energyCapacity;
			structures.push(object);
		}
		for (const value of (Array.isArray(source.minerals) ? source.minerals : [])) {
			if (!positioned(value)) continue;
			const object: EditableObject = {
				type: 'mineral', x: value.x, y: value.y, id: String(value.id || randomObjectId()),
				mineralType: typeof value.mineralType === 'string' ? value.mineralType : 'H',
				density: typeof value.density === 'number' ? value.density : 3,
			};
			if (value.mineralAmount != null) object.mineralAmount = value.mineralAmount;
			structures.push(object);
		}
		if (positioned(source.controller) && !structures.some((object) => object.type === 'controller')) {
			const controller: EditableObject = { type: 'controller', x: source.controller.x, y: source.controller.y };
			if (source.controller.owner != null) controller.owner = String(source.controller.owner);
			if (typeof source.controller.level === 'number') controller.level = source.controller.level;
			structures.push(controller);
		}
		// Creeps become ordinary tile objects with type 'creep'. They were
		// previously carried through `extra` untouched — visible in the run,
		// invisible in the editor.
		const strayCreeps: unknown[] = [];
		for (const value of (Array.isArray(source.creeps) ? source.creeps : [])) {
			if (!positioned(value)) { strayCreeps.push(value); continue; }
			const creep = { ...value, type: 'creep' } as EditableObject;
			if (typeof creep.name !== 'string' || !creep.name) creep.name = nextCreepName(structures);
			if (!Array.isArray(creep.body)) creep.body = ['move'];
			structures.push(creep);
		}

		const flags: EditableFlag[] = [];
		for (const value of (Array.isArray(source.flags) ? source.flags : [])) {
			if (!positioned(value)) continue;
			flags.push({ ...value, name: typeof value.name === 'string' ? value.name : 'flag', x: value.x, y: value.y } as EditableFlag);
		}
		const extra: Record<string, unknown> = {};
		for (const key of Object.keys(source)) if (!MODELLED_TOP_LEVEL.has(key)) extra[key] = source[key];
		return { map: { room: source.room, terrain, structures, flags, strayCreeps, extra }, error: null };
	} catch (error) {
		return { map: null, error: String((error as Error).message || error) };
	}
}

export function serializeEditableMap(map: EditableMap): string {
	const structures: Record<string, unknown>[] = [];
	const sources: Record<string, unknown>[] = [];
	const minerals: Record<string, unknown>[] = [];
	const creeps: Record<string, unknown>[] = [];
	let controller: Record<string, unknown> | null = null;

	for (const object of map.structures) {
		if (object.type === 'source') {
			if (!object.id) object.id = randomObjectId();
			const source: Record<string, unknown> = { x: object.x, y: object.y, id: object.id };
			if (object.energy != null) source.energy = object.energy;
			if (object.energyCapacity != null) source.energyCapacity = object.energyCapacity;
			sources.push(source);
		} else if (object.type === 'mineral') {
			if (!object.id) object.id = randomObjectId();
			const mineral: Record<string, unknown> = {
				x: object.x, y: object.y, mineralType: object.mineralType || 'H',
				density: object.density || 3, id: object.id,
			};
			if (object.mineralAmount != null) mineral.mineralAmount = object.mineralAmount;
			minerals.push(mineral);
		} else if (object.type === 'controller') {
			controller = { x: object.x, y: object.y };
			for (const key of Object.keys(object)) {
				if (key === 'type' || key === 'x' || key === 'y' || key === 'owner' || key === 'level') continue;
				controller[key] = object[key];
			}
			if (object.owner != null) controller.owner = object.owner;
			// Written even when it is 0. An unclaimed controller legitimately
			// says `level: 0`, and dropping it made every such map look edited
			// the instant it was opened.
			if (typeof object.level === 'number') controller.level = object.level;
		} else if (object.type === 'creep') {
			// addCreep requires name + a non-empty body, so both are always
			// written even when the object somehow lost them.
			const creep: Record<string, unknown> = {
				name: object.name || 'creep', x: object.x, y: object.y,
				body: Array.isArray(object.body) && object.body.length ? object.body : ['move'],
			};
			if (object.owner != null) creep.owner = object.owner;
			if (object.boosts && Object.keys(object.boosts).length) creep.boosts = object.boosts;
			if (object.store && Object.keys(object.store).length) creep.store = object.store;
			for (const key of Object.keys(object)) if (!CREEP_MANAGED.has(key)) creep[key] = object[key];
			creeps.push(creep);
		} else {
			const structure: Record<string, unknown> = { type: object.type, x: object.x, y: object.y };
			for (const key of Object.keys(object)) if (!STRUCTURE_MANAGED.has(key)) structure[key] = object[key];
			if (object.owner != null) structure.owner = object.owner;
			if (object.store && Object.keys(object.store).length) structure.store = object.store;
			structures.push(structure);
		}
	}

	const output: Record<string, unknown> = {
		room: map.room,
		terrain: map.terrain.slice(),
		structures,
		flags: map.flags.map((flag) => {
			const entry: Record<string, unknown> = { name: flag.name, x: flag.x, y: flag.y };
			for (const key of Object.keys(flag)) if (!FLAG_MANAGED.has(key)) entry[key] = flag[key];
			return entry;
		}),
	};
	if (sources.length) output.sources = sources;
	if (minerals.length) output.minerals = minerals;
	const allCreeps = creeps.concat(map.strayCreeps as Record<string, unknown>[]);
	if (allCreeps.length) output.creeps = allCreeps;
	if (controller) output.controller = controller;
	for (const key of Object.keys(map.extra)) output[key] = map.extra[key];
	return JSON.stringify(output, null, '\t');
}

// Which objects may share a tile. A road sits under everything, a rampart over
// everything, a creep stands on top of whatever is there, and loose objects
// (dropped resources, tombstones, ruins) lie beside each other freely — so
// placing one only displaces something on the SAME layer.
export function structureLayer(type: string): 'floor' | 'overlay' | 'main' | 'unit' | 'loose' {
	if (type === 'road') return 'floor';
	if (type === 'rampart') return 'overlay';
	if (type === 'creep') return 'unit';
	if (type === 'energy' || type === 'tombstone' || type === 'ruin') return 'loose';
	return 'main';
}

// Picker/selection order for objects sharing a tile: the thing you are most
// likely to have meant to click comes first.
const SELECT_RANK: Record<string, number> = { unit: 0, loose: 1, main: 2, overlay: 3, floor: 4 };
export function selectionRank(type: string): number {
	return SELECT_RANK[structureLayer(type)] ?? 5;
}

export function nextCreepName(existing: readonly EditableObject[]): string {
	const used = new Set(existing.filter((object) => object.type === 'creep').map((object) => String(object.name || '')));
	for (let index = 1; index < 10000; index++) {
		const name = 'creep' + index;
		if (!used.has(name)) return name;
	}
	return 'creep' + randomObjectId().slice(0, 6);
}

export function nextFlagName(existing: readonly EditableFlag[]): string {
	const used = new Set(existing.map((flag) => flag.name));
	for (let index = 0; index < 10000; index++) {
		const name = 'flag' + index;
		if (!used.has(name)) return name;
	}
	return 'flag' + randomObjectId().slice(0, 6);
}

// A newly placed object, with the engine-required fields for its type. Mirrors
// src/dojoWorld.js structureDefaults where one exists, so what the editor draws
// is what the run loads.
export function makeEditableObject(
	type: string,
	x: number,
	y: number,
	context: { terrainTile?: string; existing?: readonly EditableObject[]; rcl?: number } = {},
): EditableObject {
	const object: EditableObject = { type, x, y };
	if (['spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab', 'factory',
		'nuker', 'powerSpawn', 'observer', 'extractor', 'rampart'].includes(type)) object.owner = 'me';
	// Store-bearing structures get an empty store: the runtime's `.store`
	// getter does Object.entries(store), which throws on undefined and crashes
	// any bot creep that inspects one.
	if (['storage', 'terminal', 'container', 'factory', 'lab', 'link', 'nuker', 'powerSpawn', 'reactor'].includes(type)) object.store = {};
	if (type === 'spawn') { object.store = { energy: 300 }; object.name = nextSpawnName(context.existing || []); }
	if (type === 'extension' || type === 'tower') object.store = { energy: 0 };
	// A power bank's power IS its store — the engine reads `.power` as
	// `store.power`. Starts as a full vanilla bank (POWER_BANK_CAPACITY_MAX).
	if (type === 'powerBank') object.store = { power: 5000 };
	if (type === 'controller') object.level = 0;
	if (type === 'mineral') { object.mineralType = 'H'; object.density = 3; }
	if (type === 'source') { object.energy = 3000; object.energyCapacity = 3000; }
	if (type === 'source' || type === 'mineral') object.id = randomObjectId();
	if (type === 'creep') {
		object.name = nextCreepName(context.existing || []);
		object.body = ['move'];
		object.owner = 'me';
		object.store = {};
		// A creep's hit points ARE its body — without them the panel has no
		// hits row to show and the engine has to backfill.
		object.hits = BODY_PART_HITS;
		object.hitsMax = BODY_PART_HITS;
	}
	if (type === 'energy') { object.resourceType = 'energy'; object.amount = 500; }
	if (type === 'tombstone') { object.store = {}; object.ticks = { decayTime: 100 }; }
	if (type === 'ruin') { object.store = {}; object.ticks = { decayTime: 500 }; }
	if (type === 'deposit') { object.depositType = 'silicon'; object.cooldown = 0; }
	if (type === 'portal') object.destination = { room: 'W1N1', x: 25, y: 25 };
	if (type === 'constructionSite') { object.structureType = 'extension'; object.progress = 0; object.progressTotal = 3000; object.owner = 'me'; }
	if (type === 'invaderCore') { object.owner = 'invader'; object.level = 1; }

	if (object.hits === undefined) {
		const hits = type === 'road' ? roadHitsFor(context.terrainTile || '.')
			: type === 'rampart' ? rampartHitsFor(context.rcl ?? 8)
				: STRUCTURE_HITS[type];
		if (hits) { object.hits = hits; object.hitsMax = hits; }
	}
	return object;
}

function nextSpawnName(existing: readonly EditableObject[]): string {
	const used = new Set(existing.filter((object) => object.type === 'spawn').map((object) => String(object.name || '')));
	// addBot already creates Spawn1, and placeMapObjects names unnamed map
	// spawns from Spawn2 up — start there so an editor-named spawn does not
	// collide with the bot's own.
	for (let index = 2; index < 1000; index++) {
		const name = 'Spawn' + index;
		if (!used.has(name)) return name;
	}
	return 'Spawn' + randomObjectId().slice(0, 4);
}

// The room's RCL, which drives the build panel's per-structure limits and an
// extension's energy capacity. An unclaimed or absent controller is RCL 0.
export function mapRcl(map: EditableMap | null): number {
	if (!map) return 0;
	const controller = map.structures.find((object) => object.type === 'controller');
	if (!controller) return 0;
	const owner = controller.owner;
	if (owner == null || owner === 'neutral' || owner === 'unclaimed') return 0;
	const level = Number(controller.level);
	return Number.isFinite(level) ? Math.max(0, Math.min(8, level)) : 0;
}

export function countByType(map: EditableMap | null): Record<string, number> {
	const counts: Record<string, number> = {};
	if (!map) return counts;
	for (const object of map.structures) counts[object.type] = (counts[object.type] || 0) + 1;
	counts.flag = map.flags.length;
	return counts;
}

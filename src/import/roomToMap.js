'use strict';

// Pure transform: raw engine room-object docs -> dojo map.json.
// Classification/filtering rules live here; no network, no server deps.

const OWNER_TAGS = { me: 'me', invader: 'invader', sourceKeeper: 'sourceKeeper' };

// Structure types the dojo server can place (engine `type` values). Anything
// not here, and not source/mineral/controller/creep, is dropped as unknown.
//
// A game mod adds to this list: `extraStructureTypes` carries the types the
// scenario's selected mods introduce (src/mods.js importTypes), so importing a
// live Season 5 room keeps its reactor instead of counting it as unknown.
const KNOWN_STRUCTURES = new Set([
	'spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab',
	'factory', 'observer', 'powerSpawn', 'nuker', 'rampart', 'constructedWall',
	'road', 'container', 'extractor', 'keeperLair', 'invaderCore'
]);

// Engine object fields we never copy onto a structure entry (positional/identity
// or engine-internal); everything else passes through (hits, store, level, etc.).
//
// `launchTime` is a Season 5 reactor's absolute start tick on the LIVE server —
// millions of ticks ahead of a fresh sim, where `gameTime - launchTime` goes
// negative and the mod's score formula (log10 of it) turns into NaN. A reactor
// starts its clock again on its first tick here, which is what a scenario wants.
const STRUCTURE_OMIT = new Set(['_id', 'type', 'x', 'y', 'room', 'user', 'spawning', 'launchTime']);

function cleanStore(store) {
	if (!store || typeof store !== 'object') return undefined;
	const out = {};
	let any = false;
	for (const key of Object.keys(store)) {
		if (typeof store[key] === 'number' && store[key] > 0) { out[key] = store[key]; any = true; }
	}
	return any ? out : undefined;
}

function roomToMap(input) {
	const objects = input.objects || [];
	const known = new Set(KNOWN_STRUCTURES);
	for (const type of input.extraStructureTypes || []) known.add(type);
	const classifyOwner = input.classifyOwner;
	const includeMyCreeps = input.includeMyCreeps !== false;
	const includeMyStructures = input.includeMyStructures !== false;
	const map = {
		room: input.roomName,
		terrain: input.terrainRows,
		structures: [],
		sources: [],
		minerals: [],
		creeps: []
	};
	const skipped = {};

	for (const object of objects) {
		const tag = object.user ? classifyOwner(object.user) : 'neutral';

		if (object.type === 'controller') {
			// Preserve ownership: without it an owned base imports UNCLAIMED (RCL 0)
			// and every structure — spawns included — goes inactive. Uses the same
			// owner classifier as structures/creeps (me/invader/sourceKeeper).
			const controller = { x: object.x, y: object.y, level: object.level || 0 };
			if (object.user && OWNER_TAGS[tag]) controller.owner = OWNER_TAGS[tag];
			map.controller = controller;
			continue;
		}
		if (object.type === 'source') {
			// preserve the live id: the bot encodes source ids in creep names, so the
			// loader must recreate sources with their original ids or mining breaks
			const source = { x: object.x, y: object.y };
			if (object._id) source.id = object._id;
			map.sources.push(source);
			continue;
		}
		if (object.type === 'mineral') {
			const mineral = { x: object.x, y: object.y, mineralType: object.mineralType, density: object.density };
			if (object._id) mineral.id = object._id;
			// How much is actually LEFT. Without it the map re-seeds a full node,
			// which silently rewinds a half-mined mineral — and for a finite
			// resource like Season 5 Thorium there is no "full" to fall back to.
			if (typeof object.mineralAmount === 'number') mineral.mineralAmount = object.mineralAmount;
			map.minerals.push(mineral);
			continue;
		}
		if (object.type === 'creep') {
			// A spawning creep is still represented by its spawn. Recreating it as
			// an active map creep would duplicate it and skip the spawn process.
			if (tag !== 'me' || !includeMyCreeps || object.spawning) continue;
			const creep = {
				name: object.name, x: object.x, y: object.y, owner: 'me',
				body: (object.body || []).map(function (part) { return part.type; }),
				hits: object.hits, hitsMax: object.hitsMax
			};
			const store = cleanStore(object.store);
			if (store) creep.store = store;
			map.creeps.push(creep);
			continue;
		}
		if (known.has(object.type)) {
			// Drop other players' structures; keep mine / npc / neutral.
			if (object.user && tag === null) continue;
			if (tag === 'me' && !includeMyStructures) continue;
			const entry = { type: object.type, x: object.x, y: object.y };
			if (object.user && OWNER_TAGS[tag]) entry.owner = OWNER_TAGS[tag];
			for (const key of Object.keys(object)) {
				if (STRUCTURE_OMIT.has(key) || key === 'store') continue;
				entry[key] = object[key];
			}
			const store = cleanStore(object.store);
			if (store) entry.store = store;
			map.structures.push(entry);
			continue;
		}
		// Unknown custom type (e.g. Season 'score'): drop + count.
		skipped[object.type] = (skipped[object.type] || 0) + 1;
	}

	return { map: map, skipped: skipped };
}

module.exports = { roomToMap: roomToMap, KNOWN_STRUCTURES: KNOWN_STRUCTURES };

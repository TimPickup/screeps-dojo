'use strict';

// Pure transform: raw engine room-object docs -> dojo map.json.
// Classification/filtering rules live here; no network, no server deps.

const OWNER_TAGS = { me: 'me', invader: 'invader', sourceKeeper: 'sourceKeeper' };

// Structure types the dojo server can place (engine `type` values). Anything
// not here, and not source/mineral/controller/creep, is dropped as unknown.
const KNOWN_STRUCTURES = new Set([
	'spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab',
	'factory', 'observer', 'powerSpawn', 'nuker', 'rampart', 'constructedWall',
	'road', 'container', 'extractor', 'keeperLair', 'invaderCore'
]);

// Engine object fields we never copy onto a structure entry (positional/identity
// or engine-internal); everything else passes through (hits, store, level, etc.).
const STRUCTURE_OMIT = new Set(['_id', 'type', 'x', 'y', 'room', 'user', 'spawning']);

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
	const classifyOwner = input.classifyOwner;
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
			map.controller = { x: object.x, y: object.y, level: object.level || 0 };
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
			map.minerals.push(mineral);
			continue;
		}
		if (object.type === 'creep') {
			if (tag !== 'me') continue; // only my creeps
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
		if (KNOWN_STRUCTURES.has(object.type)) {
			// Drop other players' structures; keep mine / npc / neutral.
			if (object.user && tag === null) continue;
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

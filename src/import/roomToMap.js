'use strict';

// Pure transform: raw engine room-object docs -> dojo map.json.
// Classification/filtering rules live here; no network, no server deps.

// Owner tags that are NOT another player: my bot and the two NPC users. Every
// other non-null tag from the classifier is a player LABEL (see
// src/import/ownerLabels.js), which a scenario's settings.json can assign a bot
// codebase to. A null tag means the owner could not be resolved at all — those
// objects are dropped rather than given an owner the sim cannot create.
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
	'road', 'container', 'extractor', 'keeperLair', 'invaderCore', 'powerBank'
]);

// Absolute-tick decay deadlines that have to be REBASED onto the sim clock,
// per type and field name. A live doc's deadline is counted from the source
// server's own tick (~264k on season, tens of millions on shard0); copied
// verbatim into a sim that starts near 0 it sits forever in the future, so the
// object simply never decays — and for a power bank the 5000-tick clock is the
// whole mechanic. We emit the dojo's relative `ticksToDecay` instead and let
// the loader turn it back into an absolute deadline (dojoWorld applyClocks).
//
// constructedWall is deliberately ABSENT even though it carries a `decayTime`:
// there the field means a temporary newbie/respawn wall, not a decay clock, and
// rebasing it would make every wall in an imported base expire.
const ABSOLUTE_DECAY_FIELDS = {
	powerBank: 'decayTime',
	deposit: 'decayTime',
	road: 'nextDecayTime',
	container: 'nextDecayTime',
	rampart: 'nextDecayTime'
};

// Other absolute-tick clocks a live doc can carry (cooldowns, a stronghold's
// deploy/expand timers, a keeper lair's next spawn). Rebased the same way into
// the map's relative `ticks` table, which the loader turns back into absolute
// deadlines against the sim clock. A clock already in the past is dropped —
// the engine treats a missing one as "ready".
const ABSOLUTE_TICK_FIELDS = ['cooldownTime', 'deployTime', 'nextExpandTime', 'nextSpawnTime'];

// Rebase a doc's `effects[]` (power/season effects with an absolute `endTime`)
// onto relative `ticksRemaining`. Expired effects are dropped. Without a
// gameTime there is nothing to measure against, so the whole list is dropped.
function rebaseEffects(effects, gameTime) {
	if (!Array.isArray(effects) || typeof gameTime !== 'number') return undefined;
	const out = [];
	for (const effect of effects) {
		if (!effect || typeof effect !== 'object') continue;
		const copy = Object.assign({}, effect);
		if (typeof copy.endTime === 'number') {
			const remaining = copy.endTime - gameTime;
			if (remaining <= 0) continue;
			copy.ticksRemaining = remaining;
		}
		delete copy.endTime;
		out.push(copy);
	}
	return out.length ? out : undefined;
}

// Engine object fields we never copy onto a structure entry (positional/identity
// or engine-internal); everything else passes through (hits, store, level, etc.).
//
// `launchTime` is a Season 5 reactor's absolute start tick on the LIVE server —
// millions of ticks ahead of a fresh sim, where `gameTime - launchTime` goes
// negative and the mod's score formula (log10 of it) turns into NaN. A reactor
// starts its clock again on its first tick here, which is what a scenario wants.
const STRUCTURE_OMIT = new Set(['_id', '$loki', 'meta', 'type', 'x', 'y', 'room', 'user', 'spawning', 'launchTime']);

// Engine creep fields worth keeping beyond the ones written by hand below.
// `strongholdId` is what tells the processor a creep belongs to a stronghold
// garrison instead of to the roaming invader AI — without it an imported
// stronghold's defenders leave their ramparts and charge (src/import/
// strongholdRepair.js has the full mechanism).
const CREEP_KEEP = ['strongholdId'];

// A live body is [{type, hits, boost?}, ...]. Emit the same three shapes the
// map editor writes and the loader accepts (ui bodyModel.segmentsToBody,
// dojoWorld.buildCreepBody):
//
//   nothing boosted         -> ["attack","move"]
//   one boost per part type -> ["attack","move"] + boosts: { attack: "XUH2O" }
//   same type, two boosts   -> [{type:"attack",boost:"XUH2O"},{type:"attack"}]
//
// Dropping the boosts (which is what a plain `.map(part => part.type)` does)
// silently unboosts an imported T4/T5 stronghold garrison, whose whole threat
// is its boosts.
function exportBody(parts) {
	const types = [];
	const perType = {};
	let anyBoost = false;
	let consistent = true;
	for (const part of parts || []) {
		const type = typeof part === 'string' ? part : part && part.type;
		if (!type) continue;
		const boost = (part && typeof part === 'object') ? part.boost : undefined;
		if (boost) anyBoost = true;
		if (Object.prototype.hasOwnProperty.call(perType, type)) {
			if (perType[type] !== boost) consistent = false;
		} else {
			perType[type] = boost;
		}
		types.push({ type: type, boost: boost });
	}
	if (!anyBoost) return { body: types.map(function (part) { return part.type; }) };
	if (consistent) {
		const boosts = {};
		for (const type of Object.keys(perType)) if (perType[type]) boosts[type] = perType[type];
		return { body: types.map(function (part) { return part.type; }), boosts: boosts };
	}
	return {
		body: types.map(function (part) {
			return part.boost ? { type: part.type, boost: part.boost } : { type: part.type };
		})
	};
}

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
	// The source server's tick when the snapshot was taken; absent for callers
	// that cannot supply one (see ABSOLUTE_DECAY_FIELDS).
	const gameTime = input.gameTime;
	const includeMyCreeps = input.includeMyCreeps !== false;
	const includeMyStructures = input.includeMyStructures !== false;
	// label -> { id, username } for every player seen across the import; only
	// the labels this room actually uses are written into its map.
	const knownUsers = input.users || {};
	const usedLabels = new Set();
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
			if (object.user && tag !== null) {
				controller.owner = tag;
				if (!OWNER_TAGS[tag]) usedLabels.add(tag);
			}
			map.controller = controller;
			continue;
		}
		if (object.type === 'source') {
			// preserve the live id: the bot encodes source ids in creep names, so the
			// loader must recreate sources with their original ids or mining breaks
			const source = { x: object.x, y: object.y };
			if (object._id) source.id = object._id;
			// Live fill and capacity (1500 neutral / 3000 owned / 4000 keeper or
			// centre room). The engine re-derives the capacity from the room's
			// controller on its first tick anyway; the fill is what would
			// otherwise reset to the dojo's 1000 default.
			if (typeof object.energy === 'number') source.energy = object.energy;
			if (typeof object.energyCapacity === 'number') source.energyCapacity = object.energyCapacity;
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
			if (object.spawning || tag === null) continue;
			if (tag === 'me' && !includeMyCreeps) continue;
			if (!OWNER_TAGS[tag]) usedLabels.add(tag);
			const { body, boosts } = exportBody(object.body);
			const creep = {
				name: object.name, x: object.x, y: object.y, owner: tag,
				body: body,
				hits: object.hits, hitsMax: object.hitsMax
			};
			if (boosts) creep.boosts = boosts;
			for (const key of CREEP_KEEP) {
				if (object[key] !== undefined && object[key] !== null) creep[key] = object[key];
			}
			if (object._id) creep.id = object._id;
			// Raw room API/engine docs carry an absolute death tick. Export a
			// remaining lifetime so the loader can rebase it onto its own clock.
			if (Number.isFinite(object.ageTime) && Number.isFinite(gameTime)) {
				creep.ticksToLive = Math.max(0, object.ageTime - gameTime);
			} else if (Number.isFinite(object.ticksToLive)) {
				creep.ticksToLive = Math.max(0, object.ticksToLive);
			}
			const store = cleanStore(object.store);
			if (store) creep.store = store;
			map.creeps.push(creep);
			continue;
		}
		if (known.has(object.type)) {
			// Keep mine / npc / neutral / another player's; drop only an owner we
			// could not resolve to anything.
			if (object.user && tag === null) continue;
			if (tag === 'me' && !includeMyStructures) continue;
			const entry = { type: object.type, x: object.x, y: object.y };
			// Keep the live id on EVERY object: the engine ties objects together by
			// id (a keeper is named after its lair's id, so a lair loaded under a
			// fresh id spawns a second keeper beside the imported one), and a
			// local copy is easiest to check against the live server by id.
			if (object._id) entry.id = object._id;
			if (object.user && tag !== null) {
				entry.owner = tag;
				if (!OWNER_TAGS[tag]) usedLabels.add(tag);
			}
			const decayField = ABSOLUTE_DECAY_FIELDS[object.type];
			for (const key of Object.keys(object)) {
				if (STRUCTURE_OMIT.has(key) || key === 'store') continue;
				if (key === decayField) continue;   // rebased below, never copied raw
				if (key === 'effects') continue;    // rebased below
				if (ABSOLUTE_TICK_FIELDS.indexOf(key) !== -1) continue;
				entry[key] = object[key];
			}
			const effects = rebaseEffects(object.effects, gameTime);
			if (effects) entry.effects = effects;
			if (typeof gameTime === 'number') {
				for (const field of ABSOLUTE_TICK_FIELDS) {
					if (typeof object[field] !== 'number') continue;
					const remaining = object[field] - gameTime;
					if (remaining <= 0) continue;
					entry.ticks = entry.ticks || {};
					entry.ticks[field] = remaining;
				}
			}
			if (decayField && typeof object[decayField] === 'number') {
				// Only rebasable against the source server's own clock. Without it
				// (an older map, a server that would not answer) the deadline means
				// nothing here, so drop it and let the loader seed a full lifetime.
				if (typeof gameTime === 'number') {
					// Floor at 1: the engine deletes these on `gameTime >= deadline-1`,
					// so a bank already past its deadline upstream would otherwise
					// import as an object the sim removes before the bot ever sees it.
					entry.ticksToDecay = Math.max(1, object[decayField] - gameTime);
				}
			}
			const store = cleanStore(object.store);
			if (store) entry.store = store;
			map.structures.push(entry);
			continue;
		}
		// Unknown custom type (e.g. Season 'score'): drop + count.
		skipped[object.type] = (skipped[object.type] || 0) + 1;
	}

	// The label -> { id, username } table for this room's players. Labels are
	// derived from usernames, which can change on the live server; the id is
	// what a re-import can still match on.
	const users = {};
	for (const label of usedLabels) {
		if (knownUsers[label]) users[label] = knownUsers[label];
	}
	if (Object.keys(users).length > 0) map.users = users;

	return { map: map, skipped: skipped };
}

module.exports = { roomToMap: roomToMap, KNOWN_STRUCTURES: KNOWN_STRUCTURES };

'use strict';

// Pure transform: what an imported stronghold room is MISSING before the
// engine will drive it as a stronghold rather than as a pack of loose
// invaders. No db, no network — takes the room's core + NPC creep docs and
// returns the patches to apply.
//
// Two engine gates decide this, and an import can miss either:
//
//  1. processor.js -- `(object.user == INVADER_ID) && !object.strongholdId`
//     puts the creep on the ordinary invader list, which runs
//     intents/creeps/invaders/findAttack.js: path to the nearest hostile and
//     hit it. That is the "they charge me like normal invaders" symptom.
//
//  2. invader-core/pretick.js -- the CORE picks its behavior as
//     `strongholdBehavior || 'default'`, and only the bunkerN behaviors call
//     maintainPopulation(). That binds creeps BY NAME: `defender{i}` against
//     `core.population[i]`, whose `behavior` field ('simple-melee',
//     'coordinated', 'fortifier') is what actually drives the creep. Without
//     `population` the loop returns early and no creep is ever driven.
//
// So a garrison needs: a strongholdId shared by core and creeps, a
// strongholdBehavior on the core, and a population entry per defender.

// The engine's own garrison bodies (stronghold/creeps.js `bodies`), reduced to
// the part counts we can recognise an imported creep by. `population[i].body`
// only matters when the creep is ABSENT — it is the respawn recipe — so an
// imprecise match costs nothing while the imported creep is alive, and gives
// the engine a sane creep to rebuild when it dies.
const GARRISON_BODIES = [
	{ name: 'fortifier', parts: { work: 15, carry: 15, move: 15 } },
	{ name: 'weakDefender', parts: { attack: 15, move: 15 } },
	{ name: 'fullDefender', parts: { attack: 25, move: 25 } },
	{ name: 'boostedDefender', parts: { attack: 25, move: 25 } },
	{ name: 'boostedRanger', parts: { ranged_attack: 25, move: 25 } },
	{ name: 'fullBoostedMelee', parts: { attack: 44, move: 6 } },
	{ name: 'fullBoostedRanger', parts: { ranged_attack: 44, move: 6 } }
];

// Which body name to prefer when two entries share a composition: the boosted
// variants are identical in part counts to their unboosted twins, so the
// imported creep's own boosts break the tie.
const BOOSTED_TWIN = { fullDefender: 'boostedDefender' };

const DEFENDER_NAME = /^defender(\d+)$/;

function partCounts(body) {
	const counts = {};
	for (const part of body || []) {
		const type = typeof part === 'string' ? part : part && part.type;
		if (!type) continue;
		counts[type] = (counts[type] || 0) + 1;
	}
	return counts;
}

function hasBoost(body) {
	return (body || []).some(function (part) { return part && typeof part === 'object' && part.boost; });
}

// Closest garrison body by part composition: the one with the smallest total
// difference across every part type either side mentions.
function matchBody(body, level) {
	const counts = partCounts(body);
	let best = null;
	let bestDistance = Infinity;
	for (const candidate of GARRISON_BODIES) {
		const types = new Set(Object.keys(counts).concat(Object.keys(candidate.parts)));
		let distance = 0;
		for (const type of types) distance += Math.abs((counts[type] || 0) - (candidate.parts[type] || 0));
		if (distance < bestDistance) { bestDistance = distance; best = candidate.name; }
	}
	if (best === null) return level >= 4 ? 'boostedDefender' : 'fullDefender';
	// An unboosted match on a body that IS boosted means the boosted twin.
	if (hasBoost(body) && BOOSTED_TWIN[best]) return BOOSTED_TWIN[best];
	return best;
}

// The behavior a garrison creep of this body runs at this stronghold level,
// following the engine's own population decks (stronghold/stronghold.js):
// bunker2/3 field melee defenders that hold their rampart; bunker4/5 field a
// coordinated line plus one fortifier, the only garrison creep with WORK.
function matchBehavior(body, level) {
	if (level >= 4 && partCounts(body).work > 0) return 'fortifier';
	return level >= 4 ? 'coordinated' : 'simple-melee';
}

function templateLevel(behavior, core) {
	const fromBehavior = /^bunker([1-5])$/.exec(behavior || '');
	if (fromBehavior) return Number(fromBehavior[1]);
	return Number(core.level) || 0;
}

// `core` is the room's invaderCore doc (or null), `creeps` the Invader-owned
// creep docs in the same room. Returns:
//   { core: {patch} | null, creeps: [{ doc, patch }], warnings: [string] }
// An empty patch object is never returned — a field already correct is left
// alone, so re-running this is a no-op and an explicit map value always wins.
function planStrongholdRepair(room, core, creeps) {
	const plan = { core: null, creeps: [], warnings: [] };
	if (!core || core.type !== 'invaderCore') return plan;
	// A core still counting down to deploy runs the 'deploy' behavior and has
	// no garrison yet; nothing to bind.
	if (core.deployTime) return plan;
	if (!core.level) return plan;

	const corePatch = {};
	const strongholdId = core.strongholdId || (room + '_imported');
	if (!core.strongholdId) corePatch.strongholdId = strongholdId;

	// The template name and the behavior name are the same string ('bunker3')
	// — the core carries both because the template sets them together. Falling
	// back to the level is the same mapping the templates themselves use.
	let behavior = core.strongholdBehavior;
	if (!behavior) {
		behavior = /^bunker[1-5]$/.test(core.templateName || '') ? core.templateName
			: (core.level >= 1 && core.level <= 5 ? 'bunker' + core.level : null);
		if (behavior) corePatch.strongholdBehavior = behavior;
	}
	if (!behavior) {
		plan.warnings.push('stronghold in ' + room + ': invader core has no strongholdBehavior and '
			+ 'none could be derived from templateName/level — its garrison will act as loose invaders');
		return plan;
	}

	const level = templateLevel(behavior, core);
	const garrison = [];
	for (const creep of creeps) {
		const match = DEFENDER_NAME.exec(creep.name || '');
		if (!match) {
			plan.warnings.push('stronghold in ' + room + ': NPC creep "' + creep.name + '" is not named '
				+ 'defender<n>, so the core cannot bind it (engine matches population entries by name) — '
				+ 'it will act as a loose invader');
			continue;
		}
		garrison.push({ index: Number(match[1]), creep: creep });
	}
	garrison.sort(function (a, b) { return a.index - b.index; });

	// population is indexed by the number in the creep name, so a garrison that
	// lost defender1 on the live server keeps its gap here: the engine will
	// respawn exactly that slot, which is what the live stronghold was doing.
	if (!core.population && garrison.length) {
		const population = [];
		for (const entry of garrison) {
			while (population.length < entry.index) {
				population.push({ body: level >= 4 ? 'boostedDefender' : 'fullDefender',
					behavior: level >= 4 ? 'coordinated' : 'simple-melee' });
			}
			population.push({
				body: matchBody(entry.creep.body, level),
				behavior: matchBehavior(entry.creep.body, level)
			});
		}
		corePatch.population = population;
	}

	if (Object.keys(corePatch).length) plan.core = corePatch;
	for (const creep of creeps) {
		if (creep.strongholdId === strongholdId) continue;
		plan.creeps.push({ doc: creep, patch: { strongholdId: strongholdId } });
	}
	return plan;
}

module.exports = { planStrongholdRepair, matchBody, matchBehavior };

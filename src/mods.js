'use strict';

// The curated game-mod catalog: the ONLY authority for which mods a scenario
// may select, and the only place a module path is ever produced.
//
// A Screeps mod is arbitrary code that the engine loads into its own process
// and that mutates singletons (constants, the engine event emitter, custom
// prototype registrations). It can never be unloaded, so mods are:
//
//   - curated, not arbitrary: scenarios name a catalog ID, never a path or a
//     git URL. resolveModules() is the only thing that turns an ID into a
//     module path, and it does so with require.resolve against a name that
//     came out of THIS file — never out of scenario input.
//   - atomic: selecting a mod enables everything that mod implements. There are
//     no per-mechanic toggles, because the upstream mod has no such seams.
//   - loaded once per process: see scripts/runScenarioChild.js. A run that has
//     loaded a mod can never go back to vanilla.
//
// The scenario's settings.json says which:  { "mods": ["season5"] }
const fs = require('fs');
const os = require('os');
const path = require('path');

// Official Season 5 rules, pinned by commit in package.json. Everything the
// mod hangs off `config.common` and `config.engine` works here; everything it
// hangs off `config.backend` and `config.cronjobs` does not, because the dojo
// runs the engine without a backend service or a cron scheduler. That is a
// deliberate product decision, not a gap: scenarios place their own reactors,
// Thorium and strongholds, which is what makes a scenario reproducible.
const SEASON5 = {
	id: 'season5',
	name: 'Season 5',
	description: 'Thorium, reactors, scoring, terminal restrictions and Season 5 stronghold rules. '
		+ 'World generation and the official scoreboard are not included.',
	module: '@screeps/mod-season5',
	version: '1.0.3',
	// Pinned in package.json; repeated here so a probe failure can name the
	// exact upstream revision the dojo was written against.
	source: 'github:screeps/mod-season5#da5911877f9d06cc86d8d7db6c44576c3ffc757b',
	// Deterministic load order, independent of checkbox order. Ties break on id.
	order: 100,
	requires: [],
	conflicts: [],
	supported: [
		'RESOURCE_THORIUM ("T"), included in RESOURCES_ALL',
		'FIND_REACTORS / LOOK_REACTORS and the Reactor object',
		'Creep.claimReactor() and reactor ownership',
		'Thorium consumption, continuous work and owner score',
		'Thorium accelerating decay and creep ageing in its tile',
		'Depleted Thorium minerals are removed',
		'Terminal transfers restricted to the same player',
		'Season 5 stronghold reward tables',
		'A nuke landing in a stronghold room marks the core depositType "nuked"'
	],
	unavailable: [
		'Automatic Thorium and reactor world generation (place them in the scenario)',
		'Scoreboard ranking cronjobs and the backend scoreboard route',
		'Room decoration endpoints and official renderer metadata',
		'Backend respawn hooks'
	],

	// Object types this mod adds that the room importer should keep. Without
	// this a live Season 5 room imports with its reactor silently dropped as an
	// "unknown custom type".
	importTypes: ['reactor'],

	// Thorium does NOT come back. Vanilla minerals regenerate once empty, and
	// the dojo seeds that clock for a depleted one — but Season 5 deletes a
	// depleted Thorium mineral instead, so a regeneration deadline on one is
	// both wrong and visibly confusing in the inspector.
	suppressesRegen: function (type, attributes) {
		return type === 'mineral' && Boolean(attributes) && attributes.mineralType === 'T';
	},

	// Deterministic stand-ins for the world generation the cronjobs would have
	// done. Applied UNDER the scenario's own attributes (see objectDefaults),
	// so an explicit value always wins.
	objectDefaults: function (type, attributes) {
		if (type === 'reactor') {
			// The mod's own sidepanel reads `store`, and its postProcessObject
			// reads store.T every tick; a reactor without a store would crash
			// the processor before it ever scored.
			return { store: {}, storeCapacityResource: { T: 1000 } };
		}
		if (type === 'mineral' && attributes && attributes.mineralType === 'T') {
			// Season 5 REMOVES a Thorium mineral whose mineralAmount is falsy
			// (mineral.roomObject.js), so a T mineral placed without an amount
			// would vanish on the first processed tick. Amounts follow the mod's
			// own density table.
			const density = attributes.density === undefined ? 3 : attributes.density;
			return { density: density, mineralAmount: THORIUM_DENSITY_AMOUNT[density] || 0 };
		}
		if (type === 'invaderCore') {
			// Season 5 reward tables are keyed by depositType, and the cronjob
			// that backfills the missing key (stronghold-rewards.js) does not run
			// here. Without it a stronghold would roll rewards from `undefined`.
			return { depositType: 'normal' };
		}
		return null;
	},

	// Checked after the driver has connected — @screeps/common's config manager
	// CATCHES and logs mod-load errors, so a half-loaded mod otherwise looks
	// exactly like a healthy one until a scenario mysteriously misbehaves.
	probes: [
		{
			label: 'RESOURCE_THORIUM === "T"',
			check: function (ctx) { return ctx.constants.RESOURCE_THORIUM === 'T'; }
		},
		{
			label: 'RESOURCES_ALL includes "T"',
			check: function (ctx) { return Array.isArray(ctx.constants.RESOURCES_ALL) && ctx.constants.RESOURCES_ALL.indexOf('T') !== -1; }
		},
		{
			label: 'FIND_REACTORS and LOOK_REACTORS are defined',
			check: function (ctx) { return ctx.constants.FIND_REACTORS === 10051 && ctx.constants.LOOK_REACTORS === 'reactor'; }
		},
		{
			label: 'the driver registered a "reactor" custom prototype',
			check: function (ctx) {
				return ctx.customObjectPrototypes.some(function (p) { return p.objectType === 'reactor'; });
			}
		},
		{
			label: 'the "claimReactor" custom intent type exists',
			check: function (ctx) { return !!ctx.customIntentTypes.claimReactor; }
		},
		{
			label: 'Season 5 stronghold reward tables are installed',
			check: function (ctx) { return !!(ctx.strongholds.coreRewards && ctx.strongholds.coreRewards.nuked); }
		}
	]
};

// mod-season5/src/mineral.roomObject.js
const THORIUM_DENSITY_AMOUNT = { 1: 10000, 2: 22000, 3: 45000, 4: 67000 };

const CATALOG = [SEASON5];

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

// A registry is built from a catalog rather than reading a module-level one, so
// the tests can exercise ordering, dependencies and conflicts against a
// synthetic catalog without mutating the real one.
function createRegistry(entries) {
	const BY_ID = {};
	for (const entry of entries) BY_ID[entry.id] = entry;

	function knownIds() { return entries.map(function (e) { return e.id; }).sort(); }

	// What the UI renders. Deliberately a plain data copy: the UI must never own a
	// second copy of the catalog, and must never see the probe/defaults functions.
	function catalog() {
		return sortIds(knownIds()).map(function (id) {
			const entry = BY_ID[id];
			return {
				id: entry.id,
				name: entry.name,
				description: entry.description,
				version: entry.version,
				supported: entry.supported.slice(),
				unavailable: entry.unavailable.slice(),
				requires: entry.requires.slice(),
				conflicts: entry.conflicts.slice()
			};
		});
	}

	function has(id) { return Object.prototype.hasOwnProperty.call(BY_ID, id); }

	// Catalog order, never checkbox order: two scenarios that select the same mods
	// must load them in the same sequence.
	function sortIds(ids) {
		return ids.slice().sort(function (a, b) {
			const oa = BY_ID[a] ? BY_ID[a].order : 0;
			const ob = BY_ID[b] ? BY_ID[b].order : 0;
			return oa === ob ? a.localeCompare(b) : oa - ob;
		});
	}

	// Normalizes and validates a scenario's raw `mods` value. Throws — an
	// unavailable mod must stop the run before the engine boots, not silently
	// produce a vanilla world that looks like it worked.
	function validate(raw, label) {
		const where = label ? label + ': ' : '';
		if (raw === undefined || raw === null) return [];
		if (!Array.isArray(raw)) throw new Error(where + '"mods" must be an array of mod IDs');
		const ids = [];
		for (const value of raw) {
			if (typeof value !== 'string' || !value.trim()) {
				throw new Error(where + '"mods" entries must be non-empty mod IDs');
			}
			const id = value.trim().toLowerCase();
			if (!ID_RE.test(id)) throw new Error(where + 'invalid mod ID "' + value + '"');
			if (!has(id)) {
				throw new Error(where + 'unknown mod "' + id + '" (available: ' + knownIds().join(', ') + ')');
			}
			if (ids.indexOf(id) === -1) ids.push(id);   // duplicates normalize away
		}
		for (const id of ids) {
			for (const required of BY_ID[id].requires) {
				if (ids.indexOf(required) === -1) {
					throw new Error(where + 'mod "' + id + '" requires "' + required + '"');
				}
			}
			for (const conflict of BY_ID[id].conflicts) {
				if (ids.indexOf(conflict) !== -1) {
					throw new Error(where + 'mods "' + id + '" and "' + conflict + '" cannot be used together');
				}
			}
		}
		return sortIds(ids);
	}

	// IDs -> absolute module paths. The name handed to require.resolve comes from
	// the catalog, never from the caller, so scenario input can never name a
	// module. A missing package is a broken installation, so say so precisely.
	function resolveModules(ids) {
		return ids.map(function (id) {
			const entry = BY_ID[id];
			try {
				return require.resolve(entry.module);
			} catch (e) {
				throw new Error('mod "' + id + '" is not installed: cannot resolve ' + entry.module
					+ ' (' + entry.source + ') — rebuild the container image after a dependency change');
			}
		});
	}

	// The mods.json the engine reads (MODFILE). Written per run, outside the repo,
	// with absolute module paths so the file's own location is irrelevant.
	// Returns null for a vanilla run: with no file the mockup keeps using its own
	// empty default, which is exactly vanilla behaviour.
	function createModFile(ids, options) {
		if (!ids || !ids.length) return null;
		options = options || {};
		const dir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-mods-'));
		const file = path.join(dir, 'mods.json');
		const content = { mods: resolveModules(ids), bots: {} };
		fs.writeFileSync(file, JSON.stringify(content, null, '\t') + '\n');
		let removed = false;
		return {
			path: file,
			mods: content.mods,
			ids: ids.slice(),
			cleanup: function () {
				if (removed) return;
				removed = true;
				try { fs.unlinkSync(file); } catch (e) { /* already gone */ }
				if (!options.dir) { try { fs.rmdirSync(dir); } catch (e) { /* not empty / already gone */ } }
			}
		};
	}

	// Object types the selected mods add on top of the importer's built-in list
	// (src/import/roomToMap.js), so a live season room imports whole.
	function importTypes(ids) {
		const types = [];
		for (const id of ids || []) {
			const entry = BY_ID[id];
			for (const type of (entry && entry.importTypes) || []) {
				if (types.indexOf(type) === -1) types.push(type);
			}
		}
		return types;
	}

	// True when a selected mod says this object never regenerates, so DojoWorld
	// must not seed the engine's regeneration clock for it.
	function suppressesRegen(ids, type, attributes) {
		for (const id of ids || []) {
			const entry = BY_ID[id];
			if (entry && typeof entry.suppressesRegen === 'function'
				&& entry.suppressesRegen(type, attributes)) return true;
		}
		return false;
	}

	// Mod-supplied defaults for a world object, merged in catalog order and applied
	// UNDER the scenario's own attributes by DojoWorld.addObject.
	function objectDefaults(ids, type, attributes) {
		const defaults = {};
		for (const id of ids || []) {
			const entry = BY_ID[id];
			if (!entry || typeof entry.objectDefaults !== 'function') continue;
			Object.assign(defaults, entry.objectDefaults(type, attributes) || {});
		}
		return defaults;
	}

	// Post-connect verification. `deps` is injectable so this is testable without
	// booting an engine; by default it reads the live driver and config manager.
	function probeContext(deps) {
		if (deps) return deps;
		const driver = require('@screeps/driver');
		const config = require('@screeps/common').configManager.config;
		return {
			constants: config.common.constants,
			strongholds: config.common.strongholds,
			customObjectPrototypes: driver.customObjectPrototypes || [],
			customIntentTypes: (config.engine && config.engine.customIntentTypes) || {}
		};
	}

	// Throws with everything needed to diagnose a partial load. Returns the list of
	// probe labels that passed, so a caller can log what it verified.
	function probe(ids, deps, details) {
		if (!ids || !ids.length) return [];
		const ctx = probeContext(deps);
		const passed = [];
		for (const id of ids) {
			const entry = BY_ID[id];
			for (const check of entry.probes) {
				let ok = false;
				let failure = null;
				try { ok = check.check(ctx) === true; } catch (e) { failure = e; }
				if (!ok) {
					throw new Error(describeProbeFailure(id, entry, check, ids, failure, details));
				}
				passed.push(id + ': ' + check.label);
			}
		}
		return passed;
	}

	function describeProbeFailure(id, entry, check, ids, failure, details) {
		details = details || {};
		const lines = [
			'mod "' + id + '" did not load correctly — the engine would run without it.',
			'  failed check: ' + check.label,
			'  expected package: ' + entry.module + '@' + entry.version + ' (' + entry.source + ')',
			'  selected mods: ' + ids.join(', ')
		];
		if (details.scenario) lines.splice(1, 0, '  scenario: ' + details.scenario);
		if (details.modFile) lines.push('  mod file: ' + details.modFile);
		if (details.engineMode) lines.push('  engine mode: ' + details.engineMode);
		if (failure) lines.push('  probe threw: ' + String((failure && failure.message) || failure));
		lines.push('  (@screeps/common logs and swallows mod load errors — check the run output for "Error loading")');
		return lines.join('\n');
	}

	return {
		catalog: catalog,
		has: has,
		knownIds: knownIds,
		validate: validate,
		sortIds: sortIds,
		resolveModules: resolveModules,
		createModFile: createModFile,
		importTypes: importTypes,
		suppressesRegen: suppressesRegen,
		objectDefaults: objectDefaults,
		probe: probe
	};
}

module.exports = createRegistry(CATALOG);
module.exports.createRegistry = createRegistry;

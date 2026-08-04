'use strict';

// Creates a ScreepsServer with the container-environment fix applied (see
// scripts/smoke.js history): inside Docker, 'localhost' resolves to ::1 (IPv6)
// while the driver dials 127.0.0.1 (IPv4), so storage must bind 127.0.0.1 in
// BOTH the parent process and the storage child (which is forked with an
// explicit, non-inherited env).
process.env.STORAGE_HOST = '127.0.0.1';

const mockEngineFeatures = require('./mockEngineFeatures');
const warnings = require('./harnessWarnings');
const { ScreepsServer, TerrainMatrix } = require('screeps-server-mockup');

function configureChildEnv(name, childEnv) {
	mockEngineFeatures.copyPublicEnv(process.env, childEnv);
	if (name === 'storage') childEnv.STORAGE_HOST = '127.0.0.1';
	// @screeps/driver's accessibleRooms cache is not safe during its first
	// concurrent read: one runner worker advances the cache timestamp before the
	// value arrives, allowing another worker to receive undefined. Dojo values
	// deterministic scenario execution over parallel bot VM startup, so process
	// users sequentially within each tick.
	if (name === 'engine_runner') childEnv.RUNNER_THREADS = '1';
	return childEnv;
}

function getMockEngineFeatures(env) {
	return mockEngineFeatures.resolveAll(env || process.env);
}

function assertInProcessIsolation(env) {
	env = env || process.env;
	if (mockEngineFeatures.isEnabled('inProcess', env)
		&& env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED !== '1') {
		throw new Error('Fast mock-engine in-process mode requires a dedicated scenario or smoke process');
	}
}

// The scenario line that made the call, as 'file.js:line'. Returns null when
// the caller is the harness itself or anything inside node_modules — the engine
// and driver write to these same collections (in the fast in-process mode, in
// this very process), and warning about the engine's own bookkeeping would be
// both wrong and deafening.
function callerFrame() {
	const limit = Error.stackTraceLimit;
	Error.stackTraceLimit = 8;
	const stack = (new Error().stack || '').split('\n').slice(2);
	Error.stackTraceLimit = limit;
	for (const line of stack) {
		if (line.includes('serverBoot.js') || line.includes('dojoWorld.js')
			|| line.includes('harnessWarnings.js')) continue;
		if (line.includes('node_modules')) return null;
		const m = /([^\\/(]+\.(?:js|ts):\d+):\d+/.exec(line);
		if (m) return m[1];
	}
	return null;
}

function nudge(call, replacement, why, site) {
	warnings.warnOnce(call + '@' + site, call + ' bypasses ' + replacement + ': ' + why
		+ '.  Use ' + replacement + (site ? '  — at ' + site : ''));
}

// The mockup's world.addRoomObject is a bare db insert: no per-type engine
// defaults, no owner resolution, no decay/regeneration clocks, and no room
// activation — an object added through it can sit inert in a dormant room
// forever. DojoWorld.addObject does all of that, so nudge anyone who reaches
// past it. DojoWorld itself calls addRoomObjectUnchecked (it IS the facade);
// warnings are deduped per call site so a loop cannot spam a scenario's log.
function warnOnDirectRoomObject(world) {
	const original = world.addRoomObject.bind(world);
	world.addRoomObjectUnchecked = original;
	world.addRoomObject = function addRoomObject(room, type, x, y, attributes) {
		const site = callerFrame();
		if (site) {
			nudge("world.addRoomObject('" + type + "')", 'world.addObject(room, type, x, y, attrs)',
				'no type defaults, no owner resolution, no decay/regen clocks, no room activation', site);
		}
		return original(room, type, x, y, attributes);
	};
	return world;
}

// Writing to rooms.objects by hand skips the same things AND leaves the room
// dormant, so the engine may never process the change at all. The collection
// only exists once storage is connected, so patch it on the first load() — and
// keep the raw methods reachable under an *Unchecked name for the rare case
// that genuinely wants them.
const GUARDED_WRITES = {
	insert: { replacement: 'world.addObject(room, type, x, y, attrs)', why: 'no type defaults, no clocks, no room activation' },
	update: { replacement: 'world.updateObject(query, changes)', why: 'the room stays dormant, so the engine never processes the change' },
	remove: { replacement: 'world.removeObject(query)', why: 'the room stays dormant, so the engine never notices the object is gone' },
	removeWhere: { replacement: 'world.removeObject(query)', why: 'the room stays dormant, so the engine never notices the object is gone' }
};

function guardRoomObjectWrites(collection) {
	// Storage is a module singleton, so every server in a process shares these
	// collection objects. Wrapping twice would leave the *Unchecked alias
	// pointing at the FIRST wrapper — and the facade, which calls it, would then
	// warn about itself.
	if (collection.__dojoWriteGuard) return;
	collection.__dojoWriteGuard = true;
	for (const method of Object.keys(GUARDED_WRITES)) {
		if (typeof collection[method] !== 'function') continue;
		const original = collection[method].bind(collection);
		const guidance = GUARDED_WRITES[method];
		collection[method + 'Unchecked'] = original;
		collection[method] = function guarded() {
			if (!warnings.isSuspended()) {
				const site = callerFrame();
				if (site) {
					nudge("db['rooms.objects']." + method + '()', guidance.replacement, guidance.why, site);
				}
			}
			return original.apply(null, arguments);
		};
	}
}

function warnOnDirectDbWrites(world) {
	const originalLoad = world.load.bind(world);
	let guarded = false;
	world.load = async function load() {
		const loaded = await originalLoad();
		if (!guarded && loaded && loaded.db && loaded.db['rooms.objects']) {
			guarded = true;
			guardRoomObjectWrites(loaded.db['rooms.objects']);
		}
		return loaded;
	};
	return world;
}

function createServer() {
	assertInProcessIsolation(process.env);
	const server = new ScreepsServer();
	const origStartProcess = server.startProcess.bind(server);
	server.startProcess = function patchedStartProcess(name, execPath, childEnv) {
		return origStartProcess(name, execPath, configureChildEnv(name, childEnv));
	};
	warnOnDirectRoomObject(server.world);
	warnOnDirectDbWrites(server.world);
	return server;
}

module.exports = {
	createServer: createServer,
	configureChildEnv: configureChildEnv,
	getMockEngineFeatures: getMockEngineFeatures,
	assertInProcessIsolation: assertInProcessIsolation,
	TerrainMatrix: TerrainMatrix
};

'use strict';

// Creates a ScreepsServer with the container-environment fix applied (see
// scripts/smoke.js history): inside Docker, 'localhost' resolves to ::1 (IPv6)
// while the driver dials 127.0.0.1 (IPv4), so storage must bind 127.0.0.1 in
// BOTH the parent process and the storage child (which is forked with an
// explicit, non-inherited env).
process.env.STORAGE_HOST = '127.0.0.1';

const mockEngineFeatures = require('./mockEngineFeatures');
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

// First stack frame outside dojo's own plumbing, as 'file.js:line' — the
// scenario line that made the call, not the facade it went through.
function callerFrame() {
	const stack = (new Error().stack || '').split('\n').slice(2);
	for (const line of stack) {
		if (line.includes('serverBoot.js') || line.includes('dojoWorld.js')) continue;
		const m = /([^\\/(]+\.js:\d+):\d+/.exec(line);
		if (m) return m[1];
	}
	return '';
}

// The mockup's world.addRoomObject is a bare db insert: no per-type engine
// defaults, no owner resolution, no decay/regeneration clocks, and no room
// activation — an object added through it can sit inert in a dormant room
// forever. DojoWorld.addObject does all of that, so nudge anyone who reaches
// past it. DojoWorld itself calls addRoomObjectUnchecked (it IS the facade);
// warnings are deduped per call site so a loop cannot spam a scenario's log.
function warnOnDirectRoomObject(world) {
	const original = world.addRoomObject.bind(world);
	const warned = new Set();
	world.addRoomObjectUnchecked = original;
	world.addRoomObject = function addRoomObject(room, type, x, y, attributes) {
		const site = callerFrame();
		if (!warned.has(site)) {
			warned.add(site);
			console.warn('[dojo] world.addRoomObject(\'' + type + '\') bypasses DojoWorld.addObject: '
				+ 'no type defaults, no owner resolution, no decay/regen clocks, no room activation. '
				+ 'Use world.addObject(room, type, x, y, attrs)' + (site ? '  — at ' + site : ''));
		}
		return original(room, type, x, y, attributes);
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
	return server;
}

module.exports = {
	createServer: createServer,
	configureChildEnv: configureChildEnv,
	getMockEngineFeatures: getMockEngineFeatures,
	assertInProcessIsolation: assertInProcessIsolation,
	TerrainMatrix: TerrainMatrix
};

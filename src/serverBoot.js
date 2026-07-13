'use strict';

// Creates a ScreepsServer with the container-environment fix applied (see
// scripts/smoke.js history): inside Docker, 'localhost' resolves to ::1 (IPv6)
// while the driver dials 127.0.0.1 (IPv4), so storage must bind 127.0.0.1 in
// BOTH the parent process and the storage child (which is forked with an
// explicit, non-inherited env).
process.env.STORAGE_HOST = '127.0.0.1';

const { ScreepsServer, TerrainMatrix } = require('screeps-server-mockup');

function configureChildEnv(name, childEnv) {
	if (name === 'storage') childEnv.STORAGE_HOST = '127.0.0.1';
	// @screeps/driver's accessibleRooms cache is not safe during its first
	// concurrent read: one runner worker advances the cache timestamp before the
	// value arrives, allowing another worker to receive undefined. Dojo values
	// deterministic scenario execution over parallel bot VM startup, so process
	// users sequentially within each tick.
	if (name === 'engine_runner') childEnv.RUNNER_THREADS = '1';
	return childEnv;
}

function createServer() {
	const server = new ScreepsServer();
	const origStartProcess = server.startProcess.bind(server);
	server.startProcess = function patchedStartProcess(name, execPath, childEnv) {
		return origStartProcess(name, execPath, configureChildEnv(name, childEnv));
	};
	return server;
}

module.exports = {
	createServer: createServer,
	configureChildEnv: configureChildEnv,
	TerrainMatrix: TerrainMatrix
};

'use strict';

// Creates a ScreepsServer with the container-environment fix applied (see
// scripts/smoke.js history): inside Docker, 'localhost' resolves to ::1 (IPv6)
// while the driver dials 127.0.0.1 (IPv4), so storage must bind 127.0.0.1 in
// BOTH the parent process and the storage child (which is forked with an
// explicit, non-inherited env).
process.env.STORAGE_HOST = '127.0.0.1';

const { ScreepsServer, TerrainMatrix } = require('screeps-server-mockup');

function createServer() {
	const server = new ScreepsServer();
	const origStartProcess = server.startProcess.bind(server);
	server.startProcess = function patchedStartProcess(name, execPath, childEnv) {
		if (name === 'storage') {
			childEnv.STORAGE_HOST = '127.0.0.1';
		}
		return origStartProcess(name, execPath, childEnv);
	};
	return server;
}

module.exports = { createServer: createServer, TerrainMatrix: TerrainMatrix };

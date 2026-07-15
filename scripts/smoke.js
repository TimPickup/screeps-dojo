'use strict';

// Stage-1 smoke test and dependency-upgrade canary (spec §11): boots the
// server, runs a bot for 5 ticks, asserts time advances and console arrives.
// Boot workaround (STORAGE_HOST, storage child env) lives in src/serverBoot.js.

process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const { createServer, TerrainMatrix, getMockEngineFeatures } = require('../src/serverBoot');

async function main() {
	console.log('[dojo] mock engine features: ' + JSON.stringify(getMockEngineFeatures()));
	const server = createServer();

	try {
		await server.world.reset();
		await server.world.addRoom('W0N0');
		await server.world.setTerrain('W0N0', new TerrainMatrix());
		await server.world.addRoomObject('W0N0', 'controller', 10, 10, { level: 0 });

		const modules = {
			main: "module.exports.loop = function () { console.log('tick', Game.time); };"
		};
		const bot = await server.world.addBot({ username: 'dojo', room: 'W0N0', x: 25, y: 25, modules });

		const consoleLines = [];
		bot.on('console', function (logs) {
			for (const line of logs || []) consoleLines.push(line);
		});

		await server.start();
		const startTime = await server.world.gameTime;
		for (let i = 0; i < 5; i++) await server.tick();
		const endTime = await server.world.gameTime;

		if (endTime < startTime + 5) throw new Error('gameTime did not advance: ' + startTime + ' -> ' + endTime);
		if (consoleLines.length === 0) throw new Error('no console output captured from bot');

		console.log('SMOKE OK: gameTime ' + startTime + ' -> ' + endTime + ', ' + consoleLines.length + ' console lines');
	} finally {
		server.stop();
	}
	process.exit(0);
}

main().catch(function (error) {
	console.error('SMOKE FAILED:', error);
	process.exit(1);
});

'use strict';

// Imports live rooms from a Screeps server into scenario map.json + memory files.
// Usage: npm run import-room -- <scenarioName> <ROOM> [ROOM...]
// Config (.env): DOJO_SCREEPS_TOKEN (or DOJO_SCREEPS_USERNAME/EMAIL +
//   DOJO_SCREEPS_PASSWORD for a private server whose token is rejected over the
//   socket, e.g. screepsmod-auth), DOJO_SCREEPS_SHARD (default shard0),
//   DOJO_SCREEPS_HOSTNAME (default screeps.com), DOJO_SCREEPS_PATH (default /),
//   DOJO_SCREEPS_PROTOCOL (default https), DOJO_SCREEPS_PORT (default 443).

function parseArgs(argv) {
	const args = argv.slice(2);
	const scenario = args[0];
	const rooms = args.slice(1);
	if (!scenario || rooms.length === 0) {
		throw new Error('usage: import-room -- <scenarioName> <ROOM> [ROOM...]');
	}
	return { scenario: scenario, rooms: rooms };
}

const fs = require('fs');
const path = require('path');
const { createClient } = require('../src/import/screepsClient');

// Returns a filename in `dir` that doesn't exist yet: base+ext, else
// "base (1)+ext", "base (2)+ext", … so an import never clobbers an existing map.
function uniqueFileName(dir, base, ext) {
	if (!fs.existsSync(path.join(dir, base + ext))) return base + ext;
	for (let n = 1; ; n++) {
		const candidate = base + ' (' + n + ')' + ext;
		if (!fs.existsSync(path.join(dir, candidate))) return candidate;
	}
}
const { roomToMap } = require('../src/import/roomToMap');

// .env is mounted into the container; load it without a dependency.
function loadEnv() {
	const envPath = path.join(__dirname, '..', '.env');
	const config = Object.assign({}, process.env);
	if (fs.existsSync(envPath)) {
		for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
			const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
			if (match) config[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
		}
	}
	return config;
}

// Build a synchronous classifier from the async resolver by pre-resolving every
// distinct owner id present in the objects (roomToMap calls classifyOwner sync).
async function buildSyncClassifier(objects, asyncClassify) {
	const ids = {};
	for (const object of objects) { if (object.user) ids[object.user] = true; }
	const table = {};
	for (const id of Object.keys(ids)) { table[id] = await asyncClassify(id); }
	return function (userId) { return table[userId] !== undefined ? table[userId] : null; };
}

async function main() {
	const parsed = parseArgs(process.argv);
	const config = loadEnv();
	const client = createClient(config);

	const window = await client.checkToken();
	if (window.active) {
		console.log('token: no-rate-limit window active, ~' + Math.round(window.secondsLeft / 60) + ' min left');
	} else {
		// The activation URL embeds the raw API token, so never print it: it would
		// leak into terminal scrollback / CI logs. Write the working one-click link
		// to a gitignored file and show only the masked URL.
		const linkFile = path.join(__dirname, '..', '.noratelimit.url');
		fs.writeFileSync(linkFile, window.activateUrl + '\n');
		console.log('token: no-rate-limit window NOT active. For a clean batch, activate it first:');
		console.log('  ' + window.maskedUrl);
		console.log('  (full one-click link written to .noratelimit.url — gitignored; open it in a logged-in browser)');
		console.log('Continuing anyway (a couple of rooms is within the normal rate limit).');
	}

	await client.connect();
	await client.me();
	const asyncClassify = client.ownerClassifier();

	const outDir = path.join(__dirname, '..', 'scenarios', parsed.scenario);
	fs.mkdirSync(outDir, { recursive: true });

	for (const roomName of parsed.rooms) {
		const room = await client.getRoom(roomName);
		const classifyOwner = await buildSyncClassifier(room.objects, asyncClassify);
		const result = roomToMap({
			roomName: roomName, objects: room.objects,
			terrainRows: room.terrainRows, classifyOwner: classifyOwner
		});
		// Save per-room as map.<ROOM>.json and NEVER overwrite an existing file
		// (a previous import or a hand-authored map) — dedupe with " (1)", " (2)"…
		const file = uniqueFileName(outDir, 'map.' + roomName, '.json');
		fs.writeFileSync(path.join(outDir, file), JSON.stringify(result.map, null, '\t'));
		const skippedSummary = Object.keys(result.skipped).length
			? ' (skipped ' + Object.keys(result.skipped).map(function (t) { return result.skipped[t] + ' ' + t; }).join(', ') + ')'
			: '';
		console.log('wrote ' + path.join('scenarios', parsed.scenario, file)
			+ ' — ' + result.map.structures.length + ' structures, '
			+ result.map.creeps.length + ' creeps' + skippedSummary);
	}

	// Memory + segments (one bot-wide blob, not per room).
	const memory = await client.getMemory();
	if (memory !== undefined && memory !== null) {
		fs.writeFileSync(path.join(outDir, 'memory.json'),
			typeof memory === 'string' ? memory : JSON.stringify(memory, null, '\t'));
		console.log('wrote ' + path.join('scenarios', parsed.scenario, 'memory.json'));
	}
	const segments = await client.getSegments(Array.from({ length: 100 }, function (unused, i) { return i; }));
	if (Object.keys(segments).length) {
		fs.writeFileSync(path.join(outDir, 'segments.json'), JSON.stringify(segments, null, '\t'));
		console.log('wrote ' + path.join('scenarios', parsed.scenario, 'segments.json')
			+ ' — segments ' + Object.keys(segments).join(', '));
	}

	client.disconnect();
}

if (require.main === module) {
	main().catch(function (error) {
		console.error('import-room failed: ' + error.message);
		process.exit(1);
	});
}

module.exports = { parseArgs: parseArgs };

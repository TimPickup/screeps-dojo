'use strict';

// Imports an OFFICIAL Screeps replay export (the client's own "download replay"
// format: { timestamp, room, base, ticks: { tick: fullSnapshot | diff } }) into
// a dojo recording, so it opens in the normal Replays tab.
//
// The per-tick diff is a recursive, partly-sparse patch, not a shallow one:
//   - a whole-object `null` at the top level removes that object;
//   - a nested field `null` sets that field to null;
//   - a nested field that is a plain object in both the current state and the
//     patch is merged key-by-key (recursively), NOT replaced wholesale — e.g.
//     `actionLog:{healed:{x,y}}` updates only `healed`, leaving `attack`,
//     `heal`, etc. as they were;
//   - a field that is currently an ARRAY (e.g. a creep's `body`) can be patched
//     SPARSELY, keyed by index as a plain object — e.g.
//     `body:{"0":{...},"10":{...}}` touches only those two body parts. A naive
//     shallow merge turns `body` into an 11-key object and silently drops the
//     other 39 parts, which is exactly what breaks a creep's rendering the
//     moment it starts taking part-by-part damage.
// Get any of this wrong and it doesn't error — it just quietly corrupts
// whichever object next receives a partial update, which is why the game
// looks fine for a while and then a creep vanishes or a tower's render breaks.
//
// Usage: node scripts/importReplay.js <path-to-replay.json>
//          [--name <scenario-name>] [--profile <profile>] [--shard <shard>]
//   Run via docker compose (screeps-api and the recording code live in the
//   container's node_modules, not the host's) — see the "import-replay" npm
//   script. The replay file must be somewhere under the repo (e.g. .tmp/),
//   since only the repo is bind-mounted into the container.
//   --shard overrides the profile's shard for the terrain fetch only, for a
//   replay downloaded from a different shard than your default profile talks
//   to (the replay export itself does not say which shard it came from).

function parseArgs(argv) {
	const args = argv.slice(2);
	const file = args[0];
	if (!file) {
		throw new Error('usage: node scripts/importReplay.js <replay.json> [--name <scenario-name>] [--profile <profile>] [--shard <shard>]');
	}
	let name = null;
	let profile = null;
	let shard = null;
	let apiPath = null;
	for (let i = 1; i < args.length; i++) {
		if (args[i] === '--name') name = args[++i];
		else if (args[i] === '--profile') profile = args[++i];
		else if (args[i] === '--shard') shard = args[++i];
		else if (args[i] === '--path') apiPath = args[++i];
	}
	return { file: file, name: name, profile: profile, shard: shard, apiPath: apiPath };
}

const fs = require('fs');
const path = require('path');
const { createClient } = require('../src/import/screepsClient');
const screepsProfiles = require('../src/screepsProfiles');
const { writeRecording, SCENARIOS_ROOT } = require('../src/recording');

// .env is mounted into the container; load it without a dependency (mirrors
// scripts/importRoom.js, which has no shared module for this).
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

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Applies one tick's patch for a single object onto its accumulated state, in
// place, recursing into nested plain objects and sparse (index-keyed) array
// patches instead of replacing them wholesale. See the file header for why a
// shallow merge is wrong here.
function deepMergeInto(target, patch) {
	for (const key in patch) {
		const value = patch[key];
		if (value === null) { target[key] = null; continue; }
		if (Array.isArray(target[key]) && isPlainObject(value)) {
			const arr = target[key];
			for (const indexKey in value) {
				const index = Number(indexKey);
				if (!Number.isInteger(index) || index < 0) continue;
				if (isPlainObject(arr[index]) && isPlainObject(value[indexKey])) deepMergeInto(arr[index], value[indexKey]);
				else arr[index] = value[indexKey];
			}
			continue;
		}
		if (isPlainObject(target[key]) && isPlainObject(value)) { deepMergeInto(target[key], value); continue; }
		target[key] = value;
	}
}

// Reconstructs the full per-tick room snapshot from the base+diff ticks. A new
// object's first appearance carries its full data (nothing to diff against
// yet), so create-or-merge is the same operation either way. Each frame gets a
// structuredClone of the accumulated state: deepMergeInto mutates nested
// objects/arrays IN PLACE, so a shallow per-frame copy would let a later tick's
// patch retroactively rewrite an already-recorded frame through the shared
// reference.
function reconstructFrames(replay) {
	const tickKeys = Object.keys(replay.ticks).map(Number).sort(function (a, b) { return a - b; });
	const state = {};
	const frames = [];
	for (const tick of tickKeys) {
		const diff = replay.ticks[tick];
		for (const id in diff) {
			if (diff[id] === null) { delete state[id]; continue; }
			if (!state[id]) state[id] = {};
			deepMergeInto(state[id], diff[id]);
		}
		frames.push({
			gameTime: tick,
			cpu: null,
			objects: Object.keys(state).map(function (id) { return structuredClone(state[id]); }),
			flags: []
		});
	}
	return frames;
}

async function main() {
	const { file, name, profile, shard, apiPath } = parseArgs(process.argv);
	const replay = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!replay.room || !replay.ticks) {
		throw new Error('not a Screeps replay export: expected {room, base, ticks}, got ' + Object.keys(replay || {}).join(', '));
	}

	const frames = reconstructFrames(replay);
	console.log('reconstructed ' + frames.length + ' ticks for ' + replay.room + ' (base tick ' + replay.base + ')');

	const config = screepsProfiles.resolve(profile, loadEnv());
	if (shard) {
		config.DOJO_SCREEPS_SHARD = shard;
		// Named shards (shard0-3, shardX) only exist on the main persistent-world
		// API, not under a season profile's /season/ path — a --shard override
		// almost always means "the normal world", so default the path there too
		// unless the caller says otherwise.
		if (!apiPath) config.DOJO_SCREEPS_PATH = '/';
	}
	if (apiPath) config.DOJO_SCREEPS_PATH = apiPath;
	const client = createClient(config);
	console.log('connecting to fetch terrain for ' + replay.room + '...');
	await client.connect();
	let terrainRows;
	try {
		terrainRows = (await client.getRoom(replay.room)).terrainRows;
	} finally {
		client.disconnect();
	}

	const scenarioName = name || ('Replays/' + replay.room + '-' + replay.base);
	const scenarioDir = path.join(SCENARIOS_ROOT, ...scenarioName.split('/'));
	fs.mkdirSync(scenarioDir, { recursive: true });
	const stubPath = path.join(scenarioDir, 'scenario.js');
	if (!fs.existsSync(stubPath)) {
		fs.writeFileSync(stubPath, "'use strict';\n\n"
			+ "// Placeholder — this scenario only holds an imported replay (see\n"
			+ "// recordings/); it exists so the Replays tab has somewhere to show it,\n"
			+ "// and is not meant to be run.\n"
			+ "module.exports = { maxTicks: 0, setup: async function () {} };\n");
	}

	const recordingFile = writeRecording(scenarioDir, {
		meta: {
			scenario: scenarioName,
			endReason: 'imported',
			ticks: frames.length,
			createdAt: new Date().toISOString(),
			sourceFile: path.basename(file)
		},
		terrain: { [replay.room]: terrainRows },
		frames: frames
	});

	console.log('wrote ' + recordingFile);
	console.log('open the dojo UI, select scenario "' + scenarioName + '", and watch it from the Replays tab.');
}

main().catch(function (e) {
	console.error(e && e.message ? e.message : e);
	process.exit(1);
});

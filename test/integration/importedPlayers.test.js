'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like smoke.js and runScenarioChild.js do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DojoWorld = require('../../src/dojoWorld');
const botModules = require('../../src/botModules');
const warnings = require('../../src/harnessWarnings');

function walledRoom(name, controller, structures, creeps) {
	const rows = ['#'.repeat(50)];
	for (let y = 1; y < 49; y++) rows.push('#' + '.'.repeat(48) + '#');
	rows.push('#'.repeat(50));
	return {
		room: name, terrain: rows, controller: controller,
		structures: structures || [], creeps: creeps || []
	};
}

function botDirWith(main) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-sidebot-'));
	fs.writeFileSync(path.join(dir, 'main.js'), main);
	return dir;
}

// An imported room carries every player's structures and creeps under a label
// derived from their username (src/import/ownerLabels.js). A scenario assigns a
// label a bot codebase in settings.json — `bots: { "<label>": "<profile>" }` —
// and the loader binds it: that player becomes a real user in the sim, running
// that code, owning the objects the import gave them. No scenario.js code.
describe('imported players', function () {
	this.timeout(600000);
	let world;
	let dir;
	let sideDirs;
	let warned = [];

	before(async function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-players-'));

		// W0N0 — mine, and the bot's home spawn.
		fs.writeFileSync(path.join(dir, 'map.W0N0.json'), JSON.stringify(walledRoom(
			'W0N0', { x: 5, y: 5, owner: 'me', level: 3 },
			[{ type: 'spawn', x: 10, y: 25, owner: 'me', name: 'Spawn1' }]
		)));

		// W1N0 — almaravarion's base, imported at RCL 3 with energy in the spawn.
		fs.writeFileSync(path.join(dir, 'map.W1N0.json'), JSON.stringify(Object.assign(
			walledRoom(
				'W1N0', { x: 5, y: 5, owner: 'almaravarion', level: 3 },
				[
					{ type: 'spawn', x: 20, y: 20, owner: 'almaravarion', name: 'TheirSpawn',
					  store: { energy: 300 } },
					{ type: 'extension', x: 21, y: 20, owner: 'almaravarion' }
				],
				[{ name: 'theirWorker', x: 22, y: 20, owner: 'almaravarion', body: ['move'] }]
			),
			{ users: { almaravarion: { id: '54d0a5691234', username: 'Almaravarion' } } }
		)));

		// W3N0 — a highway-like room with NO controller, holding the only object
		// of an assigned player. There is nowhere to seed them.
		fs.writeFileSync(path.join(dir, 'map.W3N0.json'), JSON.stringify(Object.assign(
			walledRoom('W3N0', undefined, [], [
				{ name: 'ghostScout', x: 25, y: 25, owner: 'ghost', body: ['move'] }
			]),
			{ controller: undefined }
		)));

		// W2N0 — nobody's room: a creep belonging to a player whose spawn is NOT
		// in the imported block, and a structure of a player nobody assigned.
		fs.writeFileSync(path.join(dir, 'map.W2N0.json'), JSON.stringify(walledRoom(
			'W2N0', { x: 5, y: 5 },
			[{ type: 'tower', x: 30, y: 30, owner: 'tigga' }],
			[{ name: 'strayMiner', x: 31, y: 30, owner: 'shrimp', body: ['work', 'move'] }]
		)));

		// What settings.json would have resolved to: label -> bot container dir.
		// scenarioRunner installs exactly this shape (installSideContext).
		sideDirs = {
			almaravarion: botDirWith(
				'module.exports.loop = function () {\n'
				+ "  var spawn = Game.spawns['TheirSpawn'];\n"
				+ "  if (spawn && !spawn.spawning) spawn.spawnCreep([MOVE], 'theirNew' + Game.time);\n"
				+ '};\n'
			),
			shrimp: botDirWith('module.exports.loop = function () {};\n'),
			ghost: botDirWith('module.exports.loop = function () {};\n')
		};
		botModules.setSides(Object.assign({ main: botDirWith('') }, sideDirs));
		warnings.reset();

		world = new DojoWorld({ scenarioDir: dir });
		await world.reset();
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadAllMaps();
		warned = warnings.take();
	});

	after(function () {
		botModules.clearSides();
		if (world) world.stop();
		fs.rmSync(dir, { recursive: true, force: true });
		for (const key of Object.keys(sideDirs || {})) {
			fs.rmSync(sideDirs[key], { recursive: true, force: true });
		}
	});

	async function userIdFor(username) {
		const { db } = await world.world.load();
		const user = await db.users.findOne({ username: username });
		return user ? user._id : null;
	}

	it('creates a real user for every assigned player', async function () {
		assert.ok(await userIdFor('almaravarion'), 'almaravarion should exist as a user');
		assert.ok(await userIdFor('shrimp'), 'shrimp should exist as a user');
	});

	it('gives an assigned player their imported structures', async function () {
		const { db } = await world.world.load();
		const id = await userIdFor('almaravarion');
		const extension = await db['rooms.objects'].findOne({ room: 'W1N0', type: 'extension' });
		assert.strictEqual(extension.user, id);
	});

	it('gives an assigned player their imported creeps', async function () {
		const { db } = await world.world.load();
		const id = await userIdFor('almaravarion');
		const creep = await db['rooms.objects'].findOne({ room: 'W1N0', name: 'theirWorker' });
		assert.strictEqual(creep.user, id);
	});

	it('leaves the imported spawn as the only spawn in their room', async function () {
		const { db } = await world.world.load();
		const spawns = await db['rooms.objects'].find({ room: 'W1N0', type: 'spawn' });
		assert.deepStrictEqual(spawns.map(function (s) { return s.name; }), ['TheirSpawn']);
	});

	it('owns their controller at its imported level, with no safe mode', async function () {
		const { db } = await world.world.load();
		const id = await userIdFor('almaravarion');
		const controller = await db['rooms.objects'].findOne({ room: 'W1N0', type: 'controller' });
		assert.strictEqual(controller.user, id);
		assert.strictEqual(controller.level, 3);
		// addBot hands every new user a 20000-tick safe mode; an imported base
		// that cannot be attacked would make a siege scenario meaningless.
		assert.ok(!controller.safeMode, 'imported base should not be in safe mode');
	});

	it('runs the code the scenario assigned to that player', async function () {
		const { db } = await world.world.load();
		const id = await userIdFor('almaravarion');
		for (let i = 0; i < 6; i++) await world.tick();
		const creeps = await db['rooms.objects'].find({ room: 'W1N0', type: 'creep', user: id });
		const spawned = creeps.filter(function (c) { return /^theirNew/.test(c.name); });
		assert.ok(spawned.length > 0, 'their assigned bot should have spawned a creep');
	});

	it('binds a player whose spawn is not in the imported block', async function () {
		const { db } = await world.world.load();
		const id = await userIdFor('shrimp');
		const creep = await db['rooms.objects'].findOne({ name: 'strayMiner' });
		assert.strictEqual(creep.user, id);
	});

	it('leaves no bootstrap spawn behind for a spawnless player', async function () {
		const { db } = await world.world.load();
		const spawns = await db['rooms.objects'].find({ room: 'W2N0', type: 'spawn' });
		assert.deepStrictEqual(spawns, []);
	});

	it('warns instead of failing when an assigned player has nowhere to be seeded', async function () {
		// Their only object sits in a controllerless room, and addBot needs a
		// controller. The import still loads; the creep just stays unbound.
		const { db } = await world.world.load();
		const creep = await db['rooms.objects'].findOne({ name: 'ghostScout' });
		assert.strictEqual(creep.user, 'ghost');
		assert.ok(
			warned.some(function (w) { return /ghost/.test(w) && /no room with a controller/.test(w); }),
			'expected a warning naming the unplaceable player, got: ' + JSON.stringify(warned)
		);
	});

	it('leaves an unassigned player exactly as it loads today', async function () {
		// Nothing in settings.json claims 'tigga', so the label passes straight
		// through as a raw user string — the behaviour existing scenarios (W29N1)
		// depend on when they bind imported owners themselves.
		const { db } = await world.world.load();
		const tower = await db['rooms.objects'].findOne({ room: 'W2N0', type: 'tower' });
		assert.strictEqual(tower.user, 'tigga');
		assert.strictEqual(await userIdFor('tigga'), null);
	});
});

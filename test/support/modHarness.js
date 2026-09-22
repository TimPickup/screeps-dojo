'use strict';

// Boots ONE modded (or vanilla) world in this process, exercises the mechanics
// the mod is supposed to bring, and prints the verdicts as a single JSON line.
//
// It runs as a child process on purpose: a mod cannot be unloaded, so a mocha
// process that loaded Season 5 would carry Thorium and reactors into every
// later test. test/integration/season5.test.js spawns this, once per world.
//
//   node test/support/modHarness.js '{"mods":["season5"]}'
//   -> __MOD_HARNESS__{"checks":{...}}
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const fs = require('fs');
const os = require('os');
const path = require('path');
const DojoWorld = require('../../src/dojoWorld');
const modRegistry = require('../../src/mods');

const MARKER = '__MOD_HARNESS__';

function openRoom(room) {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		if (y === 0 || y === 49) { rows.push('#'.repeat(50)); continue; }
		rows.push('#' + '.'.repeat(48) + '#');
	}
	return { room: room, terrain: rows, structures: [] };
}

// What the bot reports from inside its own VM: the only place that can say
// whether a mod reached the player sandbox rather than just the processor.
const BOT_MAIN = `
module.exports.loop = function () {
	const report = {
		thorium: typeof RESOURCE_THORIUM === 'undefined' ? null : RESOURCE_THORIUM,
		thoriumInResourcesAll: typeof RESOURCES_ALL === 'undefined' ? null : RESOURCES_ALL.indexOf('T') !== -1,
		findReactors: typeof FIND_REACTORS === 'undefined' ? null : FIND_REACTORS,
		lookReactors: typeof LOOK_REACTORS === 'undefined' ? null : LOOK_REACTORS,
		reactorType: typeof Reactor === 'undefined' ? null : 'Reactor'
	};
	const room = Game.rooms['W0N0'];
	if (room && typeof FIND_REACTORS !== 'undefined') {
		const reactors = room.find(FIND_REACTORS);
		report.reactorsFound = reactors.length;
		if (reactors.length) {
			report.reactorStoreT = reactors[0].store ? (reactors[0].store['T'] || 0) : null;
			report.reactorMine = reactors[0].my === true;
			report.continuousWork = reactors[0].continuousWork;
			report.toString = String(reactors[0]).slice(0, 9);
		}
		const claimer = Game.creeps.claimer;
		if (claimer) {
			report.hasClaimReactor = typeof claimer.claimReactor === 'function';
			if (reactors.length && report.hasClaimReactor && Memory.claim) {
				report.claimResult = claimer.claimReactor(reactors[0]);
			}
		}
	}
	console.log('BOTREPORT' + JSON.stringify(report));
};
`;

async function main() {
	const options = JSON.parse(process.argv[2] || '{}');
	const modIds = modRegistry.validate(options.mods || [], 'harness');
	// `sabotage` swaps the real mod for a module that loads cleanly and does
	// nothing — what a half-broken mod looks like to @screeps/common, which
	// catches and logs load errors rather than raising them.
	const modFile = options.sabotage ? stubModFile() : modRegistry.createModFile(modIds);
	const checks = {};
	const notes = {};
	let botReport = null;

	function check(name, ok, detail) {
		checks[name] = { ok: Boolean(ok), detail: detail === undefined ? null : detail };
	}

	const world = new DojoWorld({ mods: modIds, modfile: modFile && modFile.path });
	try {
		await world.reset();

		// The probe is the same one runScenario uses; report rather than throw, so
		// a failed load is a verdict the test can assert on.
		try {
			modRegistry.probe(modIds, null, { scenario: 'modHarness', modFile: modFile && modFile.path });
			check('probe', true, modIds.join(','));
		} catch (e) {
			check('probe', false, String(e.message || e));
		}

		if (options.sabotage) { notes.sabotage = true; return finish(); }

		// A mod applied twice registers every hook twice and silently doubles
		// every per-tick effect — the score, the decay penalty, all of it — with
		// nothing reporting a problem. Assert the shape of the load itself.
		if (modIds.length) {
			const driver = require('@screeps/driver');
			const engine = require('@screeps/common').configManager.config.engine;
			const reactorPrototypes = driver.customObjectPrototypes
				.filter(function (p2) { return p2.objectType === 'reactor'; }).length;
			check('modLoadedExactlyOnce',
				reactorPrototypes === 1
				&& engine.listenerCount('processObjectIntents') === 1
				&& engine.listenerCount('processRoom') === 1
				&& engine.listenerCount('processObject') === 1,
				JSON.stringify({
					reactorPrototypes: reactorPrototypes,
					processObjectIntents: engine.listenerCount('processObjectIntents'),
					processRoom: engine.listenerCount('processRoom'),
					processObject: engine.listenerCount('processObject'),
					// the mod itself registers two of these (mineral + reactor)
					postProcessObject: engine.listenerCount('postProcessObject')
				}));
		}

		const maps = [openRoom('W0N0'), openRoom('W1N0'), openRoom('W2N0')];
		await world.createRoomsFromMaps(maps, { sealExteriorExits: false });
		await world.addMainBot({ room: 'W0N0', x: 25, y: 25, modules: { main: BOT_MAIN } });
		const enemy = await world.addEnemyBot({
			username: 'rival', room: 'W1N0', x: 25, y: 25,
			modules: { main: 'module.exports.loop = function () {};' }
		});

		const botLines = [];
		world.bot.on('console', function (lines) { for (const line of lines || []) botLines.push(line); });
		// The engine HTML-escapes console output before publishing it (@screeps
		// driver runs every line through `he`), so a JSON payload comes back with
		// &#x22; where its quotes were.
		function unescapeConsole(line) {
			return line.replace(/&#x([0-9a-fA-F]+);/g, function (match, hex) { return String.fromCharCode(parseInt(hex, 16)); })
				.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
		}
		function takeReport() {
			for (let i = botLines.length - 1; i >= 0; i--) {
				if (botLines[i].indexOf('BOTREPORT') === 0) {
					try { return JSON.parse(unescapeConsole(botLines[i].slice('BOTREPORT'.length))); } catch (e) { return null; }
				}
			}
			return null;
		}

		// --- the world under test ------------------------------------------
		// Reactor and Thorium are placed explicitly: the mod's world-generation
		// cronjobs are backend-side and never run here (that is the deal).
		await world.addObject('W0N0', 'reactor', 10, 10, {});
		await world.addObject('W0N0', 'mineral', 5, 5, { mineralType: 'T' });
		// A nearly-empty Thorium mineral, to watch Season 5 remove it.
		await world.addObject('W0N0', 'mineral', 7, 7, { mineralType: 'T', mineralAmount: 0 });
		// A road sharing a tile with a container of Thorium: its decay clock
		// should run down faster than the road on the clean tile beside it.
		// (Season 5 reads store.T, so a DROPPED pile — which keeps its amount in
		// a field named after the resource — does not count.)
		await world.addObject('W0N0', 'road', 30, 30, { ticksToDecay: 1000 });
		await world.addObject('W0N0', 'road', 32, 30, { ticksToDecay: 1000 });
		await world.addObject('W0N0', 'container', 30, 30, { store: { T: 1000 } });
		// Terminals: mine in W0N0, the rival's in W1N0, and a second of mine in
		// W2N0 — cross-owner sends must be cancelled, same-owner sends must not.
		await world.addObject('W0N0', 'terminal', 20, 20, { user: world.botUserId, store: { energy: 50000, H: 1000 }, cooldownTime: 0 });
		await world.addObject('W1N0', 'terminal', 20, 20, { user: enemy.id, store: { energy: 50000 }, cooldownTime: 0 });
		await world.addObject('W2N0', 'terminal', 20, 20, { user: world.botUserId, store: { energy: 50000 }, cooldownTime: 0 });
		// A stronghold core plus (later) a nuke about to land on it. The core is
		// given far more hits than a real one: Season 5 writes the "nuked" mark on
		// the same tick the engine detonates the nuke, so a core that the blast
		// destroys takes the mark to the grave and nothing can read it back.
		await world.addObject('W2N0', 'invaderCore', 25, 25, { level: 1, hits: 50000000, hitsMax: 50000000 });

		// Terminals only work in a room whose controller is high enough: the
		// vanilla engine zeroes storeCapacity on a structure the RCL does not
		// support, and a zero-capacity terminal can neither send nor receive.
		// Without this the Season 5 restriction would "pass" for the wrong reason.
		await world.updateObject({ room: 'W0N0', type: 'controller' }, { level: 8, user: world.botUserId });
		await world.updateObject({ room: 'W1N0', type: 'controller' }, { level: 8, user: enemy.id });
		await world.updateObject({ room: 'W2N0', type: 'controller' }, { level: 8, user: world.botUserId });

		await world.addCreep({ room: 'W0N0', x: 11, y: 10, name: 'claimer', body: ['claim', 'move'] });

		await world.start();

		// --- what the sandbox sees ------------------------------------------
		await world.tick();
		botReport = takeReport();
		const report = botReport || {};
		if (!modIds.length) {
			// Vanilla control. Everything Season 5 adds must be absent — this is
			// what the before/after runs in the isolation test assert.
			await world.updateObject({ type: 'reactor' }, { store: { T: 10 }, user: world.botUserId });
			await world.updateObject({ room: 'W0N0', type: 'controller' }, { level: 8, user: world.botUserId });
			await world.updateObject({ room: 'W1N0', type: 'controller' }, { level: 8, user: enemy.id });
			await world.tick();
			await world.tick();
			const driver = require('@screeps/driver');
			const config = require('@screeps/common').configManager.config;
			check('vanillaNoConstants', report.thorium === null && report.findReactors === null,
				JSON.stringify({ thorium: report.thorium, find: report.findReactors }));
			check('vanillaNoReactorPrototype',
				!(driver.customObjectPrototypes || []).some(function (p2) { return p2.objectType === 'reactor'; }),
				JSON.stringify((driver.customObjectPrototypes || []).map(function (p2) { return p2.objectType; })));
			check('vanillaNoClaimReactor', report.hasClaimReactor !== true, String(report.hasClaimReactor));
			check('vanillaNoIntentType', !(config.engine.customIntentTypes || {}).claimReactor,
				JSON.stringify(Object.keys(config.engine.customIntentTypes || {})));
			check('vanillaNoScore', (await world.readUsers())[world.botUserId].score === 0,
				String((await world.readUsers())[world.botUserId].score));
			// The two engine-side rules, inverted: an empty Thorium mineral stays,
			// and a cross-owner terminal send goes through.
			check('vanillaKeepsEmptyMineral',
				(await find(world, { room: 'W0N0', type: 'mineral' })).some(function (m) { return m.x === 7 && m.y === 7; }),
				'mineral at 7,7');
			await world.updateObject({ room: 'W0N0', type: 'terminal' },
				{ send: { targetRoomName: 'W1N0', resourceType: 'H', amount: 100 } });
			await world.tick();
			await world.tick();
			const rival = await findOne(world, { room: 'W1N0', type: 'terminal' });
			check('vanillaAllowsCrossOwnerSend', Boolean(rival.store && rival.store.H > 0), JSON.stringify(rival.store));
			notes.gameTime = await world.world.gameTime;
			return finish();
		}

		check('constantsInSandbox',
			report.thorium === 'T' && report.thoriumInResourcesAll === true
			&& report.findReactors === 10051 && report.lookReactors === 'reactor',
			JSON.stringify({ thorium: report.thorium, inAll: report.thoriumInResourcesAll, find: report.findReactors }));
		check('findReactors', report.reactorsFound === 1 && report.toString === '[reactor ',
			JSON.stringify({ found: report.reactorsFound, toString: report.toString }));
		check('claimReactorExists', report.hasClaimReactor === true, String(report.hasClaimReactor));

		// --- an unclaimed reactor with Thorium must not score ----------------
		await world.updateObject({ type: 'reactor' }, { store: { T: 10 } });
		const scoreBefore = (await world.readUsers())[world.botUserId].score;
		await world.tick();
		await world.tick();
		const scoreUnclaimed = (await world.readUsers())[world.botUserId].score;
		check('unclaimedReactorDoesNotScore', scoreUnclaimed === scoreBefore,
			scoreBefore + ' -> ' + scoreUnclaimed);

		// --- claim it from bot code ------------------------------------------
		await world.seedMemory({ claim: true });
		await world.tick();
		await world.tick();
		const claimReport = takeReport() || {};
		// botReport is the FIRST tick's report, before the bot is told to claim;
		// this one carries what claimReactor() actually returned.
		notes.claimReport = claimReport;
		const reactorDoc = await reactor(world);
		check('claimReactorTransfersOwnership', reactorDoc && reactorDoc.user === world.botUserId,
			JSON.stringify({ result: claimReport.claimResult, owner: reactorDoc && reactorDoc.user }));

		// --- a claimed reactor burns Thorium and pays its owner ---------------
		await world.updateObject({ type: 'reactor' }, { store: { T: 20 } });
		const beforeBurn = await reactor(world);
		const scoreBeforeBurn = (await world.readUsers())[world.botUserId].score;
		await world.tick();
		// Read the clock WHILE it burns: Season 5 deletes launchTime the moment
		// the reactor runs dry, so a reading taken afterwards is always null.
		const burning = await reactor(world);
		await world.tick();
		await world.tick();
		const afterBurn = await reactor(world);
		const scoreAfterBurn = (await world.readUsers())[world.botUserId].score;
		check('claimedReactorConsumesThorium',
			afterBurn && beforeBurn && beforeBurn.store.T - afterBurn.store.T === 3,
			JSON.stringify({ before: beforeBurn && beforeBurn.store, after: afterBurn && afterBurn.store }));
		check('claimedReactorScores', scoreAfterBurn > scoreBeforeBurn,
			scoreBeforeBurn + ' -> ' + scoreAfterBurn);
		check('reactorLaunchTime', burning && typeof burning.launchTime === 'number',
			String(burning && burning.launchTime));
		// The rate, not just the direction: Season 5 pays
		// 1 + floor(log10(1 + continuousWork)) per tick, so a reactor that has
		// just started scores exactly 1 a tick. Twice that means the mod's
		// listeners ran twice.
		await world.updateObject({ type: 'reactor' }, { store: { T: 40 }, launchTime: null });
		const rateStart = (await world.readUsers())[world.botUserId].score;
		await world.tick();
		await world.tick();
		await world.tick();
		const rateEnd = (await world.readUsers())[world.botUserId].score;
		const gained = rateEnd - rateStart;
		check('scoreRateMatchesFormula', gained === 3,
			'3 ticks of a freshly started reactor should pay 3, paid ' + gained);

		const workReport = takeReport() || {};
		check('continuousWorkVisibleToBot', typeof workReport.continuousWork === 'number' && workReport.continuousWork >= 0,
			String(workReport.continuousWork));

		// The last unit must reach zero, not -1 (which is truthy and keeps burning).
		await world.updateObject({ type: 'reactor' }, { store: { T: 1 }, launchTime: null });
		const lastUnitScore = (await world.readUsers())[world.botUserId].score;
		await world.tick();
		const exhausted = await reactor(world);
		await world.tick();
		const stopped = await reactor(world);
		const stoppedScore = (await world.readUsers())[world.botUserId].score;
		check('reactorStopsWhenEmpty', exhausted.store.T === 0 && stopped.store.T === 0
			&& !stopped.launchTime && stoppedScore - lastUnitScore === 1,
			JSON.stringify({ exhausted: exhausted.store, stopped: stopped.store,
				launchTime: stopped.launchTime, scoreGained: stoppedScore - lastUnitScore }));

		// --- Thorium in a tile ages everything standing in it ------------------
		const roads = await find(world, { room: 'W0N0', type: 'road' });
		const dirty = roads.find(function (r) { return r.x === 30; });
		const clean = roads.find(function (r) { return r.x === 32; });
		check('thoriumAcceleratesDecay',
			dirty && clean && dirty.nextDecayTime < clean.nextDecayTime,
			JSON.stringify({ withThorium: dirty && dirty.nextDecayTime, without: clean && clean.nextDecayTime }));

		// --- an empty Thorium mineral is removed -------------------------------
		const minerals = await find(world, { room: 'W0N0', type: 'mineral' });
		check('depletedThoriumRemoved', minerals.every(function (m) { return !(m.x === 7 && m.y === 7); }),
			JSON.stringify(minerals.map(function (m) { return m.x + ',' + m.y + '=' + m.mineralAmount; })));
		// Thorium is finite: it is deleted when it runs out, never regenerated, so
		// stamping the engine's regeneration deadline on one would be a lie the
		// bot and the inspector can both read.
		const thorium = minerals.find(function (m) { return m.x === 5 && m.y === 5; });
		check('thoriumHasNoRegenClock',
			Boolean(thorium) && thorium.nextRegenerationTime === undefined,
			JSON.stringify(thorium && { amount: thorium.mineralAmount, nextRegenerationTime: thorium.nextRegenerationTime }));
		check('placedThoriumSurvives', minerals.some(function (m) { return m.x === 5 && m.y === 5 && m.mineralAmount > 0; }),
			JSON.stringify(minerals.map(function (m) { return m.x + ',' + m.y + '=' + m.mineralAmount; })));

		// --- terminals: cross-owner blocked, same-owner allowed -----------------
		await world.updateObject({ room: 'W0N0', type: 'terminal' },
			{ send: { targetRoomName: 'W1N0', resourceType: 'H', amount: 100 } });
		await world.tick();
		await world.tick();
		const rivalTerminal = await findOne(world, { room: 'W1N0', type: 'terminal' });
		check('crossOwnerTerminalSendBlocked', !(rivalTerminal.store && rivalTerminal.store.H),
			JSON.stringify(rivalTerminal.store));

		await world.updateObject({ room: 'W0N0', type: 'terminal' },
			{ send: { targetRoomName: 'W2N0', resourceType: 'H', amount: 100 } });
		await world.tick();
		await world.tick();
		const ownTerminal = await findOne(world, { room: 'W2N0', type: 'terminal' });
		const sourceTerminal = await findOne(world, { room: 'W0N0', type: 'terminal' });
		notes.terminals = (await find(world, { type: 'terminal' })).map(function (t) {
			return { room: t.room, user: t.user, store: t.store, cap: t.storeCapacity, cooldownTime: t.cooldownTime, send: t.send };
		});
		check('sameOwnerTerminalSendAllowed', Boolean(ownTerminal.store && ownTerminal.store.H > 0),
			JSON.stringify({ target: ownTerminal.store, source: sourceTerminal.store, send: sourceTerminal.send }));

		// --- stronghold rules ----------------------------------------------------
		const strongholds = require('@screeps/common').configManager.config.common.strongholds;
		check('strongholdRewards',
			Boolean(strongholds.coreRewards && strongholds.coreRewards.nuked)
			&& strongholds.containerRewards && strongholds.containerRewards.T === 10,
			JSON.stringify({ nuked: Boolean(strongholds.coreRewards && strongholds.coreRewards.nuked), containerT: strongholds.containerRewards && strongholds.containerRewards.T }));

		const core = await findOne(world, { room: 'W2N0', type: 'invaderCore' });
		check('invaderCoreDepositType', core && core.depositType === 'normal', String(core && core.depositType));

		// A nuke lands the tick AFTER landTime === gameTime + 1 is seen.
		// Season 5 marks the core on the tick where landTime === gameTime + 1 —
		// one tick BEFORE the nuke lands and levels the room, which is the only
		// moment the mark can still be read off the core.
		const now = await world.world.gameTime;
		await world.addObject('W2N0', 'nuke', 25, 26, { launchRoomName: 'W0N0', landTime: now + 3 });
		let nukeMark = null;
		const nukeTrace = [];
		for (let i = 0; i < 4 && nukeMark !== 'nuked'; i++) {
			await world.tick();
			const core = await findOne(world, { room: 'W2N0', type: 'invaderCore' });
			nukeMark = core ? core.depositType : '(core destroyed)';
			nukeTrace.push(nukeMark);
		}
		check('nukeMarksCoreNuked', nukeMark === 'nuked', nukeTrace.join(' -> '));

		notes.gameTime = await world.world.gameTime;
		notes.consoleLines = botLines.slice(-6);
		notes.botErrors = world.takeBotErrors();
	} catch (e) {
		notes.error = String((e && e.stack) || e);
	} finally {
		try { world.stop(); } catch (e) { /* already stopped */ }
		if (modFile) modFile.cleanup();
	}

	finish();

	function finish() {
		process.stdout.write('\n' + MARKER + JSON.stringify({ mods: modIds, checks: checks, botReport: botReport, notes: notes }) + '\n');
		// The engine leaves timers and sockets behind; nothing else is pending.
		process.exit(0);
	}
}

// A mods.json naming a module that loads without doing anything: the shape of
// a mod that threw halfway through its own require chain, which
// @screeps/common swallows. The probe is the only thing that can tell that
// apart from a healthy load.
function stubModFile() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-stub-mod-'));
	const stub = path.join(dir, 'stub.js');
	fs.writeFileSync(stub, 'module.exports = function () {};\n');
	const file = path.join(dir, 'mods.json');
	fs.writeFileSync(file, JSON.stringify({ mods: [stub], bots: {} }));
	return {
		path: file,
		cleanup: function () {
			for (const f of [stub, file]) { try { fs.unlinkSync(f); } catch (e) { /* gone */ } }
			try { fs.rmdirSync(dir); } catch (e) { /* not empty */ }
		}
	};
}

async function find(world, query) {
	const { db } = await world.world.load();
	return db['rooms.objects'].find(query);
}

async function findOne(world, query) {
	const { db } = await world.world.load();
	return db['rooms.objects'].findOne(query);
}

function reactor(world) { return findOne(world, { type: 'reactor' }); }

main().catch(function (e) {
	process.stdout.write('\n' + MARKER + JSON.stringify({ checks: {}, notes: { error: String((e && e.stack) || e) } }) + '\n');
	process.exit(1);
});

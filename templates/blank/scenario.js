'use strict';

// Scenario: __SCENARIO_NAME__
//
// A blank scenario: no map, no main.js, nothing placed — just the contract,
// commented through.
//
// IT WILL NOT RUN YET. Every scenario needs a world and a bot in it, so until
// setup() loads a map a run stops with:
//
//     setup() must add the main bot (loadScenarioMaps or addMainBot)
//
// To get there: add a room in the Edit tab (or pull a real one in with
// "Import a room"), then uncomment the loadAllMaps line in setup() below.
//
// A scenario is this one object. Only `modules`, `maxTicks` and `setup` are
// required; `until` and `expect` are optional and are what turn a run into a
// test.

// Used by the commented-out lines below; keep them if you uncomment those.
const fs = require('fs');
const path = require('path');
// Your real bot, instead of a local main.js — see `modules` below.
// const { allBotModules, loadBotModules, botDir } = require('../../src/botModules');

module.exports = {

	// ---- code that runs in the game VM ---------------------------------
	//
	// A map of module name -> source. 'main' is the entry point, exactly as on
	// a real server. Three usual shapes:
	//
	//   1. a local main.js next to this file (uncomment below, add the file)
	//   2. allBotModules()            — your whole bot codebase
	//   3. loadBotModules(['main', 'roleHarvester'])  — just the parts you want
	//
	// WHICH codebase (2) and (3) read from is your default bot profile. Add a
	// settings.json here — the ⚙ beside the Edit tab — to point this scenario
	// at a different one, give a second side its own bot, or load a game mod:
	//
	//   { "bot": "myBot", "bots": { "enemy": "otherBot" }, "mods": ["season5"] }
	modules: {
		main: 'module.exports.loop = function () {\n'
			+ '\tconsole.log("tick " + Game.time);\n'
			+ '};\n'
	},
	// modules: { main: fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') },
	// modules: allBotModules(),

	// ---- how long it may run -------------------------------------------
	//
	// Required safety cap, in ticks. The run also stops early if until()
	// returns true, or if the bot's last spawn and creep are gone.
	maxTicks: 200,

	// ---- building the world ---------------------------------------------
	//
	// Runs once, before tick 1. `world` is the DojoWorld facade — always use
	// it rather than poking the server's database directly.
	setup: async function (world) {
		// START HERE. Load EVERY map.*.json in this directory, and put the
		// bot's spawn at { room, x, y }. Nothing runs until this line is live:
		//
		//   await world.loadAllMaps({ room: 'W1N1', x: 25, y: 25 });
		//
		// Leave the argument off entirely if one of your maps already has a
		// spawn with owner 'me' — that spawn is adopted as the bot's home, so
		// an imported base never has to restate coordinates the map carries:
		//
		//   await world.loadAllMaps();
		//
		// Or name the rooms yourself, in load order:
		//
		//   await world.loadScenarioMaps(
		//     [world.loadMap('W1N1'), world.loadMap('W0N1')],
		//     { room: 'W1N1', x: 25, y: 25 });

		// Seeding Memory and RawMemory segments — a third argument to either
		// call, so the bot wakes up with state instead of an empty Memory.
		// Pass an object, or read the scenario's own memory.json / segments.json
		// (which is what "Import a room" writes):
		//
		//   await world.loadAllMaps({ room: 'W1N1', x: 25, y: 25 }, {
		//     memory: JSON.parse(fs.readFileSync(path.join(__dirname, 'memory.json'), 'utf8')),
		//     segments: JSON.parse(fs.readFileSync(path.join(__dirname, 'segments.json'), 'utf8'))
		//   });

		// Then place whatever the run needs:
		//
		//   await world.addCreep({ room: 'W1N1', x: 26, y: 25, name: 'A',
		//     body: ['move', 'work', 'carry'] });
		//   await world.addCreep({ room: 'W1N1', x: 30, y: 25, name: 'enemy1',
		//     body: ['attack', 'move'], user: 2 });      // user 2 = the Invader NPC
		//   await world.addFlag('goal', 'W1N1', 25, 25, {});
		//   await world.addObject('W1N1', 'container', 24, 25, { store: { energy: 2000 } });
		//   await world.updateObject({ room: 'W1N1', type: 'spawn' }, { store: { energy: 300 } });
		//   await world.removeObject({ room: 'W1N1', type: 'rampart' });
		//
		// A second player running real code. The side name ('enemy' here) is a
		// key in settings.json's "bots", so which codebase it runs is config,
		// not code:
		//
		//   await world.addEnemyBot({ username: 'enemy', room: 'W0N1', x: 25, y: 25,
		//     modules: allBotModules(null, botDir('enemy')) });
	},

	// ---- stopping early (optional) ---------------------------------------
	//
	// Checked after every tick. Return true to end the run with
	// endReason 'until'. Without it the run goes the full maxTicks.
	//
	// `state` is the same shape expect() sees as result.finalState:
	//   state.objects       — every room object (type, room, x, y, store, hits, …)
	//   state.creeps        — YOUR creeps by name
	//   state.hostileCreeps — everyone else's, by name
	//   state.flags         — flags by name
	//   state.users         — userId -> { username, score }
	until: function (state) {
		return false;
	},

	// ---- the verdict (optional) ------------------------------------------
	//
	// Turns a run into a test: `npm test` and the GUI's Test tab report
	// pass/fail from these assertions, and a recording carries the badge.
	// `assert` is Node's own assert module.
	//
	//   result.endReason  — 'until' | 'maxTicks' | 'botDied' | 'aborted'
	//   result.ticks      — how many ticks actually ran
	//   result.finalState — the state shape described above
	//   result.survived   — creep name -> true/false
	//   result.console    — every console line the bot printed
	//   result.damageTaken— damage per owned object
	expect: function (result, assert) {
		assert.ok(result.ticks > 0, 'the run should have advanced at least one tick');
	}
};

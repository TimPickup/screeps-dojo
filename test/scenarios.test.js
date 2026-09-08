'use strict';

// Every user scenario runs in its OWN forked process (src/scenarioChild.js).
//
// Sequential runs in one mocha process used to be merely wasteful; with game
// mods they are wrong. A mod mutates shared engine state — constants, engine
// listeners, custom object prototypes — and @screeps/common cannot unload one,
// so a process that has run a Season 5 scenario would carry Thorium and
// reactors into every scenario after it. The child also runs the scenario's
// own expect(), and reports the verdict here.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { forkScenario } = require('../src/scenarioChild');

const scenariosRoot = path.join(__dirname, '..', 'scenarios');
// scenarios/ is the user's git-ignored workspace and is empty on a fresh
// checkout — tolerate it being absent or holding no scenario.js dirs.
const scenarioDirs = (fs.existsSync(scenariosRoot) ? fs.readdirSync(scenariosRoot) : []).filter(function (entry) {
	return fs.existsSync(path.join(scenariosRoot, entry, 'scenario.js'));
});

describe('scenarios', function () {
	if (scenarioDirs.length === 0) {
		it('no scenarios present — add one under scenarios/ (see examples/)', function () {
			this.skip();
		});
		return;
	}
	// no wall-clock limit: maxTicks bounds each run and the runner's per-tick
	// watchdog catches a stalled server (see scenarioRunner.js)
	this.timeout(0);
	for (const dir of scenarioDirs) {
		it(dir, async function () {
			const scenarioDir = path.join(scenariosRoot, dir);
			const consoleLines = [];
			const run = forkScenario(scenarioDir, {
				// frames would be the bulk of the IPC traffic and nothing here reads
				// them; recordings are still written when the scenario asks for one.
				streamFrames: false,
				onEvent: function (ev) {
					if (ev.type === 'console') for (const line of ev.lines || []) consoleLines.push(line);
					if (ev.type === 'fatal') console.log('\t' + dir + ': ' + ev.error);
				}
			});
			const result = await run.promise;
			console.log('\t' + dir + ': ' + result.endReason + ' after ' + result.ticks
				+ ' ticks, damage ' + JSON.stringify(result.damageTaken)
				+ (result.mods && result.mods.length ? ', mods ' + result.mods.join('+') : ''));
			// printed before the verdict so the path survives a failing scenario —
			// failed runs are exactly the ones worth replaying
			if (result.recordingPath) console.log('\trecorded: ' + result.recordingPath);
			// expect() ran inside the child, against the full final state; only its
			// verdict crosses IPC.
			assert.ok(result.test, dir + ': the run produced no expect() verdict');
			assert.ok(result.test.passed, dir + ': ' + result.test.message);
		});
	}
});

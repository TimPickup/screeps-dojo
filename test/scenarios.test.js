'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like smoke.js and runScenarioChild.js do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runScenario } = require('../src/scenarioRunner');

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
			const result = await runScenario(scenarioDir);
			console.log('\t' + dir + ': ' + result.endReason + ' after ' + result.ticks
				+ ' ticks, damage ' + JSON.stringify(result.damageTaken));
			// printed before expect() so the path survives a failing scenario —
			// failed runs are exactly the ones worth replaying
			if (result.recordingPath) console.log('\trecorded: ' + result.recordingPath);
			const scenario = require(path.join(scenarioDir, 'scenario.js'));
			scenario.expect(result, assert);
		});
	}
});

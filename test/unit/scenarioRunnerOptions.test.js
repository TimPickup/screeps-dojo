'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like smoke.js and runScenarioChild.js do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

// Exercises the GUI control-plane additions to runScenario (Phase 1):
// event stream, cooperative abort, and runExpect pass/fail capture. Needs the
// engine, so it runs in-container like the other engine tests.
const assert = require('assert');
const path = require('path');
const { runScenario } = require('../../src/scenarioRunner');

const FIX = path.join(__dirname, '..', 'fixtures', 'tiny-scenario');

describe('runScenario options (GUI control-plane)', function () {
	this.timeout(0);

	it('is backward compatible with no options', async function () {
		const r = await runScenario(FIX);
		assert.strictEqual(r.endReason, 'until');
		assert.ok(r.ticks > 0);
		assert.strictEqual(r.test, undefined, 'no test field unless runExpect');
	});

	it('emits start, tick, frame and end events', async function () {
		const types = [];
		let endPayload = null;
		const r = await runScenario(FIX, {
			onEvent: function (e) { types.push(e.type); if (e.type === 'end') endPayload = e; }
		});
		assert.ok(types.includes('start'), 'has start');
		assert.ok(types.includes('tick'), 'has tick');
		assert.ok(types.includes('frame'), 'has frame (streamFrames default on)');
		assert.ok(types.includes('end'), 'has end');
		assert.strictEqual(endPayload.endReason, r.endReason);
	});

	it('frames carry per-tick console field', async function () {
		let sawFrameWithConsole = false;
		await runScenario(FIX, {
			onEvent: function (e) {
				if (e.type === 'frame' && Array.isArray(e.frame.console)) sawFrameWithConsole = true;
			}
		});
		assert.ok(sawFrameWithConsole, 'every frame has a console array');
	});

	it('cooperative abort stops at the loop boundary with endReason aborted', async function () {
		const signal = { aborted: true };
		const r = await runScenario(FIX, { signal: signal });
		assert.strictEqual(r.endReason, 'aborted');
		assert.strictEqual(r.ticks, 0);
	});

	it('runExpect captures pass/fail without throwing', async function () {
		const r = await runScenario(FIX, { runExpect: true });
		assert.ok(r.test && typeof r.test.passed === 'boolean');
		assert.strictEqual(r.test.passed, true, 'tiny scenario should pass its own expect');
	});
});

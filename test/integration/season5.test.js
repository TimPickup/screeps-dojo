'use strict';

// Season 5 end to end, against the REAL official mod.
//
// Every world runs in its own child process (test/support/modHarness.js). That
// is not tidiness: a mod mutates shared engine state and @screeps/common cannot
// unload one, so a mocha process that loaded Season 5 would carry Thorium and
// reactors into every test after it. The vanilla → Season 5 → vanilla sequence
// below is the assertion that this holds.
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const HARNESS = path.join(__dirname, '..', 'support', 'modHarness.js');
const MARKER = '__MOD_HARNESS__';

function runHarness(options, env) {
	const result = spawnSync(process.execPath, [HARNESS, JSON.stringify(options || {})], {
		cwd: path.join(__dirname, '..', '..'),
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		env: Object.assign({}, process.env, env || {})
	});
	const output = (result.stdout || '') + (result.stderr || '');
	const index = output.lastIndexOf(MARKER);
	assert.ok(index !== -1, 'harness produced no verdict:\n' + output.slice(-4000));
	const parsed = JSON.parse(output.slice(index + MARKER.length).split('\n')[0]);
	assert.ok(!parsed.notes.error, 'harness failed: ' + parsed.notes.error);
	return parsed;
}

function assertChecks(run, names) {
	for (const name of names) {
		const check = run.checks[name];
		assert.ok(check, 'harness did not run the "' + name + '" check');
		assert.ok(check.ok, name + ' failed: ' + check.detail);
	}
}

const SEASON5_CHECKS = [
	'probe',
	'modLoadedExactlyOnce',
	'scoreRateMatchesFormula',
	'constantsInSandbox',
	'findReactors',
	'claimReactorExists',
	'unclaimedReactorDoesNotScore',
	'claimReactorTransfersOwnership',
	'claimedReactorConsumesThorium',
	'claimedReactorScores',
	'reactorLaunchTime',
	'continuousWorkVisibleToBot',
	'thoriumAcceleratesDecay',
	'depletedThoriumRemoved',
	'thoriumHasNoRegenClock',
	'placedThoriumSurvives',
	'crossOwnerTerminalSendBlocked',
	'sameOwnerTerminalSendAllowed',
	'strongholdRewards',
	'invaderCoreDepositType',
	'nukeMarksCoreNuked'
];

const VANILLA_CHECKS = [
	'vanillaNoConstants',
	'vanillaNoReactorPrototype',
	'vanillaNoClaimReactor',
	'vanillaNoIntentType',
	'vanillaNoScore',
	'vanillaKeepsEmptyMineral',
	'vanillaAllowsCrossOwnerSend'
];

describe('season5 mod', function () {
	this.timeout(900000);

	describe('fast in-process engine', function () {
		let season5;

		before(function () {
			season5 = runHarness({ mods: ['season5'] });
		});

		it('loads every Season 5 mechanic the dojo supports', function () {
			assertChecks(season5, SEASON5_CHECKS);
		});

		it('puts the Season 5 API inside the bot\'s own VM', function () {
			// The processor seeing Thorium is not the same as the player seeing it:
			// custom prototypes cross into the isolate as source strings, which is
			// the part a prebuilt runtime bundle could have broken.
			const report = season5.botReport;
			assert.ok(report, 'the bot never reported from inside its VM');
			assert.strictEqual(report.thorium, 'T');
			assert.strictEqual(report.thoriumInResourcesAll, true);
			assert.strictEqual(report.findReactors, 10051);
			assert.strictEqual(report.lookReactors, 'reactor');
			assert.strictEqual(report.reactorType, 'Reactor');
			assert.strictEqual(report.reactorsFound, 1);
			assert.strictEqual(report.hasClaimReactor, true);
			// The claim happens later in the run, once the harness sets Memory.claim.
			assert.strictEqual(season5.notes.claimReport.claimResult, 0, 'claimReactor should return OK');
			assert.strictEqual(season5.notes.claimReport.reactorMine, true);
		});
	});

	describe('stock multiprocess engine', function () {
		it('loads the mod in the runner and processor processes too', function () {
			// The mods.json has to reach every engine role. In this mode the runner
			// and processor are separate child processes with their own MODFILE.
			const run = runHarness({ mods: ['season5'] }, {
				DOJO_FAST_MOCK_ENGINE: '0',
				DOJO_MOCK_ENGINE_PROCESS_ISOLATED: '1'
			});
			assertChecks(run, SEASON5_CHECKS);
		});
	});

	describe('isolation', function () {
		it('leaves no trace in a vanilla run before or after it', function () {
			const before = runHarness({});
			assertChecks(before, VANILLA_CHECKS);

			const modded = runHarness({ mods: ['season5'] });
			assertChecks(modded, ['probe', 'constantsInSandbox', 'claimedReactorScores']);

			const after = runHarness({});
			assertChecks(after, VANILLA_CHECKS);
			// Same verdicts before and after: no constants, no prototypes, no
			// listeners left behind by the modded run in between.
			for (const name of VANILLA_CHECKS) {
				assert.deepStrictEqual(after.checks[name].ok, before.checks[name].ok, name);
			}
		});
	});

	describe('a mod that does not load', function () {
		it('fails the run with a message naming the check and the package', function () {
			// @screeps/common catches and logs mod load errors, so a mod that threw
			// on the way in looks exactly like a healthy one. Only the probe knows.
			const run = runHarness({ mods: ['season5'], sabotage: true });
			assert.strictEqual(run.checks.probe.ok, false);
			const message = run.checks.probe.detail;
			assert.match(message, /did not load correctly/);
			assert.match(message, /failed check: RESOURCE_THORIUM/);
			assert.match(message, /@screeps\/mod-season5@1\.0\.3/);
			assert.match(message, /mod file: /);
		});
	});
});

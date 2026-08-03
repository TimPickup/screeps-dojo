'use strict';

const assert = require('assert');
const {
	SUITES,
	parseArgs,
	buildMochaArgs,
	buildDockerArgs
} = require('../../scripts/test');

describe('test launcher', function () {
	it('defines internal tests without the user scenario suite', function () {
		assert.deepStrictEqual(SUITES.internal, [
			'test/unit/**/*.test.js',
			'test/import/**/*.test.js',
			'test/integration/**/*.test.js'
		]);
		assert.ok(!SUITES.internal.includes('test/scenarios.test.js'));
	});

	it('defaults to every test', function () {
		const options = parseArgs([]);
		assert.deepStrictEqual(options, { suite: 'all', record: false, filter: undefined });
		assert.deepStrictEqual(buildMochaArgs(options), [
			'mocha', 'test/**/*.test.js', '--timeout', '7200000', '--exit'
		]);
	});

	it('selects a suite while preserving name filters and recording', function () {
		const options = parseArgs(['--suite', 'scenarios', 'walk-to-flag', 'record']);
		assert.deepStrictEqual(options, {
			suite: 'scenarios', record: true, filter: 'walk-to-flag'
		});
		assert.deepStrictEqual(buildMochaArgs(options), [
			'mocha', 'test/scenarios.test.js', '--timeout', '7200000', '--exit',
			'--grep', 'walk-to-flag'
		]);
		assert.deepStrictEqual(buildDockerArgs(options), [
			'compose', 'run', '--rm', '-e', 'DOJO_RECORD=1', 'dojo', 'npx'
		]);
	});

	it('accepts the equals form of suite selection', function () {
		assert.strictEqual(parseArgs(['--suite=integration']).suite, 'integration');
	});

	it('rejects missing and unknown suite names', function () {
		assert.throws(function () { parseArgs(['--suite']); }, /requires a value/);
		assert.throws(function () { parseArgs(['--suite', 'slow']); }, /unknown test suite/);
	});
});

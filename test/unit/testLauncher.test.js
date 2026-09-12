'use strict';

const assert = require('assert');
const {
	SUITES,
	parseArgs,
	buildMochaArgs,
	buildDockerArgs,
	buildLocalEnv
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

	it('defaults to every test, in Docker', function () {
		const options = parseArgs([]);
		assert.deepStrictEqual(options, {
			suite: 'all', record: false, local: false, filter: undefined
		});
		assert.deepStrictEqual(buildMochaArgs(options), [
			'mocha', 'test/**/*.test.js', '--timeout', '7200000', '--exit'
		]);
	});

	it('selects a suite while preserving name filters and recording', function () {
		const options = parseArgs(['--suite', 'scenarios', 'walk-to-flag', 'record']);
		assert.deepStrictEqual(options, {
			suite: 'scenarios', record: true, local: false, filter: 'walk-to-flag'
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

	// CI has no Docker daemon and installs node_modules on the runner itself.
	it('takes the Docker-free path from either spelling, and not by accident', function () {
		assert.strictEqual(parseArgs(['--local']).local, true);
		assert.strictEqual(parseArgs(['local']).local, true);
		assert.strictEqual(parseArgs([]).local, false);
	});

	// A scenario is a PATH under scenarios/ now, and the mocha title is that
	// path in posix form — so every spelling of it people actually type has to
	// land on the same --grep.
	it('accepts a scenario path however it was typed', function () {
		assert.strictEqual(parseArgs(['Benches/defence-bench']).filter, 'Benches/defence-bench');
		assert.strictEqual(parseArgs(['Benches\\defence-bench']).filter, 'Benches/defence-bench',
			'the Windows separator');
		assert.strictEqual(parseArgs(['scenarios\\Benches\\rampart\\']).filter, 'Benches/rampart',
			'a tab-completed path: prefix and trailing separator');
		assert.strictEqual(parseArgs(['scenarios/Benches/x']).filter, 'Benches/x');
		assert.strictEqual(parseArgs(['./scout-flee/']).filter, 'scout-flee');
	});

	// --grep is a regex and filtering with one is worth keeping, so nothing
	// but the separators and the prefix is touched.
	it('leaves a plain name and other regex characters alone', function () {
		assert.strictEqual(parseArgs(['scout-flee']).filter, 'scout-flee');
		assert.strictEqual(parseArgs(['season5-.*']).filter, 'season5-.*');
	});

	it('does not mistake the local keyword for a name filter', function () {
		assert.strictEqual(parseArgs(['local']).filter, undefined);
		assert.strictEqual(parseArgs(['local', 'walk-to-flag']).filter, 'walk-to-flag');
	});

	it('runs the same mocha invocation locally as in the container', function () {
		const local = parseArgs(['--suite', 'internal', '--local']);
		const docker = parseArgs(['--suite', 'internal']);
		assert.deepStrictEqual(buildMochaArgs(local), buildMochaArgs(docker));
	});

	// Docker gets DOJO_RECORD via `-e`; locally it has to go on the child env.
	it('passes recording through the environment on the local path', function () {
		const base = { PATH: '/usr/bin' };
		assert.deepStrictEqual(buildLocalEnv(parseArgs(['--local']), base), base);
		assert.deepStrictEqual(buildLocalEnv(parseArgs(['--local', 'record']), base), {
			PATH: '/usr/bin', DOJO_RECORD: '1'
		});
		assert.strictEqual(base.DOJO_RECORD, undefined, 'must not mutate the source env');
	});
});

'use strict';

// Host-side test launcher. Invokes mocha inside the container directly (npx)
// so test-name filters never pass through npm, which swallows flags like
// --grep on their way through `npm run` (seen on npm 10/11).
//
// Usage:
//   npm test                              -> run everything
//   npm run test:internal                 -> run all tests except user scenarios
//   npm run test:integration              -> run only integration tests
//   npm run test:scenarios -- scout-flee  -> run one matching scenario
//   npm test -- scout-flee record         -> same, with replay recording enabled
//
// "record" is a bare keyword (not --record) on purpose: PowerShell strips the
// bare -- token from `npm test -- ...`, after which npm swallows --flags as
// its own config. Bare words survive both. --record also works from shells
// that pass it through (cmd, bash).
const { spawnSync } = require('child_process');

const SUITES = Object.freeze({
	all: ['test/**/*.test.js'],
	internal: [
		'test/unit/**/*.test.js',
		'test/import/**/*.test.js',
		'test/integration/**/*.test.js'
	],
	unit: ['test/unit/**/*.test.js'],
	integration: ['test/integration/**/*.test.js'],
	scenarios: ['test/scenarios.test.js']
});

function parseArgs(args) {
	let suite = 'all';
	let record = false;
	let filter;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === '--suite') {
			if (!args[i + 1]) throw new Error('--suite requires a value');
			suite = args[i + 1];
			i += 1;
		} else if (arg.startsWith('--suite=')) {
			suite = arg.slice('--suite='.length);
		} else if (arg === '--record' || arg === 'record') {
			record = true;
		} else if (!arg.startsWith('--') && filter === undefined) {
			filter = arg;
		}
	}

	if (!Object.hasOwn(SUITES, suite)) {
		throw new Error('unknown test suite "' + suite + '" (expected: '
			+ Object.keys(SUITES).join(', ') + ')');
	}

	return { suite: suite, record: record, filter: filter };
}

function buildMochaArgs(options) {
	const mochaArgs = ['mocha'].concat(SUITES[options.suite], ['--timeout', '7200000', '--exit']);
	if (options.filter) mochaArgs.push('--grep', options.filter);
	return mochaArgs;
}

function buildDockerArgs(options) {
	const dockerArgs = ['compose', 'run', '--rm'];
	if (options.record) dockerArgs.push('-e', 'DOJO_RECORD=1');
	dockerArgs.push('dojo', 'npx');
	return dockerArgs;
}

function main(args) {
	let options;
	try {
		options = parseArgs(args);
	} catch (err) {
		console.error('[dojo] ' + err.message);
		return 2;
	}

	if (options.record) {
		console.log('[dojo] recording enabled -> recordings/<scenario>/<timestamp>/');
	}

	const result = spawnSync(
		'docker',
		buildDockerArgs(options).concat(buildMochaArgs(options)),
		{ stdio: 'inherit', shell: process.platform === 'win32' }
	);
	return result.status === null ? 1 : result.status;
}

module.exports = {
	SUITES: SUITES,
	parseArgs: parseArgs,
	buildMochaArgs: buildMochaArgs,
	buildDockerArgs: buildDockerArgs
};

if (require.main === module) {
	const status = main(process.argv.slice(2));
	// after the run, so a pending update is the last thing on screen
	require('../src/updateCheck').printNotice().then(function () { process.exit(status); });
}

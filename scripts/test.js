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
//   npm run test:internal -- local        -> run mocha here, without Docker
//
// "record" and "local" are bare keywords (not --record/--local) on purpose:
// PowerShell strips the bare -- token from `npm test -- ...`, after which npm
// swallows --flags as its own config. Bare words survive both. --record and
// --local also work from shells that pass them through (cmd, bash).
//
// "local" exists for CI, where there is no Docker daemon and node_modules is
// installed on the runner itself. It deliberately reuses SUITES, so the suite
// definitions have exactly one home and a new test directory is picked up by
// both paths at once.
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
	let local = false;
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
		} else if (arg === '--local' || arg === 'local') {
			local = true;
		} else if (!arg.startsWith('--') && filter === undefined) {
			filter = arg;
		}
	}

	if (!Object.hasOwn(SUITES, suite)) {
		throw new Error('unknown test suite "' + suite + '" (expected: '
			+ Object.keys(SUITES).join(', ') + ')');
	}

	return { suite: suite, record: record, local: local, filter: filter };
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

// The container passes DOJO_RECORD with `-e`; running here we have to put it on
// the child's own environment instead. process.env is left untouched.
function buildLocalEnv(options, env) {
	if (!options.record) return env;
	return Object.assign({}, env, { DOJO_RECORD: '1' });
}

// mocha's own entry point, spawned with process.execPath. Going through the bin
// directly rather than `npx` keeps a test run off the network and sidesteps any
// shell re-expansion of the glob arguments — mocha must expand those itself.
function localMochaBin() {
	return require.resolve('mocha/bin/mocha.js');
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

	// buildMochaArgs() leads with the literal 'mocha', which is the argument
	// `npx` needs on the container path. Spawning the bin directly, drop it.
	const result = options.local
		? spawnSync(
			process.execPath,
			[localMochaBin()].concat(buildMochaArgs(options).slice(1)),
			{ stdio: 'inherit', env: buildLocalEnv(options, process.env) }
		)
		: spawnSync(
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
	buildDockerArgs: buildDockerArgs,
	buildLocalEnv: buildLocalEnv
};

if (require.main === module) {
	const status = main(process.argv.slice(2));
	// after the run, so a pending update is the last thing on screen
	require('../src/updateCheck').printNotice().then(function () { process.exit(status); });
}

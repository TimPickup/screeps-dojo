'use strict';

// Host-side test launcher. Invokes mocha inside the container directly (npx)
// so test-name filters never pass through npm, which swallows flags like
// --grep on their way through `npm run` (seen on npm 10/11).
//
// Usage:
//   npm test                       -> run everything
//   npm test -- scout-flee        -> only tests whose names match "scout-flee"
//   npm test -- scout-flee record -> same, with replay recording enabled
//
// "record" is a bare keyword (not --record) on purpose: PowerShell strips the
// bare -- token from `npm test -- ...`, after which npm swallows --flags as
// its own config. Bare words survive both. --record also works from shells
// that pass it through (cmd, bash).
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const record = args.indexOf('--record') !== -1 || args.indexOf('record') !== -1;
const filter = args.find(function (arg) {
	return !arg.startsWith('--') && arg !== 'record';
});

const mochaArgs = ['mocha', 'test/**/*.test.js', '--timeout', '7200000', '--exit'];
if (filter) {
	mochaArgs.push('--grep', filter);
}

const dockerArgs = ['compose', 'run', '--rm'];
if (record) {
	dockerArgs.push('-e', 'DOJO_RECORD=1');
	console.log('[dojo] recording enabled -> recordings/<scenario>/<timestamp>/');
}
dockerArgs.push('dojo', 'npx');

const result = spawnSync(
	'docker',
	dockerArgs.concat(mochaArgs),
	{ stdio: 'inherit', shell: process.platform === 'win32' }
);
process.exit(result.status === null ? 1 : result.status);

'use strict';

// Host-side render launcher: npm run render -- recordings/scout-flee/<ts> [options]
// Paths are repo-relative (they resolve inside the container at /dojo).
//
// Options may be written as bare keywords (gif, fps 30, subframes 4,
// pixels 300, rooms W0N0,W1N0, out file.mp4) because PowerShell strips the
// bare -- token from `npm run render -- ...`, after which npm swallows
// --flags as its own config. --flag forms also work from shells that pass
// them through (cmd, bash); both are normalized to --flags for renderCli.
const { spawnSync } = require('child_process');

const OPTION_WORDS = ['gif', 'fps', 'pixels', 'rooms', 'out'];

const args = process.argv.slice(2).map(function (arg) {
	return OPTION_WORDS.indexOf(arg) !== -1 ? '--' + arg : arg;
});
if (args.length === 0) {
	console.error('usage: npm run render -- <recordings/...path> [gif] [fps N] [pixels N] [rooms A,B] [out file]');
	process.exit(2);
}

const result = spawnSync(
	'docker',
	['compose', 'run', '--rm', 'dojo', 'node', 'src/render/renderCli.js'].concat(args),
	{ stdio: 'inherit', shell: process.platform === 'win32' }
);
process.exit(result.status === null ? 1 : result.status);

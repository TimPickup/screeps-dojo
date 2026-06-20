'use strict';

// In-container CLI: node src/render/renderCli.js <recordingDirOrJson> [--gif]
//   [--fps 30] [--pixels 600] [--rooms W0N0,W1N0] [--out file]
// Tick cadence is fixed at 0.8s animation + 0.2s hold per tick.
const path = require('path');
const { loadRecording } = require('../recording');
const { renderRecording } = require('./videoRenderer');

function parseArgs(argv) {
	const options = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--gif') options.gif = true;
		else if (arg === '--fps') options.fps = Number(argv[++i]);
		else if (arg === '--pixels') options.pixelsPerRoom = Number(argv[++i]);
		else if (arg === '--rooms') options.rooms = argv[++i].split(',');
		else if (arg === '--out') options.out = argv[++i];
		else options._.push(arg);
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const target = options._[0];
	if (!target) {
		console.error('usage: renderCli <recordingDir> [--gif] [--fps N] [--pixels N] [--rooms A,B] [--out file]');
		process.exit(2);
	}
	const recording = loadRecording(target);
	const sourceDir = target.endsWith('.json') ? path.dirname(target) : target;
	const extension = options.gif ? '.gif' : '.mp4';
	const outFile = options.out || path.join(sourceDir, recording.meta.scenario + extension);
	console.log('rendering ' + recording.frames.length + ' frames -> ' + outFile);
	await renderRecording(recording, outFile, options);
	console.log('RENDER OK: ' + outFile);
}

main().catch(function (error) {
	console.error('RENDER FAILED:', error);
	process.exit(1);
});

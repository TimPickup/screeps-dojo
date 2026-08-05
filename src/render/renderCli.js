'use strict';

// In-container CLI: node src/render/renderCli.js <recordingDirOrJson> [--gif]
//   [--fps 30] [--speed 2] [--pixels 600] [--rooms W0N0,W1N0] [--out file]
// Speed has the same meaning as browser replay speed: 1x = one tick/second.
const path = require('path');
const { loadRecording } = require('../recording');
const { renderRecording } = require('./videoRenderer');
const { formatProgress } = require('./progressProtocol');

function parseArgs(argv) {
	const options = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--gif') options.gif = true;
		else if (arg === '--fps') options.fps = Number(argv[++i]);
		else if (arg === '--speed') options.speed = Number(argv[++i]);
		else if (arg === '--pixels') options.pixelsPerRoom = Number(argv[++i]);
		else if (arg === '--rooms') options.rooms = argv[++i].split(',');
		else if (arg === '--out') options.out = argv[++i];
		else options._.push(arg);
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const abortController = new AbortController();
	const cancel = function () { abortController.abort(); };
	process.once('SIGTERM', cancel);
	process.once('SIGINT', cancel);
	options.signal = abortController.signal;
	const target = options._[0];
	if (!target) {
		console.error('usage: renderCli <recordingDir> [--gif] [--fps N] [--speed N] [--pixels N] [--rooms A,B] [--out file]');
		process.exit(2);
	}
	const recording = loadRecording(target);
	const sourceDir = target.endsWith('.json') ? path.dirname(target) : target;
	const extension = options.gif ? '.gif' : '.mp4';
	const outFile = options.out || path.join(sourceDir, recording.meta.scenario + extension);
	console.log('rendering ' + recording.frames.length + ' recorded ticks -> ' + outFile);
	options.onProgress = function (progress) { console.log(formatProgress(progress)); };
	try {
		await renderRecording(recording, outFile, options);
		console.log('RENDER OK: ' + outFile);
	} finally {
		process.removeListener('SIGTERM', cancel);
		process.removeListener('SIGINT', cancel);
	}
}

main().catch(function (error) {
	console.error(error && error.code === 'RENDER_CANCELLED' ? 'RENDER CANCELLED' : 'RENDER FAILED:', error);
	process.exit(1);
});

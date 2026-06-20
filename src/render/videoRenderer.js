'use strict';

// Recording -> MP4/GIF (spec §8). Tick cadence: each tick plays as
// animateSeconds of interpolated motion followed by pauseSeconds holding the
// arrived state, so tick boundaries stay readable. Frames are rasterized by
// resvg and piped as PNGs into ffmpeg.
const { spawn } = require('child_process');
const { Resvg } = require('@resvg/resvg-js');
const ffmpegPath = require('ffmpeg-static');
const { renderFrameSvg } = require('./frameRenderer');

const FONT_OPTIONS = {
	fontFiles: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
	loadSystemFonts: false,
	defaultFontFamily: 'DejaVu Sans'
};

function rasterize(svg) {
	return new Resvg(svg, { font: FONT_OPTIONS }).render().asPng();
}

function renderRecording(recording, outFile, options) {
	const settings = Object.assign(
		{ fps: 30, animateSeconds: 0.8, pauseSeconds: 0.2, pixelsPerRoom: 600, gif: false },
		options || {});
	const animateFrames = Math.max(1, Math.round(settings.fps * settings.animateSeconds));
	const pauseFrames = Math.max(0, Math.round(settings.fps * settings.pauseSeconds));
	return new Promise(function (resolve, reject) {
		const outputArgs = settings.gif
			? ['-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse', outFile]
			: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', outFile];
		const ffmpeg = spawn(ffmpegPath, [
			'-y', '-f', 'image2pipe', '-framerate', String(settings.fps), '-i', '-'
		].concat(outputArgs), { stdio: ['pipe', 'ignore', 'pipe'] });

		let stderrTail = '';
		ffmpeg.stderr.on('data', function (chunk) {
			stderrTail = (stderrTail + chunk.toString()).slice(-4000);
		});
		ffmpeg.on('error', reject);
		ffmpeg.on('close', function (code) {
			if (code === 0) resolve(outFile);
			else reject(new Error('ffmpeg exited ' + code + ':\n' + stderrTail));
		});

		(async function pump() {
			async function writeFrame(png) {
				if (!ffmpeg.stdin.write(png)) {
					await new Promise(function (drained) { ffmpeg.stdin.once('drain', drained); });
				}
			}
			try {
				const lastIndex = recording.frames.length - 1;
				for (let frameIndex = 0; frameIndex < lastIndex; frameIndex++) {
					for (let sub = 0; sub < animateFrames; sub++) {
						await writeFrame(rasterize(renderFrameSvg(recording, frameIndex, sub / animateFrames, settings)));
					}
					if (pauseFrames > 0) {
						// hold the arrived state; rasterize once, repeat the buffer
						const hold = rasterize(renderFrameSvg(recording, frameIndex, 1, settings));
						for (let i = 0; i < pauseFrames; i++) await writeFrame(hold);
					}
				}
				// final still frame, held for one full pause so the ending reads
				const finalFrame = rasterize(renderFrameSvg(recording, lastIndex, 0, settings));
				for (let i = 0; i < pauseFrames + 1; i++) await writeFrame(finalFrame);
				ffmpeg.stdin.end();
			} catch (error) {
				ffmpeg.kill();
				reject(error);
			}
		})();
	});
}

module.exports = { renderRecording: renderRecording };

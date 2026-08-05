'use strict';

// Recording -> MP4/GIF. Browser playback and server export both execute the
// same Canvas2D drawing modules; this file only owns deterministic frame
// scheduling and the raw-RGBA FFmpeg pipe.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const ffmpegPath = require('ffmpeg-static');

const FONT_FILES = [
	'/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
	'/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
];
let sharedRendererPromise = null;
let fontsRegistered = false;

function loadSharedRenderer() {
	if (!sharedRendererPromise) {
		sharedRendererPromise = Promise.all([
			import('../../ui/src/canvas/drawFrame.ts'),
			import('../../ui/src/canvas/caches.ts'),
			import('../../ui/src/canvas/creeps.ts'),
			import('../../ui/src/render/geometry.ts'),
			import('../../ui/src/canvas/renderFont.ts')
		]).then(function (modules) {
			return {
				drawFrame: modules[0].drawFrame,
				StaticLayers: modules[1].StaticLayers,
				CreepRenderer: modules[2].CreepRenderer,
				computeStageLayout: modules[3].computeStageLayout,
				renderFontFamily: modules[4].RENDER_FONT_FAMILY
			};
		});
	}
	return sharedRendererPromise;
}

function partialPath(outFile) {
	const parsed = path.parse(outFile);
	return path.join(parsed.dir, '.' + parsed.name + '.partial-' + process.pid + parsed.ext);
}

function removePartial(file) {
	try { fs.rmSync(file, { force: true }); } catch (error) { /* best-effort cleanup */ }
}

function removeWorkDir(dir) {
	if (!dir) return;
	try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best-effort cleanup */ }
}

function cancelledError() {
	const error = new Error('render cancelled');
	error.code = 'RENDER_CANCELLED';
	return error;
}

function throwIfCancelled(signal) {
	if (signal && signal.aborted) throw cancelledError();
}

function attachCancellation(child, signal) {
	if (!signal) return function () {};
	const abort = function () {
		try { child.stdin.destroy(cancelledError()); } catch (error) { /* already closed */ }
		if (!child.killed) child.kill('SIGTERM');
	};
	signal.addEventListener('abort', abort, { once: true });
	if (signal.aborted) abort();
	return function () { signal.removeEventListener('abort', abort); };
}

async function writeRaw(child, raw, signal) {
	throwIfCancelled(signal);
	if (!child.stdin.write(raw)) await once(child.stdin, 'drain');
	throwIfCancelled(signal);
}

function validateSettings(recording, settings) {
	if (!recording || !Array.isArray(recording.frames) || recording.frames.length === 0) {
		throw new Error('recording has no frames');
	}
	if (!Number.isFinite(settings.fps) || settings.fps <= 0) {
		throw new Error('fps must be a positive number');
	}
	if (!Number.isInteger(settings.pixelsPerRoom) || settings.pixelsPerRoom <= 0) {
		throw new Error('pixelsPerRoom must be a positive integer');
	}
	if (!Number.isFinite(settings.speed) || settings.speed <= 0) {
		throw new Error('speed must be a positive number');
	}
}

function registerFonts(family) {
	if (fontsRegistered) return;
	for (const file of FONT_FILES) {
		const key = GlobalFonts.registerFromPath(file, family);
		if (!key) throw new Error('failed to register render font: ' + file);
	}
	fontsRegistered = true;
}

async function renderRecording(recording, outFile, options) {
	options = options || {};
	const settings = Object.assign(
		{
			// GIF needs far fewer frames than H.264 to look smooth, and its encoder
			// is substantially more expensive.
			fps: options.gif ? 10 : 30,
			// Same meaning as replay speed: one recorded tick per second at 1x.
			speed: 1,
			pixelsPerRoom: 600,
			gif: false,
			gifDither: 'bayer:bayer_scale=3'
		},
		options);
	validateSettings(recording, settings);
	throwIfCancelled(settings.signal);
	const shared = await loadSharedRenderer();
	registerFonts(shared.renderFontFamily);
	const availableRooms = Object.keys(recording.terrain || {});
	const rooms = Array.isArray(settings.rooms) && settings.rooms.length
		? settings.rooms.filter(function (room) { return availableRooms.indexOf(room) !== -1; })
		: availableRooms;
	if (rooms.length === 0) throw new Error('recording has no renderable rooms');

	const layout = shared.computeStageLayout(rooms, settings.pixelsPerRoom);
	const width = layout.width;
	const height = layout.height;
	if (!settings.gif && (width % 2 !== 0 || height % 2 !== 0)) {
		throw new Error('MP4 dimensions must be even for yuv420p (got ' + width + 'x' + height + ')');
	}

	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	const layerResolution = settings.pixelsPerRoom / 50;
	const layers = new shared.StaticLayers(recording, layout, layerResolution, createCanvas);
	const sprites = new shared.CreepRenderer();
	const expectedBytes = width * height * 4;
	const lastIndex = recording.frames.length - 1;
	// Drive the simulation playhead from output-frame number. This keeps speed
	// deterministic, and permits speeds above the output FPS by intentionally
	// skipping recorded ticks just as a fast browser replay does.
	const totalFrames = Math.max(1, Math.ceil(lastIndex * settings.fps / settings.speed) + 1);
	let completedFrames = 0;
	let lastReportedPercent = -1;
	function reportProgress(phase, force, extra) {
		if (typeof settings.onProgress !== 'function') return;
		const percent = totalFrames > 0 ? Math.floor(completedFrames * 100 / totalFrames) : 100;
		if (!force && percent === lastReportedPercent) return;
		lastReportedPercent = percent;
		settings.onProgress(Object.assign({
			phase: phase,
			completedFrames: completedFrames,
			totalFrames: totalFrames,
			percent: percent
		}, extra || {}));
	}
	const pendingFile = partialPath(outFile);
	const workDir = settings.gif ? fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-render-' + process.pid + '-')) : null;
	removePartial(pendingFile);
	reportProgress('preparing', true);
	let ffmpeg = null;
	let output = null;
	let detachCancellation = function () {};

	function renderFrame(frameIndex, sub) {
		ctx.reset();
		ctx.fillStyle = '#0e0e0e';
		ctx.fillRect(0, 0, width, height);
		ctx.setTransform(layerResolution, 0, 0, layerResolution, 0, 0);
		shared.drawFrame(ctx, recording, frameIndex, sub, {
			sprites: sprites,
			layers: layers,
			layout: layout,
			showVisuals: true
		});
		const raw = canvas.data();
		if (raw.length !== expectedBytes) {
			throw new Error('invalid raw frame length: expected ' + expectedBytes + ', got ' + raw.length);
		}
		return raw;
	}

	async function writeFrame(raw) {
		await writeRaw(ffmpeg, raw, settings.signal);
		completedFrames++;
		reportProgress('rendering', false);
	}

	try {
		let paletteFile = null;
		if (settings.gif) {
			paletteFile = path.join(workDir, 'palette.png');
			const sampleCount = Math.min(64, recording.frames.length);
			const palette = spawn(ffmpegPath, [
				'-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', width + 'x' + height,
				'-framerate', '1', '-i', 'pipe:0', '-vf', 'palettegen=stats_mode=diff',
				'-frames:v', '1', '-update', '1', paletteFile
			], { stdio: ['pipe', 'ignore', 'pipe'] });
			ffmpeg = palette;
			detachCancellation = attachCancellation(palette, settings.signal);
			let paletteError = '';
			palette.stdin.on('error', function () { /* close status carries the failure */ });
			palette.stderr.on('data', function (chunk) { paletteError = (paletteError + chunk.toString()).slice(-8000); });
			const paletteClose = once(palette, 'close');
			for (let sample = 0; sample < sampleCount; sample++) {
				const frameIndex = sampleCount === 1 ? 0 : Math.round(sample * lastIndex / (sampleCount - 1));
				layers.sync(recording.frames[frameIndex]);
				await writeRaw(palette, renderFrame(frameIndex, null), settings.signal);
				reportProgress('palette', true, { paletteFrames: sample + 1, paletteTotalFrames: sampleCount });
			}
			palette.stdin.end();
			const paletteResult = await paletteClose;
			detachCancellation();
			detachCancellation = function () {};
			if (paletteResult[0] !== 0) {
				throw new Error('ffmpeg palette generation exited ' + paletteResult[0] + ':\n' + paletteError);
			}
			throwIfCancelled(settings.signal);
			lastReportedPercent = -1;
		}

		const outputArgs = settings.gif
			? [
				'-i', paletteFile,
				'-lavfi', 'paletteuse=dither=' + settings.gifDither, '-f', 'gif', 'pipe:1'
			]
			: [
				'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
				'-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'
			];
		ffmpeg = spawn(ffmpegPath, [
			'-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', width + 'x' + height,
			'-framerate', String(settings.fps), '-i', 'pipe:0'
		].concat(outputArgs), { stdio: ['pipe', 'pipe', 'pipe'] });
		detachCancellation = attachCancellation(ffmpeg, settings.signal);
		let stderrTail = '';
		ffmpeg.stdin.on('error', function () { /* close status carries the failure */ });
		ffmpeg.stderr.on('data', function (chunk) { stderrTail = (stderrTail + chunk.toString()).slice(-8000); });
		const closePromise = once(ffmpeg, 'close');
		output = fs.createWriteStream(pendingFile, { flags: 'w' });
		ffmpeg.stdout.pipe(output);
		const outputPromise = once(output, 'finish');

		let syncedFrame = -1;
		for (let outputFrame = 0; outputFrame < totalFrames; outputFrame++) {
			const playhead = Math.min(lastIndex, outputFrame * settings.speed / settings.fps);
			const frameIndex = Math.min(lastIndex, Math.floor(playhead));
			if (frameIndex !== syncedFrame) {
				layers.sync(recording.frames[frameIndex]);
				syncedFrame = frameIndex;
			}
			const sub = frameIndex < lastIndex ? playhead - frameIndex : null;
			await writeFrame(renderFrame(frameIndex, sub));
		}
		ffmpeg.stdin.end();
		reportProgress('finalising', true);

		const results = await Promise.all([closePromise, outputPromise]);
		const result = results[0];
		const code = result[0];
		const signal = result[1];
		if (code !== 0) {
			throw new Error('ffmpeg exited ' + code + (signal ? ' (' + signal + ')' : '') + ':\n' + stderrTail);
		}
		detachCancellation();
		detachCancellation = function () {};
		reportProgress('saving', true);
		fs.renameSync(pendingFile, outFile);
		removeWorkDir(workDir);
		return outFile;
	} catch (error) {
		detachCancellation();
		if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGTERM');
		try { if (ffmpeg) ffmpeg.stdin.destroy(); } catch (destroyError) { /* already closed */ }
		try { if (output) output.destroy(); } catch (destroyError) { /* already closed */ }
		removePartial(pendingFile);
		removeWorkDir(workDir);
		if (settings.signal && settings.signal.aborted && error.code !== 'RENDER_CANCELLED') throw cancelledError();
		throw error;
	}
}

module.exports = { renderRecording: renderRecording };

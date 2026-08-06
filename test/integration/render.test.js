'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { renderRecording } = require('../../src/render/videoRenderer');
const renderManager = require('../../src/server/renderManager');

function makeTerrain() {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) row += (x === 0 || x === 49 || y === 0 || y === 49) ? '#' : '.';
		rows.push(row);
	}
	return rows;
}

function makeRecording(frameCount) {
	frameCount = frameCount || 4;
	const frames = [];
	for (let i = 0; i < frameCount; i++) {
		frames.push({ gameTime: i + 1, flags: [], eventLog: {}, objects: [
			{ _id: 'c1', type: 'creep', name: 'T', room: 'W0N0', x: 10 + i, y: 10,
				hits: 100, hitsMax: 100, user: 'user1' },
			{ _id: 's1', type: 'spawn', room: 'W0N0', x: 20, y: 20, user: 'user1' }
		] });
	}
	return {
		meta: { scenario: 'synthetic', botUserId: 'user1', ticks: frameCount - 1 },
		terrain: { W0N0: makeTerrain() },
		frames: frames
	};
}

describe('video renderer', function () {
	this.timeout(600000);

	it('renders a small synthetic recording to MP4', async function () {
		const recording = makeRecording();
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-render-'));
		const outFile = path.join(outDir, 'out.mp4');
		// At 1x, three recorded-tick transitions take three seconds.
		const progress = [];
		await renderRecording(recording, outFile, {
			pixelsPerRoom: 300,
			fps: 10,
			onProgress: function (event) { progress.push(event); }
		});
		assert.ok(fs.existsSync(outFile), 'mp4 exists');
		const size = fs.statSync(outFile).size;
		assert.ok(size > 1000, 'mp4 has content, got ' + size + ' bytes');

		const hashes = spawnSync(ffmpegPath,
			['-v', 'error', '-i', outFile, '-map', '0:v:0', '-f', 'framemd5', '-'],
			{ encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
		assert.strictEqual(hashes.status, 0, hashes.stderr);
		const encodedFrames = hashes.stdout.split(/\r?\n/).filter(function (line) {
			return line && line[0] !== '#';
		}).length;
		assert.strictEqual(encodedFrames, 31, '3 seconds at 10fps, including the final state');
		assert.strictEqual(progress[0].phase, 'preparing');
		assert.strictEqual(progress[0].percent, 0);
		assert.strictEqual(progress.find(function (event) { return event.phase === 'finalising'; }).percent, 100);
		assert.strictEqual(progress[progress.length - 1].phase, 'saving');
		assert.strictEqual(progress[progress.length - 1].completedFrames, 31);

		const decoded = spawnSync(ffmpegPath,
			['-v', 'error', '-i', outFile, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
			{ maxBuffer: 300 * 300 * 4 + 1024 });
		assert.strictEqual(decoded.status, 0, decoded.stderr && decoded.stderr.toString());
		assert.strictEqual(decoded.stdout.length, 300 * 300 * 4, 'decoded frame is 300x300 RGBA');
		assert.deepStrictEqual(fs.readdirSync(outDir).filter(function (name) { return name.indexOf('.partial-') !== -1; }), [],
			'success leaves no partial output');
	});

	it('streams structured frame progress through the render manager', async function () {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-render-progress-'));
		const recordingFile = path.join(outDir, 'recording.json');
		fs.writeFileSync(recordingFile, JSON.stringify(makeRecording()));
		const started = renderManager.startRender(recordingFile, 'mp4', { pixels: 300, fps: 10, speed: 4 });
		const events = [];
		await new Promise(function (resolve, reject) {
			const timer = setTimeout(function () { reject(new Error('render progress timeout')); }, 30000);
			renderManager.subscribe(started.id, function (event) {
				events.push(event);
				if (event.type === 'done') { clearTimeout(timer); resolve(); }
				if (event.type === 'failed') { clearTimeout(timer); reject(new Error(event.error)); }
			});
		});
		const progress = events.filter(function (event) { return event.type === 'progress'; });
		assert.ok(progress.length > 2, 'received incremental progress');
		assert.strictEqual(progress[0].phase, 'preparing');
		assert.strictEqual(progress[progress.length - 1].phase, 'saving');
		assert.strictEqual(progress[progress.length - 1].percent, 100);
		assert.strictEqual(progress[progress.length - 1].totalFrames, 9, 'manager passes the 4x speed through to the renderer');
	});

	it('renders GIF through a bounded-memory sampled palette', async function () {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-render-gif-'));
		const outFile = path.join(outDir, 'out.gif');
		const progress = [];
		await renderRecording(makeRecording(), outFile, {
			gif: true,
			pixelsPerRoom: 300,
			speed: 2,
			onProgress: function (event) { progress.push(event); }
		});
		assert.ok(fs.statSync(outFile).size > 1000, 'gif has content');
		assert.ok(progress.some(function (event) { return event.phase === 'palette'; }), 'palette sampling reported');
		const final = progress[progress.length - 1];
		assert.strictEqual(final.phase, 'saving');
		assert.strictEqual(final.totalFrames, 16, '2x means three transitions take 1.5 seconds at 10fps');
	});

	it('cancels a render and removes its partial output and palette workdir', async function () {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-render-cancel-'));
		const recordingFile = path.join(outDir, 'recording.json');
		fs.writeFileSync(recordingFile, JSON.stringify(makeRecording(120)));
		const beforeWorkDirs = fs.readdirSync(os.tmpdir()).filter(function (name) { return name.startsWith('dojo-render-'); }).sort();
		const started = renderManager.startRender(recordingFile, 'gif', { pixels: 300 });
		const events = [];
		let requested = false;
		await new Promise(function (resolve, reject) {
			const timer = setTimeout(function () { reject(new Error('render cancellation timeout')); }, 30000);
			renderManager.subscribe(started.id, function (event) {
				events.push(event);
				if (!requested && event.type === 'progress' && event.phase === 'palette') {
					requested = true;
					renderManager.cancelRender(started.id);
				}
				if (event.type === 'cancelled') { clearTimeout(timer); resolve(); }
				if (event.type === 'failed') { clearTimeout(timer); reject(new Error(event.error)); }
			});
		});
		assert.ok(events.some(function (event) { return event.type === 'cancelling'; }));
		assert.strictEqual(fs.existsSync(path.join(outDir, 'export.gif')), false);
		assert.deepStrictEqual(
			fs.readdirSync(outDir).filter(function (name) { return name.indexOf('.partial-') !== -1; }), [],
			'cancel leaves no partial output');
		assert.deepStrictEqual(
			fs.readdirSync(os.tmpdir()).filter(function (name) { return name.startsWith('dojo-render-'); }).sort(),
			beforeWorkDirs,
			'cancel leaves no palette workdir');
	});
});

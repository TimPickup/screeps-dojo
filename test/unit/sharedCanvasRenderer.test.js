'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');

const FONT_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf';

function makeTerrain() {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) row += (x === 0 || x === 49 || y === 0 || y === 49) ? '#' : '.';
		rows.push(row);
	}
	return rows;
}

function makeRecording() {
	return {
		meta: { scenario: 'shared-canvas', botUserId: 'user1', ticks: 2 },
		terrain: { W1N0: makeTerrain(), W0N0: makeTerrain() },
		frames: [
			{ gameTime: 1, flags: [], eventLog: {}, objects: [
				{ _id: 'c1', type: 'creep', name: 'T', room: 'W1N0', x: 49, y: 25,
					hits: 100, hitsMax: 100, user: 'user1', body: [{ type: 'move', hits: 100 }] },
				{ _id: 's1', type: 'spawn', room: 'W0N0', x: 20, y: 20, user: 'user1',
					store: { energy: 150 }, storeCapacityResource: { energy: 300 } }
			] },
			{ gameTime: 2, flags: [], eventLog: {}, objects: [
				{ _id: 'c1', type: 'creep', name: 'T', room: 'W0N0', x: 0, y: 25,
					hits: 50, hitsMax: 100, user: 'user1', body: [{ type: 'move', hits: 100 }],
					actionLog: { say: { message: 'hi' } } },
				{ _id: 's1', type: 'spawn', room: 'W0N0', x: 20, y: 20, user: 'user1',
					store: { energy: 150 }, storeCapacityResource: { energy: 300 } }
			] }
		]
	};
}

describe('shared Canvas2D renderer', function () {
	let drawFrame, StaticLayers, CreepRenderer, computeStageLayout, creepFacing, renderFont, terrainTexture;

	before(async function () {
		const modules = await Promise.all([
			import('../../ui/src/canvas/drawFrame.ts'),
			import('../../ui/src/canvas/caches.ts'),
			import('../../ui/src/canvas/creeps.ts'),
			import('../../ui/src/render/geometry.ts'),
			import('../../ui/src/canvas/renderFont.ts')
		]);
		drawFrame = modules[0].drawFrame;
		StaticLayers = modules[1].StaticLayers;
		CreepRenderer = modules[2].CreepRenderer;
		computeStageLayout = modules[3].computeStageLayout;
		creepFacing = modules[3].creepFacing;
		renderFont = modules[4];
		terrainTexture = await loadImage(path.resolve(__dirname, '../../ui/src/assets/textures/terrain-noise.png'));
		if (!GlobalFonts.families.some(function (entry) { return entry.family === renderFont.RENDER_FONT_FAMILY; })) {
			assert.ok(GlobalFonts.registerFromPath(FONT_REGULAR, renderFont.RENDER_FONT_FAMILY));
			assert.ok(GlobalFonts.registerFromPath(FONT_BOLD, renderFont.RENDER_FONT_FAMILY));
		}
	});

	it('places rooms by world coordinates and faces correctly across a seam', function () {
		const recording = makeRecording();
		const layout = computeStageLayout(['W0N0', 'W1N0'], 200);
		assert.deepStrictEqual(layout.offsets.W1N0, { col: 0, row: 0 });
		assert.deepStrictEqual(layout.offsets.W0N0, { col: 1, row: 0 });
		assert.strictEqual(layout.width, 400);
		assert.strictEqual(creepFacing(recording.frames, 0, 'c1', layout), 0);
	});

	it('renders deterministic, opaque RGBA frames with the same modules as replay', function () {
		const recording = makeRecording();
		const layout = computeStageLayout(Object.keys(recording.terrain), 200);
		const canvas = createCanvas(layout.width, layout.height);
		const ctx = canvas.getContext('2d');
		const scale = layout.pixelsPerRoom / 50;
		const layers = new StaticLayers(recording, layout, scale, createCanvas, terrainTexture);
		const sprites = new CreepRenderer();

		function render(sub) {
			ctx.reset();
			ctx.fillStyle = '#0e0e0e';
			ctx.fillRect(0, 0, layout.width, layout.height);
			ctx.setTransform(scale, 0, 0, scale, 0, 0);
			layers.sync(recording.frames[0]);
			drawFrame(ctx, recording, 0, sub, { sprites, layers, layout, showVisuals: true });
			const raw = canvas.data();
			assert.strictEqual(raw.length, layout.width * layout.height * 4);
			for (let i = 3; i < raw.length; i += 4) assert.strictEqual(raw[i], 255);
			return crypto.createHash('sha256').update(raw).digest('hex');
		}

		const start = render(0);
		assert.strictEqual(render(0), start, 'same frame inputs produce the same pixels');
		assert.notStrictEqual(render(0.75), start, 'sub-frame interpolation changes the pixels');
	});

	it('strokes a complete high-TOUGH shell in the native server canvas', function () {
		const canvas = createCanvas(160, 160);
		const ctx = canvas.getContext('2d');
		ctx.setTransform(100, 0, 0, 100, 0, 0);
		new CreepRenderer().draw(ctx, {
			_id: 'armoured', type: 'creep', room: 'W0N0', x: 0, y: 0, user: 'user1',
			my: true,
			body: Array.from({ length: 50 }, function () { return { type: 'tough', hits: 100 }; }),
			store: {}
		}, 0.3, 0.3, 0, 1);
		const raw = canvas.data();
		// Creep centre is (80,80); (80,30) lies in the thick outer TOUGH shell,
		// outside the ordinary body ring. This guards native full-circle strokes.
		const offset = (30 * 160 + 80) * 4;
		assert.ok(raw[offset] > 180 && raw[offset + 1] > 180 && raw[offset + 2] > 180);
		assert.strictEqual(raw[offset + 3], 255);
	});

	it('matches the measured browser font size and baseline under the room transform', function () {
		const canvas = createCanvas(600, 100);
		const ctx = canvas.getContext('2d');
		const text = 'RoomNormal - RCL7 (upgrade ETA ?)';
		const spec = renderFont.parseRenderFont(0.8);
		const largeFont = renderFont.canvasFont({ size: 64, weight: 400, style: 'normal' });
		ctx.font = largeFont;
		assert.strictEqual(ctx.font, largeFont, 'registered family is accepted without fallback');
		assert.notStrictEqual(ctx.font, '10px sans-serif');
		const metrics = ctx.measureText(text);
		assert.ok(Math.abs(metrics.width - 1271.53) < 0.02);
		assert.strictEqual(metrics.actualBoundingBoxAscent, 49);
		assert.strictEqual(metrics.actualBoundingBoxDescent, 13);

		ctx.reset();
		ctx.setTransform(12, 0, 0, 12, 0, 0);
		ctx.fillStyle = '#ffffff';
		renderFont.fillRenderText(ctx, text, 1.5, 1.5, spec, 'left');
		const raw = canvas.data();
		let left = 600, top = 100, right = -1, bottom = -1;
		for (let y = 0; y < 100; y++) {
			for (let x = 0; x < 600; x++) {
				if (raw[(y * 600 + x) * 4 + 3] === 0) continue;
				left = Math.min(left, x); top = Math.min(top, y);
				right = Math.max(right, x); bottom = Math.max(bottom, y);
			}
		}
		// Chrome with this exact font/transform measures top=10, bottom=19 and
		// right=207; Skia differs only by one antialiased edge pixel horizontally.
		assert.deepStrictEqual({ left: left, top: top, right: right, bottom: bottom },
			{ left: 18, top: 10, right: 206, bottom: 19 });
	});
});

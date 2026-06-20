'use strict';

const assert = require('assert');
const { renderFrameSvg, computeLayout } = require('../../src/render/frameRenderer');

function makeTerrain() {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) {
			row += (x === 0 || x === 49 || y === 0 || y === 49) ? '#' : '.';
		}
		rows.push(row);
	}
	return rows;
}

// Two-frame recording where the creep steps ONE tile east across the
// W1N0 -> W0N0 seam (W1N0 sits immediately WEST of W0N0 in the stitched layout).
function makeCrossRoomRecording(user) {
	return {
		meta: { scenario: 'cross-room', botUserId: 'user1', ticks: 2 },
		terrain: { W1N0: makeTerrain(), W0N0: makeTerrain() },
		frames: [
			{ gameTime: 1, objects: [
				{ _id: 'cx1', type: 'creep', name: 'X', room: 'W1N0', x: 49, y: 25, hits: 100, hitsMax: 100, user: user }
			], flags: [], eventLog: {} },
			{ gameTime: 2, objects: [
				{ _id: 'cx1', type: 'creep', name: 'X', room: 'W0N0', x: 0, y: 25, hits: 100, hitsMax: 100, user: user }
			], flags: [], eventLog: {} }
		]
	};
}

function makeRecording(overrides) {
	return Object.assign({
		meta: { scenario: 'test', botUserId: 'user1', ticks: 2 },
		terrain: { W0N0: makeTerrain() },
		frames: [
			{ gameTime: 1, objects: [
				{ _id: 'c1', type: 'creep', name: 'T', room: 'W0N0', x: 10, y: 10, hits: 100, hitsMax: 100, user: 'user1' }
			], flags: [], eventLog: {} },
			{ gameTime: 2, objects: [
				{ _id: 'c1', type: 'creep', name: 'T', room: 'W0N0', x: 11, y: 10, hits: 50, hitsMax: 100, user: 'user1',
					actionLog: { say: { message: 'ow', isPublic: true } } }
			], flags: [], eventLog: {} }
		]
	}, overrides || {});
}

describe('frameRenderer', function () {
	it('computeLayout places rooms by world coordinates', function () {
		const layout = computeLayout(['W0N0', 'W1N0']); // W1N0 is WEST of W0N0
		assert.deepStrictEqual(layout.offsets.W1N0, { col: 0, row: 0 });
		assert.deepStrictEqual(layout.offsets.W0N0, { col: 1, row: 0 });
		assert.strictEqual(layout.columns, 2);
		assert.strictEqual(layout.rows, 1);
	});

	it('renders a well-formed SVG with terrain and a creep', function () {
		const recording = makeRecording();
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.startsWith('<svg'), 'starts with <svg');
		assert.ok(svg.endsWith('</svg>'), 'ends with </svg>');
		assert.ok(svg.indexOf('<circle') !== -1, 'creep circle present');
	});

	it('interpolates creep position at subframe t=0.5', function () {
		const recording = makeRecording();
		const svgT0 = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 500 });
		const svgT05 = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 500 });
		assert.notStrictEqual(svgT0, svgT05, 'subframe interpolation changes output');
	});

	it('shows an HP bar when damaged and a say bubble', function () {
		const recording = makeRecording();
		const svg = renderFrameSvg(recording, 1, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('ow') !== -1, 'say text rendered');
	});

	it('fades out a creep that disappears', function () {
		const recording = makeRecording();
		recording.frames[1].objects = []; // creep died between frames
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('<circle') !== -1, 'fading creep still drawn mid-transition');
	});

	it('keeps base-frame HP and say during interpolation (no one-tick-early state)', function () {
		const recording = makeRecording();
		const svg = renderFrameSvg(recording, 0, 0.25, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('ow') === -1, 'say text must not appear before the transition completes');
	});

	it('renders NPC invaders with the invader sprite', function () {
		const recording = makeRecording();
		const invader = { _id: 'i1', type: 'creep', name: 'inv', room: 'W0N0', x: 20, y: 20,
			hits: 200, hitsMax: 200, user: '2' };
		recording.frames[0].objects.push(invader);
		recording.frames[1].objects.push(invader);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('dojo-invader') !== -1, 'invader sprite group present');
		assert.ok(svg.indexOf('#e51f36') !== -1, 'invader sprite fill present');
	});

	it('renders invaders with NUMERIC user ids with the sprite too (legacy recordings)', function () {
		const recording = makeRecording();
		const invader = { _id: 'i2', type: 'creep', name: 'inv2', room: 'W0N0', x: 22, y: 20,
			hits: 200, hitsMax: 200, user: 2 };
		recording.frames[0].objects.push(invader);
		recording.frames[1].objects.push(invader);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('dojo-invader') !== -1, 'numeric user 2 still gets the sprite');
	});

	it('renders player creeps as body-part rings over a tile grid', function () {
		const recording = makeRecording();
		recording.frames[0].objects[0].body = [
			{ type: 'move', hits: 100 }, { type: 'attack', hits: 100 }, { type: 'tough', hits: 100 }
		];
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('dojo-creep') !== -1, 'creep ring group present');
		assert.ok(svg.indexOf('#ff3b4f') !== -1, 'attack arc color present');
		assert.ok(svg.indexOf('#d7e0e5') !== -1, 'move arc color present');
		assert.ok(svg.indexOf('dojo-grid') !== -1, 'tile grid present');
	});

	it('renders source keeper (user 3) with the invader sprite', function () {
		const recording = makeRecording();
		const sk = { _id: 'sk1', type: 'creep', name: 'SK', room: 'W0N0', x: 25, y: 25,
			hits: 400, hitsMax: 400, user: '3' };
		recording.frames[0].objects.push(sk);
		recording.frames[1].objects.push(sk);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('dojo-invader') !== -1, 'source keeper gets the invader sprite group');
	});

	it('sprite facing: last frame (no next) uses last movement direction (down = rotate 90)', function () {
		// 3-frame recording: invader moves right (frame 0→1), then down (frame 1→2)
		// Render frame 2 (no next frame) — should use direction from frame 1→2 = down = 90°
		const recording = {
			meta: { scenario: 'facing-test', botUserId: 'user1', ticks: 3 },
			terrain: { W0N0: makeTerrain() },
			frames: [
				{ gameTime: 1, objects: [
					{ _id: 'inv1', type: 'creep', name: 'I', room: 'W0N0', x: 10, y: 10, hits: 200, hitsMax: 200, user: '2' }
				], flags: [], eventLog: {} },
				{ gameTime: 2, objects: [
					{ _id: 'inv1', type: 'creep', name: 'I', room: 'W0N0', x: 11, y: 10, hits: 200, hitsMax: 200, user: '2' }
				], flags: [], eventLog: {} },
				{ gameTime: 3, objects: [
					{ _id: 'inv1', type: 'creep', name: 'I', room: 'W0N0', x: 11, y: 11, hits: 200, hitsMax: 200, user: '2' }
				], flags: [], eventLog: {} }
			]
		};
		const svg = renderFrameSvg(recording, 2, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('dojo-invader') !== -1, 'invader sprite present');
		assert.ok(svg.indexOf('rotate(90') !== -1, 'sprite rotated 90 degrees for downward movement');
	});

	it('lerps cross-room transitions across the seam, not across the whole room', function () {
		// Base: W1N0 (49,25); next: W0N0 (0,25). One tile east across the seam.
		// In W1N0-local coordinates the destination is x=50 (0 + (1-0)*50).
		// At t=0.5: lerp(49, 50, 0.5) = 49.5; +0.5 tile centre => cx="50".
		// The OLD broken lerp 49->0 gave lerp(49, 0, 0.5) = 24.5; +0.5 => cx="25".
		const recording = makeCrossRoomRecording('user1');
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('cx="25"') === -1, 'creep must not teleport-lerp across the room interior');
		assert.ok(svg.indexOf('cx="50"') !== -1, 'creep walks across the seam (local x exceeds 49)');
	});

	it('creep that crosses into a room excluded from the layout fades out', function () {
		const recording = makeCrossRoomRecording('user1');
		// Render only the base room: W0N0 is not in the layout.
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200, rooms: ['W1N0'] });
		assert.ok(svg.indexOf('opacity="0.5"') !== -1, 'creep fades like a death when it leaves the rendered view');
	});

	it('faces across the seam: cross-room step east rotates 0, not 180', function () {
		const recording = makeCrossRoomRecording('2'); // invader sprite carries the rotate()
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('dojo-invader') !== -1, 'invader sprite present');
		assert.ok(svg.indexOf('rotate(0 ') !== -1, 'sprite faces right (0 deg) stepping east across the seam');
		assert.ok(svg.indexOf('rotate(180 ') === -1, 'sprite must not face left from the naive 49->0 delta');
	});

	it('draws exit arrows on walkable border tiles', function () {
		const terrain = makeTerrain().map(function (row, y) {
			if (y < 23 || y > 27) return row;
			return row.slice(0, 49) + '.'; // open the right border at y 23..27
		});
		const recording = makeRecording({ terrain: { W0N0: terrain } });
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		const group = /<g class="dojo-exit"[^>]*>([\s\S]*?)<\/g>/.exec(svg);
		assert.ok(group, 'dojo-exit group present');
		const chevrons = (group[1].match(/<path/g) || []).length;
		assert.strictEqual(chevrons, 5, 'one chevron per open border tile');
	});

	it('emits no exit arrows for fully-walled terrain', function () {
		const recording = makeRecording(); // makeTerrain() borders are all '#'
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		const group = /<g class="dojo-exit"[^>]*>([\s\S]*?)<\/g>/.exec(svg);
		assert.ok(!group || (group[1].match(/<path/g) || []).length === 0,
			'dojo-exit group absent or empty when no border tile is walkable');
	});

	// Two-frame recording with a STATIONARY creep; frame 1 carries the given actionLog.
	function makeActionRecording(actionLog, extraObjects) {
		const base = { _id: 'c1', type: 'creep', name: 'T', room: 'W0N0', x: 10, y: 10,
			hits: 100, hitsMax: 100, user: 'user1' };
		const next = Object.assign({}, base, { actionLog: actionLog || {} });
		return {
			meta: { scenario: 'fx', botUserId: 'user1', ticks: 2 },
			terrain: { W0N0: makeTerrain() },
			frames: [
				{ gameTime: 1, objects: [base].concat(extraObjects || []), flags: [], eventLog: {} },
				{ gameTime: 2, objects: [next].concat(extraObjects || []), flags: [], eventLog: {} }
			]
		};
	}

	it('draws a yellow upgrade beam for upgradeController', function () {
		const recording = makeActionRecording({ upgradeController: { x: 14, y: 10 } });
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		assert.ok(/<line[^>]*stroke="#ffe25a"/.test(svg), 'yellow upgrade beam line present');
	});

	it('self-heal (own coords) pulses green with no heal beam', function () {
		const recording = makeActionRecording({ heal: { x: 10, y: 10 } });
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		assert.ok(/<circle[^>]*stroke="#5cff6a"/.test(svg), 'green pulse circle present');
		const lines = svg.match(/<line[^>]*>/g) || [];
		assert.ok(!lines.some(function (line) { return line.indexOf('#65fd62') !== -1; }),
			'no green heal beam line for a self-heal');
	});

	it('still draws a heal beam for OTHER-target heals', function () {
		const recording = makeActionRecording({ heal: { x: 12, y: 10 } });
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		assert.ok(/<line[^>]*stroke="#65fd62"/.test(svg), 'green heal beam line present');
	});

	it('rangedMassAttack draws an expanding blue pulse (r=1.5 at t=0.5)', function () {
		const recording = makeActionRecording({ rangedMassAttack: {} });
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		assert.ok(/<circle[^>]*r="1\.5"[^>]*stroke="#5d80b2"/.test(svg), 'blue pulse circle r=1.5 present');
	});

	it('bobs the creep toward its harvest target (+0.15 tiles east at t=0.5)', function () {
		const recording = makeActionRecording({ harvest: { x: 11, y: 10 } });
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('cx="10.65"') !== -1, 'sprite centre shifted to 10 + 0.15 + 0.5 = 10.65');
	});

	it('renders sources as a black base with an energy-scaled yellow core', function () {
		const recording = makeActionRecording({}, [
			{ _id: 's1', type: 'source', room: 'W0N0', x: 20, y: 20, energy: 500, energyCapacity: 1000 }
		]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(/<circle[^>]*r="0\.35"[^>]*fill="#0a0a0a"/.test(svg), 'black base circle r=0.35 present');
		assert.ok(/<circle[^>]*r="0\.16"[^>]*fill="#FFE87B"/.test(svg), 'yellow core r=0.32*0.5=0.16 present');
	});

	it('renders an owned controller with level text, progress disc, and rim arc', function () {
		const recording = makeActionRecording({}, [
			{ _id: 'ctrl1', type: 'controller', room: 'W0N0', x: 25, y: 25,
				user: 'user1', level: 2, progress: 22500 }
		]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(/>2<\/text>/.test(svg), 'level number text present');
		assert.ok(/<circle[^>]*r="0\.225"[^>]*fill="#ffe25a"/.test(svg),
			'yellow progress disc r=0.45*(22500/45000)=0.225 present');
		assert.ok(/<path[^>]*A 0\.6 0\.6[^>]*stroke="#ffe25a"/.test(svg) || /<path d="[^"]*A 0\.6 0\.6/.test(svg),
			'rim arc path at radius 0.6 present');
	});

	it('renders nothing for the scaffold controller (level 0, no user)', function () {
		const recording = makeActionRecording({}, [
			{ _id: 'ctrl0', type: 'controller', room: 'W0N0', x: 30, y: 30, level: 0 }
		]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('#181818') === -1, 'no controller base circle');
		assert.ok(svg.indexOf('cx="30.5"') === -1, 'nothing drawn at the scaffold position');
	});

	it('bot-owned creep uses blue inner ring; no 0.52 outline circle', function () {
		const recording = makeRecording();
		// user1 is the botUserId; ensure it has body parts so creep renders
		recording.frames[0].objects[0].body = [{ type: 'move', hits: 100 }];
		recording.frames[1].objects[0].body = [{ type: 'move', hits: 100 }];
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('5577ff') !== -1, 'blue inner ring present for bot-owned creep');
		assert.ok(svg.indexOf('r="0.52"') === -1, 'no radius-0.52 ownership outline circle');
	});

	// --- life pack ---------------------------------------------------------

	// Two-frame recording at the given gameTime carrying the same objects in
	// both frames (life-pack fixtures: spawns, drops, tombstones, links).
	function makeStaticRecording(objects, gameTime) {
		const time = gameTime !== undefined ? gameTime : 1;
		return {
			meta: { scenario: 'life', botUserId: 'user1', ticks: 2 },
			terrain: { W0N0: makeTerrain() },
			frames: [
				{ gameTime: time, objects: objects, flags: [], eventLog: {} },
				{ gameTime: time + 1, objects: objects, flags: [], eventLog: {} }
			]
		};
	}

	it('draws spawning creeps beneath structures, normal creeps above', function () {
		const spawnDoc = { _id: 'sp1', type: 'spawn', room: 'W0N0', x: 10, y: 10, user: 'user1',
			store: { energy: 300 }, storeCapacityResource: { energy: 300 } };
		const hatchling = { _id: 'h1', type: 'creep', name: 'H', room: 'W0N0', x: 10, y: 10,
			hits: 100, hitsMax: 100, user: 'user1', spawning: true, body: [{ type: 'move', hits: 100 }] };
		const walker = { _id: 'w1', type: 'creep', name: 'W', room: 'W0N0', x: 20, y: 20,
			hits: 100, hitsMax: 100, user: 'user1', body: [{ type: 'move', hits: 100 }] };
		const recording = makeStaticRecording([spawnDoc, hatchling, walker]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		const spawnIndex = svg.indexOf('#CCCCCC'); // spawn ring stroke
		assert.ok(spawnIndex !== -1, 'spawn structure present');
		assert.ok(svg.indexOf('dojo-creep') !== -1, 'creep rings present');
		assert.ok(svg.indexOf('dojo-creep') < spawnIndex, 'spawning creep ring renders beneath the spawn');
		assert.ok(svg.lastIndexOf('dojo-creep') > spawnIndex, 'normal creep still renders above structures');
	});

	it('draws a white half-sweep progress arc on a spawn midway through spawning', function () {
		// spawning started at spawnTime - needTime = 95; gameTime 100 => fraction 0.5
		const spawnDoc = { _id: 'sp1', type: 'spawn', room: 'W0N0', x: 10, y: 10, user: 'user1',
			store: { energy: 0 }, storeCapacityResource: { energy: 300 },
			spawning: { name: 'H', needTime: 10, spawnTime: 105 } };
		const recording = makeStaticRecording([spawnDoc], 100);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		const arc = /<path d="[^"]*A 0\.52 0\.52[^"]*"[^>]*stroke="#ffffff"/.exec(svg);
		assert.ok(arc, 'white 0.52-radius arc present');
		assert.ok(arc[0].indexOf('11.020') !== -1, '180-degree sweep ends at cy + 0.52 = 11.020');
	});

	it('draws no white arc on an idle spawn', function () {
		const spawnDoc = { _id: 'sp1', type: 'spawn', room: 'W0N0', x: 10, y: 10, user: 'user1',
			store: { energy: 150 }, storeCapacityResource: { energy: 300 } };
		const recording = makeStaticRecording([spawnDoc]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('A 0.52 0.52') === -1, 'no 0.52-radius arc without spawning');
	});

	it('scales the extension core with stored energy (25/50 -> r=0.175)', function () {
		const extensionDoc = { _id: 'x1', type: 'extension', room: 'W0N0', x: 12, y: 12, user: 'user1',
			store: { energy: 25 }, storeCapacityResource: { energy: 50 } };
		const recording = makeStaticRecording([extensionDoc]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(/<circle[^>]*r="0\.175"[^>]*fill="#FFE87B"/.test(svg),
			'half-full extension core r=0.35*0.5=0.175 in energy yellow');
	});

	it('draws no inner energy circle for an empty spawn', function () {
		const spawnDoc = { _id: 'sp1', type: 'spawn', room: 'W0N0', x: 10, y: 10, user: 'user1',
			store: { energy: 0 }, storeCapacityResource: { energy: 300 } };
		const recording = makeStaticRecording([spawnDoc]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('#FFE87B') === -1, 'no energy-colored core on an empty spawn');
	});

	it('rotates a stationary creep ring toward its harvest target (east -> rotate(90)', function () {
		const recording = makeActionRecording({ harvest: { x: 14, y: 10 } });
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(/<g class="dojo-creep"[^>]*rotate\(90/.test(svg),
			'ring faces the action target: facing 0 (east) + 90 design offset');
	});

	it('draws dropped energy as a yellow dojo-resource dot scaled by amount', function () {
		const drop = { _id: 'd1', type: 'energy', room: 'W0N0', x: 15, y: 15,
			energy: 500, resourceType: 'energy' };
		const recording = makeStaticRecording([drop]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		const group = /<g class="dojo-resource">([\s\S]*?)<\/g>/.exec(svg);
		assert.ok(group, 'dojo-resource group present');
		assert.ok(group[1].indexOf('#FFE87B') !== -1, 'energy drop is energy yellow');
		assert.ok(group[1].indexOf('r="0.225"') !== -1, 'radius 0.15 + 0.15*(500/1000) = 0.225');
	});

	it('draws non-energy drops white', function () {
		const drop = { _id: 'd2', type: 'energy', room: 'W0N0', x: 15, y: 15,
			U: 100, resourceType: 'U' };
		const recording = makeStaticRecording([drop]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		const group = /<g class="dojo-resource">([\s\S]*?)<\/g>/.exec(svg);
		assert.ok(group, 'dojo-resource group present');
		assert.ok(group[1].indexOf('#ffffff') !== -1, 'non-energy drop is white');
	});

	it('draws a tombstone marker', function () {
		const tombstone = { _id: 't1', type: 'tombstone', room: 'W0N0', x: 18, y: 18, user: 'user1',
			deathTime: 1, decayTime: 50, creepId: 'cX', creepName: 'dead',
			creepBody: ['move'], store: {} };
		const recording = makeStaticRecording([tombstone]);
		const svg = renderFrameSvg(recording, 0, 0, { pixelsPerRoom: 200 });
		assert.ok(svg.indexOf('dojo-tombstone') !== -1, 'dojo-tombstone group present');
		assert.ok(svg.indexOf('#9a9a9a') !== -1, 'headstone fill present');
	});

	it('animates the upgrade beam: faint guide plus traveling pulse at t=0.5', function () {
		const recording = makeActionRecording({ upgradeController: { x: 14, y: 10 } });
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		const yellowLines = svg.match(/<line[^>]*stroke="#ffe25a"[^>]*>/g) || [];
		assert.strictEqual(yellowLines.length, 2, 'faint full-length guide + bright pulse');
		// pulse head: lerp(10.5, 14.5, 0.5) = 12.5
		assert.ok(yellowLines.some(function (line) {
			return line.indexOf('x2="12.500"') !== -1 && line.indexOf('opacity="0.9"') !== -1;
		}), 'pulse head sits halfway to the target');
	});

	it('draws yellow beams for link transferEnergy', function () {
		const link = { _id: 'l1', type: 'link', room: 'W0N0', x: 15, y: 10, user: 'user1',
			store: { energy: 400 },
			actionLog: { transferEnergy: { x: 20, y: 10 } } };
		const recording = makeStaticRecording([link]);
		const svg = renderFrameSvg(recording, 0, 0.5, { pixelsPerRoom: 200 });
		const yellowLines = svg.match(/<line[^>]*stroke="#ffe25a"[^>]*>/g) || [];
		assert.ok(yellowLines.length >= 2, 'link transfer beam (guide + pulse) present');
	});
});

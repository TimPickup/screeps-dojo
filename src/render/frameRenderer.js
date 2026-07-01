'use strict';

// Turns one recording frame (+ subframe fraction t in [0,1) toward the NEXT
// frame) into an SVG string (spec §8): terrain, structures via the dojo
// RoomVisual lib, creeps lerped between tiles, HP bars, say bubbles, attack/
// heal effects from actionLog, death fade-outs, multi-room stitching.
const fs = require('fs');
const path = require('path');
const { FakeRoomVisual, installRoomVisualLibrary } = require('./fakeRoomVisual');
const { generateCreepSvg, countBodyParts } = require('./creepSprite');
const { elementToSvg, svgEscape } = require('./svgPrimitives');
const { roomNameToXY } = require('../mapFormat');
const { CONTROLLER_LEVELS } = require('@screeps/common/lib/constants');

const TILE_COLORS = { '.': '#2b2b2b', '~': '#23311e', '#': '#111111' };
const ROOM_BACKGROUND = '#2b2b2b';
const BOT_COLOR = '#65fd62';
const HOSTILE_COLOR = '#fd6262';
const NPC_USER_IDS = ['2', '3']; // Invader / Source Keeper -> sprite, not ring
const CREEP_SIZE_TILES = 1.25;   // ring design space scaled so tough outline ~fills the tile

// NPC invader sprite, embedded inline so resvg needs no external references.
const invaderAsset = (function () {
	const raw = fs.readFileSync(path.join(__dirname, 'assets', 'invader.svg'), 'utf8');
	const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(raw);
	const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(raw)[1];
	return { inner: inner, width: Number(viewBox[1]), height: Number(viewBox[2]) };
})();

function invaderSvg(x, y, opacity, angleDegrees) {
	const size = 0.95; // tile widths
	const scale = size / invaderAsset.width;
	const drawWidth = invaderAsset.width * scale;
	const drawHeight = invaderAsset.height * scale;
	const tx = (x + 0.5 - drawWidth / 2).toFixed(3);
	const ty = (y + 0.5 - drawHeight / 2).toFixed(3);
	const cx = (invaderAsset.width / 2).toFixed(3);
	const cy = (invaderAsset.height / 2).toFixed(3);
	const angle = angleDegrees !== undefined ? angleDegrees : 0;
	return '<g class="dojo-invader" opacity="' + opacity + '" transform="translate('
		+ tx + ',' + ty + ') scale(' + scale.toFixed(4) + ') rotate(' + angle + ' ' + cx + ' ' + cy + ')">'
		+ invaderAsset.inner + '</g>';
}

// Returns the facing angle in degrees for a creep at frameIndex.
// Looks at the current transition first (frames[frameIndex] → frames[frameIndex+1]);
// if no movement there, scans backward for the most recent tick with movement.
// Cross-room steps are measured in stitched-layout world coordinates
// (local + offsets[room] * 50), so a step east across a seam faces right.
// Returns 0 (faces right) if the creep never moved.
function creepFacing(recording, frameIndex, objectId, layout, fallbackAngle) {
	const frames = recording.frames;
	const offsets = layout ? layout.offsets : null;

	function posAt(fi) {
		const frame = frames[fi];
		if (!frame) return null;
		for (let i = 0; i < frame.objects.length; i++) {
			if (frame.objects[i]._id === objectId) return frame.objects[i];
		}
		return null;
	}

	// World-space delta a → b; null when it cannot be computed (a room is
	// outside the stitched layout) or when there is no movement.
	function worldDelta(a, b) {
		let dx, dy;
		if (a.room === b.room) {
			dx = b.x - a.x;
			dy = b.y - a.y;
		} else {
			if (!offsets || !offsets[a.room] || !offsets[b.room]) return null;
			dx = (b.x + offsets[b.room].col * 50) - (a.x + offsets[a.room].col * 50);
			dy = (b.y + offsets[b.room].row * 50) - (a.y + offsets[a.room].row * 50);
		}
		return dx !== 0 || dy !== 0 ? { dx: dx, dy: dy } : null;
	}

	const curr = posAt(frameIndex);
	const next = posAt(frameIndex + 1);

	// An action target takes priority over movement: face what's being worked
	// on. actionLog coordinates are local to the acting creep's room (next's).
	if (curr && next && next.actionLog) {
		const ACTION_KEYS = ['harvest', 'attack', 'upgradeController', 'heal',
			'rangedAttack', 'rangedHeal', 'build'];
		for (const key of ACTION_KEYS) {
			const target = next.actionLog[key];
			if (target && typeof target.x === 'number' && typeof target.y === 'number') {
				const delta = worldDelta(curr, { room: next.room, x: target.x, y: target.y });
				if (delta) return Math.atan2(delta.dy, delta.dx) * 180 / Math.PI;
			}
		}
	}

	// Check current transition first
	if (curr && next) {
		const delta = worldDelta(curr, next);
		if (delta) return Math.atan2(delta.dy, delta.dx) * 180 / Math.PI;
	}

	// Scan backward for most recent movement
	for (let k = frameIndex; k >= 1; k--) {
		const a = posAt(k - 1);
		const b = posAt(k);
		if (a && b) {
			const delta = worldDelta(a, b);
			if (delta) return Math.atan2(delta.dy, delta.dx) * 180 / Math.PI;
		}
	}

	return fallbackAngle !== undefined ? fallbackAngle : 0;
}
const STRUCTURE_TYPES_DRAWN = ['spawn', 'extension', 'tower', 'storage', 'terminal', 'link',
	'lab', 'factory', 'observer', 'nuker', 'powerSpawn', 'container', 'road', 'rampart',
	'constructedWall', 'controller', 'invaderCore', 'keeperLair', 'extractor'];

// Rooms arranged by their true world coordinates, normalized to a grid.
function computeLayout(roomNames) {
	const positions = roomNames.map(function (name) {
		const xy = roomNameToXY(name);
		return { name: name, x: xy.x, y: xy.y };
	});
	const minX = Math.min.apply(null, positions.map(function (p) { return p.x; }));
	const minY = Math.min.apply(null, positions.map(function (p) { return p.y; }));
	const offsets = {};
	let columns = 1, rows = 1;
	for (const position of positions) {
		const col = position.x - minX;
		const row = position.y - minY;
		offsets[position.name] = { col: col, row: row };
		columns = Math.max(columns, col + 1);
		rows = Math.max(rows, row + 1);
	}
	return { offsets: offsets, columns: columns, rows: rows };
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function terrainSvg(rows) {
	const parts = ['<rect x="0" y="0" width="50" height="50" fill="' + ROOM_BACKGROUND + '"/>'];
	for (let y = 0; y < 50; y++) {
		for (let x = 0; x < 50; x++) {
			const char = rows[y][x];
			if (char === '.') continue;
			parts.push('<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="'
				+ TILE_COLORS[char] + '"/>');
		}
	}
	// slight tile grid over the floor (under structures and creeps)
	let gridPath = '';
	for (let i = 1; i < 50; i++) {
		gridPath += 'M ' + i + ' 0 V 50 M 0 ' + i + ' H 50 ';
	}
	parts.push('<path class="dojo-grid" d="' + gridPath.trim()
		+ '" stroke="#ffffff" stroke-width="0.02" opacity="0.07" fill="none"/>');
	// exit arrows: outward-pointing chevrons on every walkable border tile
	const exits = [];
	function chevron(tileX, tileY, dirX, dirY) {
		// chevron from -0.15 (arm base) to tip at +0.3 of the tile centre,
		// arms spread ±0.25 perpendicular to the pointing direction
		const cx = tileX + 0.5, cy = tileY + 0.5;
		const px = -dirY, py = dirX; // perpendicular
		const a = { x: cx - 0.15 * dirX + 0.25 * px, y: cy - 0.15 * dirY + 0.25 * py };
		const tip = { x: cx + 0.3 * dirX, y: cy + 0.3 * dirY };
		const b = { x: cx - 0.15 * dirX - 0.25 * px, y: cy - 0.15 * dirY - 0.25 * py };
		exits.push('<path d="M ' + a.x.toFixed(2) + ' ' + a.y.toFixed(2)
			+ ' L ' + tip.x.toFixed(2) + ' ' + tip.y.toFixed(2)
			+ ' L ' + b.x.toFixed(2) + ' ' + b.y.toFixed(2) + '"/>');
	}
	for (let i = 1; i < 49; i++) {
		if (rows[i][0] !== '#') chevron(0, i, -1, 0);   // left edge points left
		if (rows[i][49] !== '#') chevron(49, i, 1, 0);  // right edge points right
		if (rows[0][i] !== '#') chevron(i, 0, 0, -1);   // top edge points up
		if (rows[49][i] !== '#') chevron(i, 49, 0, 1);  // bottom edge points down
	}
	if (exits.length > 0) {
		parts.push('<g class="dojo-exit" stroke="#9bd49b" stroke-width="0.08" opacity="0.5" fill="none">'
			+ exits.join('') + '</g>');
	}
	return parts.join('');
}

function indexById(objects) {
	const byId = {};
	for (const object of objects) byId[object._id] = object;
	return byId;
}

// Creep sprites go on their own raw-SVG layer (between structures and the
// overlay) so HP bars, say bubbles, and effects always read on top of them.
function drawCreep(creepLayer, overlay, creep, x, y, botUserId, opacity, facingAngle) {
	// String(): old recordings may carry numeric user ids from un-normalized scenarios
	if (NPC_USER_IDS.indexOf(String(creep.user)) !== -1) {
		creepLayer.push(invaderSvg(x, y, opacity, facingAngle));
	} else {
		const innerColor = creep.user === botUserId ? '#5577ff' : '#ff5555';
		// the ring design faces UP; +90 points it along the facing heading (0 = east)
		creepLayer.push(generateCreepSvg(x + 0.5, y + 0.5, CREEP_SIZE_TILES,
			countBodyParts(creep.body), creep.store, opacity, innerColor, creep.storeCapacity,
			(facingAngle !== undefined ? facingAngle : 0) + 90));
	}
	if (creep.hits !== undefined && creep.hitsMax && creep.hits < creep.hitsMax) {
		const fraction = Math.max(0, creep.hits / creep.hitsMax);
		overlay.rect(x - 0.5, y - 0.85, 1.0, 0.15, { fill: '#555555', opacity: opacity });
		overlay.rect(x - 0.5, y - 0.85, fraction, 0.15, { fill: '#65fd62', opacity: opacity });
	}
	if (creep.actionLog && creep.actionLog.say && creep.actionLog.say.message) {
		overlay.speech(creep.actionLog.say.message, x, y, { textsize: 0.7, opacity: 0.95 });
	}
}

// Animated effect beam (raw overlay-level SVG): a faint full-length guide
// line plus a bright pulse whose head travels source -> target over the
// subframe (t in [0,1)). Coordinates are tile coords; +0.5 shifts to centres.
function beamSvg(fromX, fromY, toX, toY, color, width, t) {
	const x1 = fromX + 0.5, y1 = fromY + 0.5, x2 = toX + 0.5, y2 = toY + 0.5;
	const head = Math.max(0, Math.min(1, t));
	const tail = Math.max(0, head - 0.18);
	return '<line x1="' + x1.toFixed(3) + '" y1="' + y1.toFixed(3)
		+ '" x2="' + x2.toFixed(3) + '" y2="' + y2.toFixed(3)
		+ '" stroke="' + color + '" stroke-width="' + (width * 0.6).toFixed(3)
		+ '" opacity="0.25" stroke-linecap="round"/>'
		+ '<line x1="' + lerp(x1, x2, tail).toFixed(3) + '" y1="' + lerp(y1, y2, tail).toFixed(3)
		+ '" x2="' + lerp(x1, x2, head).toFixed(3) + '" y2="' + lerp(y1, y2, head).toFixed(3)
		+ '" stroke="' + color + '" stroke-width="' + width
		+ '" opacity="0.9" stroke-linecap="round"/>';
}

// Solid full-length action line + target marker — used for the static (discrete,
// non-animated) render so each tick clearly shows what the creep did.
function staticLine(fromX, fromY, toX, toY, color, width) {
	const x1 = fromX + 0.5, y1 = fromY + 0.5, x2 = toX + 0.5, y2 = toY + 0.5;
	return '<line x1="' + x1.toFixed(3) + '" y1="' + y1.toFixed(3) + '" x2="' + x2.toFixed(3)
		+ '" y2="' + y2.toFixed(3) + '" stroke="' + color + '" stroke-width="' + width
		+ '" opacity="0.85" stroke-linecap="round"/>';
}

// creep is the NEXT-frame doc (where the actionLog lives); x/y is the drawn
// position; t in [0,1) drives the animated beams (MP4). When staticMode is true
// (the GUI's discrete per-tick render) effects are drawn solid and full so they
// are clearly visible without animation. Colours: melee+ranged attack red,
// heal green, harvest yellow, build/repair white, mass-attack blue burst.
function drawEffects(visual, effectLayer, creep, x, y, t, staticMode) {
	const actionLog = creep.actionLog || {};
	function beam(tx, ty, color, width) {
		if (staticMode) effectLayer.push(staticLine(x, y, tx, ty, color, width));
		else effectLayer.push(beamSvg(x, y, tx, ty, color, width, t));
	}
	if (actionLog.attack) {
		beam(actionLog.attack.x, actionLog.attack.y, '#ff4040', 0.15);
		visual.circle(actionLog.attack.x, actionLog.attack.y, { radius: 0.5, fill: 'transparent', stroke: '#ff4040', strokeWidth: 0.08, opacity: 0.8 });
	}
	if (actionLog.rangedAttack) {
		beam(actionLog.rangedAttack.x, actionLog.rangedAttack.y, '#ff4040', 0.1);
	}
	if (actionLog.harvest) {
		beam(actionLog.harvest.x, actionLog.harvest.y, '#ffe87b', 0.1);
	}
	if (actionLog.build) {
		beam(actionLog.build.x, actionLog.build.y, '#ffffff', 0.1);
	}
	if (actionLog.repair) {
		beam(actionLog.repair.x, actionLog.repair.y, '#9aa0aa', 0.08);
	}
	if (actionLog.dismantle) {
		beam(actionLog.dismantle.x, actionLog.dismantle.y, '#d18b2a', 0.1);
	}
	if (actionLog.upgradeController) {
		beam(actionLog.upgradeController.x, actionLog.upgradeController.y, '#ffe25a', 0.12);
		visual.circle(actionLog.upgradeController.x, actionLog.upgradeController.y,
			{ radius: 0.2, fill: '#ffe25a', opacity: 0.5 });
	}
	if (actionLog.heal) {
		if (actionLog.heal.x === creep.x && actionLog.heal.y === creep.y) {
			// self-heal: green glow on the creep (pulses when animated)
			const r = staticMode ? 0.6 : 0.55 + 0.1 * Math.sin(Math.PI * t);
			const op = staticMode ? 0.7 : 0.4 + 0.4 * Math.sin(Math.PI * t);
			visual.circle(x, y, { radius: r, stroke: '#5cff6a', strokeWidth: 0.08, fill: 'transparent', opacity: op });
		} else {
			beam(actionLog.heal.x, actionLog.heal.y, '#65fd62', 0.1);
		}
	}
	if (actionLog.rangedHeal) {
		beam(actionLog.rangedHeal.x, actionLog.rangedHeal.y, '#65fd62', 0.08);
	}
	if (actionLog.rangedMassAttack) {
		// blue burst: full 3-tile radius static; expanding pulse when animated.
		// (actionLog always HAS this key set to null on idle ticks — must check
		// truthiness, not `in`, or every creep gets a phantom circle.)
		const r = staticMode ? 3 : Math.max(0.2, 3 * t);
		const op = staticMode ? 0.5 : 0.8 * (1 - t);
		visual.circle(x, y, { radius: r, stroke: '#5d80b2', strokeWidth: 0.1, fill: 'transparent', opacity: op });
	}
}

// Energy fill 0..1 for spawn/extension docs (store vs storeCapacityResource).
function energyFillFraction(object) {
	const capacity = object.storeCapacityResource && object.storeCapacityResource.energy;
	if (!capacity || capacity <= 0) return 0;
	const energy = (object.store && object.store.energy) || 0;
	return Math.max(0, Math.min(1, energy / capacity));
}

// Dropped ground resource (engine doc: type 'energy', amount stored under the
// resourceType key). Dot grows with amount; energy yellow, anything else white.
function droppedResourceSvg(object) {
	const resourceType = object.resourceType || 'energy';
	const amount = object[resourceType] || 0;
	const radius = 0.15 + 0.15 * Math.min(1, amount / 1000);
	const fill = resourceType === 'energy' ? '#FFE87B' : '#ffffff';
	return '<g class="dojo-resource"><circle cx="' + (object.x + 0.5) + '" cy="' + (object.y + 0.5)
		+ '" r="' + radius.toFixed(3) + '" fill="' + fill + '" opacity="0.85"/></g>';
}

// Small gravestone: rounded headstone with a dark cross, legible at 12px/tile.
function tombstoneSvg(object) {
	const cx = object.x + 0.5, cy = object.y + 0.5;
	const headstone = 'M ' + (cx - 0.25).toFixed(3) + ' ' + (cy + 0.25).toFixed(3)
		+ ' L ' + (cx - 0.25).toFixed(3) + ' ' + (cy - 0.1).toFixed(3)
		+ ' A 0.25 0.25 0 0 1 ' + (cx + 0.25).toFixed(3) + ' ' + (cy - 0.1).toFixed(3)
		+ ' L ' + (cx + 0.25).toFixed(3) + ' ' + (cy + 0.25).toFixed(3) + ' Z';
	const cross = 'M ' + cx.toFixed(3) + ' ' + (cy - 0.22).toFixed(3)
		+ ' V ' + (cy + 0.1).toFixed(3)
		+ ' M ' + (cx - 0.1).toFixed(3) + ' ' + (cy - 0.12).toFixed(3)
		+ ' H ' + (cx + 0.1).toFixed(3);
	return '<g class="dojo-tombstone">'
		+ '<path d="' + headstone + '" fill="#9a9a9a" stroke="#555" stroke-width="0.04"/>'
		+ '<path d="' + cross + '" stroke="#444444" stroke-width="0.05" fill="none"/>'
		+ '</g>';
}

// Rim-arc path for the controller progress ring: angle 0 = top (12 o'clock),
// positive degrees sweep clockwise (same convention as creepSprite's arcs).
function controllerArcPath(cx, cy, radius, sweepDegrees) {
	const sweep = Math.min(sweepDegrees, 359.99); // a full 360 arc degenerates
	const rad = sweep * Math.PI / 180;
	const endX = cx + Math.sin(rad) * radius;
	const endY = cy - Math.cos(rad) * radius;
	const largeArcFlag = sweep > 180 ? 1 : 0;
	return 'M ' + cx.toFixed(3) + ' ' + (cy - radius).toFixed(3)
		+ ' A ' + radius + ' ' + radius + ' 0 ' + largeArcFlag + ' 1 '
		+ endX.toFixed(3) + ' ' + endY.toFixed(3);
}

// frameIndex selects frames[frameIndex] as the BASE; t in [0,1) interpolates
// toward frames[frameIndex+1] (when present).
// Replays the bot's captured RoomVisual commands (t:'c'/'l'/'r'/'p'/'t')
// through a FakeRoomVisual so they render exactly as the bot drew them.
function applyUserVisuals(visual, raw) {
	if (!raw) return;
	for (const line of String(raw).split('\n')) {
		if (!line.trim()) continue;
		let v;
		try { v = JSON.parse(line); } catch (e) { continue; }
		const s = v.s || {};
		try {
			if (v.t === 'c') visual.circle(v.x, v.y, s);
			else if (v.t === 'l') visual.line(v.x1, v.y1, v.x2, v.y2, s);
			else if (v.t === 'r') visual.rect(v.x, v.y, v.w, v.h, s);
			else if (v.t === 'p') visual.poly(v.points, s);
			else if (v.t === 't') visual.text(v.text, v.x, v.y, s);
		} catch (e) { /* skip a malformed command */ }
	}
}

// Renders ONLY the bot's RoomVisual layer for a frame as a standalone SVG with
// the same viewBox/room transforms as renderFrameSvg. Lets the client toggle
// user-visuals instantly (show/hide this overlay) with no server round-trip.
function renderUserVisualLayerSvg(recording, frameIndex, options) {
	installRoomVisualLibrary();
	const pixelsPerRoom = (options && options.pixelsPerRoom) || 600;
	const roomNames = (options && options.rooms) || Object.keys(recording.terrain);
	const layout = computeLayout(roomNames);
	const scale = pixelsPerRoom / 50;
	const width = layout.columns * pixelsPerRoom;
	const height = layout.rows * pixelsPerRoom;
	const baseFrame = recording.frames[frameIndex];
	const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">'];
	for (const roomName of roomNames) {
		const offset = layout.offsets[roomName];
		const raw = baseFrame.visuals && baseFrame.visuals[roomName];
		if (!offset || !raw) continue;
		parts.push('<g transform="translate(' + (offset.col * pixelsPerRoom) + ',' + (offset.row * pixelsPerRoom) + ') scale(' + scale + ')">');
		const visual = new FakeRoomVisual(roomName);
		applyUserVisuals(visual, raw);
		for (const element of visual.elements) parts.push(elementToSvg(element));
		parts.push('</g>');
	}
	parts.push('</svg>');
	return parts.join('');
}

function renderFrameSvg(recording, frameIndex, t, options) {
	installRoomVisualLibrary();
	const pixelsPerRoom = (options && options.pixelsPerRoom) || 600;
	const staticActions = !!(options && options.staticActions);
	const showUserVisuals = !options || options.showUserVisuals !== false;
	// staticSceneOnly: render only the unchanging scene (terrain, structures,
	// sources, controllers, flags) — no creeps/effects/HP/say/user-visuals. Used
	// by the canvas renderer as a cached per-epoch background.
	const staticSceneOnly = !!(options && options.staticSceneOnly);
	const roomNames = (options && options.rooms) || Object.keys(recording.terrain);
	const layout = computeLayout(roomNames);
	const scale = pixelsPerRoom / 50;
	const width = layout.columns * pixelsPerRoom;
	const height = layout.rows * pixelsPerRoom;

	const baseFrame = recording.frames[frameIndex];
	const nextFrame = recording.frames[frameIndex + 1] || null;
	const nextById = nextFrame ? indexById(nextFrame.objects) : null;
	const baseById = indexById(baseFrame.objects);
	const botUserId = recording.meta.botUserId;

	const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="'
		+ height + '" viewBox="0 0 ' + width + ' ' + height + '">'];

	for (const roomName of roomNames) {
		const offset = layout.offsets[roomName];
		parts.push('<g transform="translate(' + (offset.col * pixelsPerRoom) + ','
			+ (offset.row * pixelsPerRoom) + ') scale(' + scale + ')">');
		parts.push(terrainSvg(recording.terrain[roomName]));

		const visual = new FakeRoomVisual(roomName);   // under-layer: structures, flags
		const overlay = new FakeRoomVisual(roomName);  // over-layer: HP, says, effects, outlines
		const underLayer = [];                          // raw SVG beneath structures: spawning creeps, drops, tombstones
		const creepLayer = [];                          // raw creep sprites between the two
		const structureExtras = [];                     // raw over-structure SVG (controller/spawn rim arcs)
		const effectLayer = [];                         // raw animated beams under the overlay

		// structures first (static layer)
		for (const object of baseFrame.objects) {
			if (object.room !== roomName || object.type === 'creep') continue;
			if (object.type === 'flag') continue;
			if (object.type === 'energy') {
				underLayer.push(droppedResourceSvg(object));
				continue;
			}
			if (object.type === 'tombstone') {
				underLayer.push(tombstoneSvg(object));
				continue;
			}
			if (object.type === 'constructionSite') {
				// planned structure: light grey translucent circle
				visual.circle(object.x, object.y, { radius: 0.4, fill: '#d3d3d3', opacity: 0.7 });
				continue;
			}
			if (STRUCTURE_TYPES_DRAWN.indexOf(object.type) !== -1 || object.type === 'source'
				|| object.type === 'mineral') {
				if (object.type === 'source') {
					// black base + energy-scaled yellow core: empties as it's
					// mined, grows back over the regeneration ticks
					visual.circle(object.x, object.y, { radius: 0.35, fill: '#0a0a0a', stroke: '#333333', strokeWidth: 0.04 });
					const energyFraction = object.energyCapacity
						? Math.max(0, Math.min(1, object.energy / object.energyCapacity)) : 0;
					if (energyFraction > 0) {
						visual.circle(object.x, object.y, { radius: 0.32 * energyFraction, fill: '#FFE87B', opacity: 0.95 });
					}
				} else if (object.type === 'mineral') {
					visual.circle(object.x, object.y, { radius: 0.35, fill: '#ffffff', opacity: 0.6 });
				} else if (object.type === 'controller') {
					// loader's scaffold controller (unowned, level 0): draw nothing
					if (!object.user && !(object.level > 0)) continue;
					visual.circle(object.x, object.y, { radius: 0.6, fill: '#181818', stroke: '#888888', strokeWidth: 0.05 });
					const progressTotal = CONTROLLER_LEVELS[object.level];
					const fraction = progressTotal ? Math.min(1, (object.progress || 0) / progressTotal) : 0;
					if (fraction > 0) {
						visual.circle(object.x, object.y, { radius: 0.45 * fraction, fill: '#ffe25a', opacity: 0.85 });
						structureExtras.push('<path d="'
							+ controllerArcPath(object.x + 0.5, object.y + 0.5, 0.6, fraction * 360)
							+ '" fill="none" stroke="#ffe25a" stroke-width="0.08"/>');
					}
					// level number on the overlay so creeps can't hide it
					overlay.text(String(object.level), object.x, object.y + 0.17, { font: 0.5, color: '#ffffff' });
				} else if (object.type === 'spawn') {
					visual.structure(object.x, object.y, 'spawn', { fillFraction: energyFillFraction(object) });
					// white progress arc while spawning: spawning = {name,
					// needTime, spawnTime: start + needTime} (engine create-creep)
					if (object.spawning && object.spawning.needTime > 0) {
						const start = object.spawning.spawnTime - object.spawning.needTime;
						const fraction = Math.max(0, Math.min(1,
							(baseFrame.gameTime + t - start) / object.spawning.needTime));
						if (fraction > 0) {
							structureExtras.push('<path d="'
								+ controllerArcPath(object.x + 0.5, object.y + 0.5, 0.52, fraction * 360)
								+ '" fill="none" stroke="#ffffff" stroke-width="0.12" opacity="0.85"/>');
						}
					}
				} else if (object.type === 'extension') {
					visual.structure(object.x, object.y, 'extension', { fillFraction: energyFillFraction(object) });
				} else if (object.type === 'link') {
					const linkFill = Math.max(0, Math.min(1, ((object.store && object.store.energy) || 0) / 800));
					visual.structure(object.x, object.y, 'link', { fillFraction: linkFill });
					// link energy beams: actionLog lives on the structure doc too;
					// prefer the next frame's (the transition being animated)
					const nextDoc = nextById ? nextById[object._id] : null;
					const linkLog = (nextDoc || object).actionLog;
					if (linkLog && linkLog.transferEnergy) {
						effectLayer.push(beamSvg(object.x, object.y,
							linkLog.transferEnergy.x, linkLog.transferEnergy.y, '#ffe25a', 0.12, t));
					}
				} else if (object.type === 'tower') {
					visual.structure(object.x, object.y, 'tower', { fillFraction: energyFillFraction(object) });
					// tower attack/heal/repair beams: actionLog lives on the
					// structure doc (keys are a subset of the creep ones, so the
					// creep effect renderer draws them identically). Prefer the
					// next frame's log (the transition being animated), like links.
					// Skipped for the canvas background — it draws these live.
					if (!staticSceneOnly) {
						const nextDoc = nextById ? nextById[object._id] : null;
						drawEffects(overlay, effectLayer, nextDoc || object, object.x, object.y, t, staticActions);
					}
				} else {
					visual.structure(object.x, object.y, object.type);
				}
			}
		}
		visual.connectRoads();

		// flags
		for (const flagDoc of baseFrame.flags) {
			if (flagDoc.room !== roomName) continue;
			// flag docs carry the wire string; recorded as-is — draw a simple marker per flag
			const entries = String(flagDoc.data || '').split('|').filter(Boolean);
			for (const entry of entries) {
				const fields = entry.split('~');
				const x = Number(fields[3]), y = Number(fields[4]);
				visual.poly([[x, y + 0.3], [x, y - 0.5], [x + 0.5, y - 0.3], [x, y - 0.1]],
					{ stroke: '#ffffff', strokeWidth: 0.08, fill: '#ff6666', opacity: 0.9 });
				visual.text(fields[0], x, y + 0.85, { font: 0.4, color: '#ffffff', opacity: 0.8 });
			}
		}

		// being-spawned creeps render beneath the spawn: ring at its own tile,
		// no bob/facing/HP bar (the spawn's progress arc tells the story)
		function drawSpawningCreep(creep, opacity) {
			const innerColor = creep.user === botUserId ? '#5577ff' : '#ff5555';
			underLayer.push(generateCreepSvg(creep.x + 0.5, creep.y + 0.5, CREEP_SIZE_TILES,
				countBodyParts(creep.body), creep.store, opacity, innerColor, creep.storeCapacity));
		}

		// creeps/effects/HP/say: skipped for the canvas renderer's static-only
		// background (it draws those live). lerp toward next frame; fade the dead.
		if (!staticSceneOnly) {
		for (const object of baseFrame.objects) {
			if (object.room !== roomName || object.type !== 'creep') continue;
			if (object.spawning) {
				drawSpawningCreep(object, 1);
				continue;
			}
			const next = nextById ? nextById[object._id] : null;
			if (next && (next.room === object.room || layout.offsets[next.room])) {
				// Cross-room steps: express next's position in the BASE room's
				// local space via the stitched layout, so the creep walks one
				// tile across the seam instead of lerping across the room.
				// The lerped position may exceed 0..50 — SVG groups don't clip,
				// so the creep visually crosses into the neighbor room.
				let nextLocalX = next.x, nextLocalY = next.y;
				if (next.room !== object.room) {
					nextLocalX = next.x + (layout.offsets[next.room].col - layout.offsets[object.room].col) * 50;
					nextLocalY = next.y + (layout.offsets[next.room].row - layout.offsets[object.room].row) * 50;
				}
				let x = lerp(object.x, nextLocalX, t);
				let y = lerp(object.y, nextLocalY, t);
				// work/attack bob: nudge the drawn position toward the action
				// target so the sprite, HP bar, say bubble, and effect anchors
				// all lean into the swing together
				const nextLog = next.actionLog || {};
				const bobTarget = nextLog.harvest || nextLog.attack;
				if (bobTarget) {
					const bobDx = bobTarget.x - x, bobDy = bobTarget.y - y;
					const bobDistance = Math.sqrt(bobDx * bobDx + bobDy * bobDy);
					if (bobDistance > 0) {
						const amplitude = 0.15 * Math.sin(Math.PI * t);
						x += amplitude * bobDx / bobDistance;
						y += amplitude * bobDy / bobDistance;
					}
				}
				// HP/say come from the BASE frame; the next frame's values land when the transition completes
				drawCreep(creepLayer, overlay, object, x, y, botUserId, 1,
					creepFacing(recording, frameIndex, object._id, layout));
				drawEffects(overlay, effectLayer, next, x, y, t, staticActions);
			} else if (nextFrame) {
				// died, or walked into a room excluded from the layout: fade out
				drawCreep(creepLayer, overlay, object, object.x, object.y, botUserId, 1 - t,
					creepFacing(recording, frameIndex, object._id, layout));
			} else {
				drawCreep(creepLayer, overlay, object, object.x, object.y, botUserId, 1,
					creepFacing(recording, frameIndex, object._id, layout));
				// Latest frame (no following frame yet — i.e. the live view): draw
				// THIS frame's own actions so attacks/harvest/upgrade/build/heal/etc.
				// still show statically without a next frame to lean on.
				drawEffects(overlay, effectLayer, object, object.x, object.y, 0, staticActions);
			}
		}
		// creeps that appear in the next frame only (spawned): fade in
		if (nextFrame) {
			for (const object of nextFrame.objects) {
				if (object.room !== roomName || object.type !== 'creep' || baseById[object._id]) continue;
				if (object.spawning) {
					drawSpawningCreep(object, t);
					continue;
				}
				drawCreep(creepLayer, overlay, object, object.x, object.y, botUserId, t,
					creepFacing(recording, frameIndex + 1, object._id, layout));
			}
		}
		} // end if(!staticSceneOnly)

		parts.push(underLayer.join(''));
		for (const element of visual.elements) parts.push(elementToSvg(element));
		parts.push(structureExtras.join(''));
		parts.push(creepLayer.join(''));
		parts.push(effectLayer.join(''));
		for (const element of overlay.elements) parts.push(elementToSvg(element));
		// the bot's own RoomVisual draws, on top (as in-game) — gated by the toggle
		if (showUserVisuals && !staticSceneOnly) {
			const userVisual = new FakeRoomVisual(roomName);
			applyUserVisuals(userVisual, baseFrame.visuals && baseFrame.visuals[roomName]);
			for (const element of userVisual.elements) parts.push(elementToSvg(element));
		}
		parts.push('</g>');
	}

	// tick counter overlay
	parts.push('<text x="8" y="' + (height - 8) + '" font-size="14" fill="#aaaaaa" '
		+ 'font-family="DejaVu Sans">tick ' + baseFrame.gameTime + '</text>');
	parts.push('</svg>');
	return parts.join('');
}

module.exports = { renderFrameSvg: renderFrameSvg, renderUserVisualLayerSvg: renderUserVisualLayerSvg, computeLayout: computeLayout };

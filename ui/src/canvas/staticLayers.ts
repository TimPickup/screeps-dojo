import type { StageLayout, Frame, FrameObject } from '../api/types.ts';
import { drawStructureShell, connectRoads } from './structures.ts';
import { drawNuke, drawSourceCore, drawTowerTurret } from './dynamic.ts';
import { drawNukeFlights, drawNukerFill } from './nukes.ts';
import { circle, poly, roundedSquare, text } from './primitives.ts';
import { drawWallIslands } from './terrainWalls.ts';
import { drawSwampIslands } from './terrainSwamps.ts';
import { drawRamparts } from './ramparts.ts';
import type { ModImages } from './modImages.ts';
import { drawReactor, drawUnknownObject } from './modObjects.ts';
import { frameObjectsInDrawOrder } from './renderOrder.ts';
import { fillRenderText, parseRenderFont } from './renderFont.ts';
import { drawDeposit } from './deposits.ts';
import type { TerrainTextures } from './terrainTextures.ts';
import {
	DEFAULT_MINERAL_COLOR,
	KNOWN_OBJECT_TYPES,
	ROOM_NAME_STYLE,
	MINERAL_COLORS,
	RENDER_COLORS,
	ROOM_SIZE_TILES,
	SOURCE_RENDER_STYLE,
	STRUCTURE_SHELL_TYPES,
	TILE_PADDING_TILES,
} from './renderConstants.ts';

// One room's immutable ground at room-local integer tile coordinates. Walls
// are drawn separately, over this, by drawRoomTerrainLayer: the terrain tile
// is opaque, so a border wall's half-pixel overlap with the next tile hides
// rather than showing a seam, which a transparent structure tile could not.
export function drawTerrain(
	ctx: CanvasRenderingContext2D,
	rows: string[],
	terrainTextures?: TerrainTextures,
): void {
	ctx.save();
	ctx.fillStyle = RENDER_COLORS.terrain.plain;
	ctx.fillRect(0, 0, ROOM_SIZE_TILES, ROOM_SIZE_TILES);
	// faint tile grid
	ctx.globalAlpha = 0.07;
	ctx.strokeStyle = RENDER_COLORS.terrain.grid;
	ctx.lineWidth = 0.02;
	ctx.beginPath();
	for (let i = 1; i < ROOM_SIZE_TILES; i++) {
		ctx.moveTo(i, 0); ctx.lineTo(i, ROOM_SIZE_TILES);
		ctx.moveTo(0, i); ctx.lineTo(ROOM_SIZE_TILES, i);
	}
	ctx.stroke();
	ctx.globalAlpha = 1;
	drawSwampIslands(ctx, rows, terrainTextures?.swampNoise1);
	// exit chevrons on walkable border tiles
	ctx.strokeStyle = RENDER_COLORS.terrain.exit;
	ctx.lineWidth = 0.08;
	ctx.globalAlpha = 0.5;
	ctx.beginPath();
	const chevron = (tileX: number, tileY: number, dirX: number, dirY: number) => {
		// chevron from -0.15 (arm base) to tip at +0.3 of the tile centre,
		// arms spread ±0.25 perpendicular to the pointing direction
		const cx = tileX + 0.5, cy = tileY + 0.5;
		const px = -dirY, py = dirX; // perpendicular
		const ax = cx - 0.15 * dirX + 0.25 * px, ay = cy - 0.15 * dirY + 0.25 * py;
		const tipX = cx + 0.3 * dirX, tipY = cy + 0.3 * dirY;
		const bx = cx - 0.15 * dirX - 0.25 * px, by = cy - 0.15 * dirY - 0.25 * py;
		ctx.moveTo(ax, ay);
		ctx.lineTo(tipX, tipY);
		ctx.lineTo(bx, by);
	};
	for (let i = 1; i < ROOM_SIZE_TILES - 1; i++) {
		if (rows[i] && rows[i][0] !== '#') chevron(0, i, -1, 0);
		if (rows[i] && rows[i][ROOM_SIZE_TILES - 1] !== '#') chevron(ROOM_SIZE_TILES - 1, i, 1, 0);
		if (rows[0] && rows[0][i] !== '#') chevron(i, 0, 0, -1);
		if (rows[ROOM_SIZE_TILES - 1] && rows[ROOM_SIZE_TILES - 1][i] !== '#') chevron(i, ROOM_SIZE_TILES - 1, 0, 1);
	}
	ctx.stroke();
	ctx.restore();
}

// One room's terrain plus its walls, room-local. Walls draw here rather than
// in the structure layer: terrain is opaque, so the half-pixel overlap between
// adjacent terrain tiles (Task 4) hides the seam a transparent structure tile
// would otherwise show as a hairline at fractional zoom.
export function drawRoomTerrainLayer(
	ctx: CanvasRenderingContext2D,
	rows: string[],
	constructedWalls: Array<{ x: number; y: number }>,
	terrainTextures?: TerrainTextures,
	wallTexture?: CanvasImageSource,
): void {
	drawTerrain(ctx, rows, terrainTextures);
	drawWallIslands(ctx, rows, wallTexture, constructedWalls);
}

// The room's own name, small and white inside its top-left corner. Baked into
// the structure layer, which sits above the walls the corner tile is made of, so
// playback costs nothing per frame. Room-local.
function drawRoomName(ctx: CanvasRenderingContext2D, roomName: string): void {
	ctx.save();
	ctx.fillStyle = RENDER_COLORS.roomName;
	fillRenderText(ctx, roomName, ROOM_NAME_STYLE.x, ROOM_NAME_STYLE.baseline, parseRenderFont(ROOM_NAME_STYLE.fontSize), 'left');
	ctx.restore();
}

export function drawRoomNames(ctx: CanvasRenderingContext2D, layout: StageLayout): void {
	for (const roomName of Object.keys(layout.offsets)) {
		const roomOffset = layout.offsets[roomName];
		ctx.save();
		ctx.translate(roomOffset.col * ROOM_SIZE_TILES, roomOffset.row * ROOM_SIZE_TILES);
		drawRoomName(ctx, roomName);
		ctx.restore();
	}
}

export function drawTerrainScene(
	ctx: CanvasRenderingContext2D,
	terrain: Record<string, string[]>,
	layout: StageLayout,
	terrainTextures?: TerrainTextures,
): void {
	for (const room of Object.keys(terrain)) {
		const roomOffset = layout.offsets[room];
		if (!roomOffset) continue;
		ctx.save();
		ctx.translate(roomOffset.col * ROOM_SIZE_TILES, roomOffset.row * ROOM_SIZE_TILES);
		drawTerrain(ctx, terrain[room], terrainTextures);
		ctx.restore();
	}
}

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

function darkenMineralColor(color: string): string {
	const darkenedDigits = color.slice(1).split('').map((hexDigit) => (
		(parseInt(hexDigit, 16) * 0.25 | 0).toString(16)
	));
	return `#${darkenedDigits.join('')}`;
}

// One room's static structures, room-local, in frameObjectsInDrawOrder order.
// Roads collect their joins as they're drawn so connectRoads can lay a single
// pass of joins over the whole room once the shells are down.
function drawRoomStaticStructures(
	ctx: CanvasRenderingContext2D,
	objects: readonly FrameObject[],
	modImages?: ModImages,
): void {
	const roads: number[][] = [];
	for (const object of objects) {
		if (STRUCTURE_SHELL_TYPES.has(object.type)) {
			drawStructureShell(ctx, object);
			if (object.type === 'road') roads.push([object.x, object.y]);
		} else if (object.type === 'source') {
			// The energy core is dynamic, so only its dark base is cached.
			roundedSquare(ctx, object.x + 0.5, object.y + 0.5, SOURCE_RENDER_STYLE.halfSize, SOURCE_RENDER_STYLE.cornerRadius, {
				fill: RENDER_COLORS.structure.sourceBase,
				stroke: RENDER_COLORS.structure.sourceOutline,
				strokeWidth: SOURCE_RENDER_STYLE.outlineWidth,
			});
		} else if (object.type === 'mineral') {
			// Label the mineral with its resource type.
			const mineralType = typeof object.mineralType === 'string' ? object.mineralType : '?';
			const mineralColor = MINERAL_COLORS[mineralType] || DEFAULT_MINERAL_COLOR;
			// Darken the fill while retaining the resource color as its outline.
			const mineralDarkColor = darkenMineralColor(mineralColor);
			circle(ctx, object.x + 0.5, object.y + 0.5, { radius: 0.55, fill: mineralDarkColor, stroke: mineralColor, strokeWidth: 0.1 });
			// Thorium gets the mod's own icon where it is available; the
			// lettering stays the fallback, so the deposit is never unlabelled.
			if (mineralType === 'T' && modImages?.thorium) {
				ctx.drawImage(modImages.thorium, object.x + 0.5 - 0.45, object.y + 0.5 - 0.45, 0.9, 0.9);
			} else {
				text(ctx, mineralType, object.x + 0.5, object.y + 0.80, { font: 0.85, fill: mineralColor });
			}
		} else if (object.type === 'deposit') {
			drawDeposit(ctx, object);
		} else if (object.type === 'controller') {
			// Draw the octagonal base and one triangular segment per level.
			const octagon = [[0.292893, 0], [0.707107, 0], [1, 0.292893], [1, 0.707107], [0.707107, 1], [0.292893, 1], [0, 0.707107], [0, 0.292893],];
			const octagonPoints = octagon.map(([dx, dy]) => [object.x - 0.25 + dx * 1.5, object.y - 0.25 + dy * 1.5]);
			poly(ctx, octagonPoints, { fill: RENDER_COLORS.controller.base, stroke: RENDER_COLORS.controller.outline, strokeWidth: 0.1 });
			const level = Math.min(object.level ?? 0, 8);
			if (level > 0) {
				for (let i = 0; i < level; i++) {
					poly(ctx, [octagonPoints[i], octagonPoints[(i + 1) % 8], [object.x + 0.5, object.y + 0.5]], { fill: RENDER_COLORS.controller.level, stroke: RENDER_COLORS.controller.outline, strokeWidth: 0.1 });
				}
			}
			let controllerColor;
			if (level === 0) {
				controllerColor = RENDER_COLORS.controller.unclaimed;
			} else {
				controllerColor = object.my ? RENDER_COLORS.ownership.bot : RENDER_COLORS.ownership.opponent;
			}
			circle(ctx, object.x + 0.5, object.y + 0.5, { radius: 0.4, fill: controllerColor, stroke: RENDER_COLORS.controller.outline, strokeWidth: 0.05 });
		}
	}
	connectRoads(ctx, roads);
}

export function drawStaticStructures(
	ctx: CanvasRenderingContext2D,
	frame: Frame,
	layout: StageLayout,
	modImages?: ModImages,
): void {
	const objectsByRoom = new Map<string, FrameObject[]>();
	for (const object of frameObjectsInDrawOrder(frame, layout)) {
		if (!layout.offsets[object.room]) continue;
		const roomObjects = objectsByRoom.get(object.room);
		if (roomObjects) roomObjects.push(object);
		else objectsByRoom.set(object.room, [object]);
	}
	for (const room of Object.keys(layout.offsets)) {
		const roomOffset = layout.offsets[room];
		ctx.save();
		ctx.translate(roomOffset.col * ROOM_SIZE_TILES, roomOffset.row * ROOM_SIZE_TILES);
		drawRoomStaticStructures(ctx, objectsByRoom.get(room) || [], modImages);
		ctx.restore();
	}
	drawFlags(ctx, frame.flags, layout);
}

// One room's static structures, its flags and its name, room-local — no
// walls (those are drawn in the terrain pass, see drawRoomTerrainLayer).
// `objects` must already be filtered to this room, in frameObjectsInDrawOrder
// order; `flags` in room-local tile coordinates, as flagsByRoom produces.
export function drawRoomStructureLayer(
	ctx: CanvasRenderingContext2D,
	roomName: string,
	objects: FrameObject[],
	flags: RoomFlag[],
	modImages?: ModImages,
): void {
	drawRoomStaticStructures(ctx, objects, modImages);
	drawRoomFlags(ctx, flags);
	drawRoomName(ctx, roomName);
}

export function constructedWallsIn(objects: readonly FrameObject[]): Array<{ x: number; y: number }> {
	const walls: Array<{ x: number; y: number }> = [];
	for (const object of objects) {
		if (object.type === 'constructedWall') walls.push({ x: object.x, y: object.y });
	}
	return walls;
}

export function drawMergedWalls(
	ctx: CanvasRenderingContext2D,
	terrain: Record<string, string[]>,
	frame: Frame,
	layout: StageLayout,
	wallTexture?: CanvasImageSource,
): void {
	const objectsByRoom = new Map<string, FrameObject[]>();
	for (const object of frame.objects) {
		if (!layout.offsets[object.room]) continue;
		const roomObjects = objectsByRoom.get(object.room);
		if (roomObjects) roomObjects.push(object);
		else objectsByRoom.set(object.room, [object]);
	}
	for (const [roomName, roomOffset] of Object.entries(layout.offsets)) {
		ctx.save();
		ctx.translate(roomOffset.col * ROOM_SIZE_TILES, roomOffset.row * ROOM_SIZE_TILES);
		drawWallIslands(ctx, terrain[roomName] || [], wallTexture, constructedWallsIn(objectsByRoom.get(roomName) || []));
		ctx.restore();
	}
}

// A flag in room-local tile coordinates, as flagsByRoom produces it.
export interface RoomFlag {
	name: string;
	x: number;
	y: number;
}

// Recorded flags use the engine's compact `data` wire string; map previews use
// direct {room,name,x,y} entries. Normalising both here keeps every canvas
// consumer on the replay renderer's visual implementation.
export function flagsByRoom(rawFlags: unknown[], layout: StageLayout): Map<string, RoomFlag[]> {
	const byRoom = new Map<string, RoomFlag[]>();
	for (const value of rawFlags || []) {
		if (!value || typeof value !== 'object') continue;
		const flag = value as Record<string, unknown>;
		const room = typeof flag.room === 'string' ? flag.room : '';
		if (!room || !layout.offsets[room]) continue;
		let flags = byRoom.get(room);
		if (!flags) byRoom.set(room, flags = []);
		if (typeof flag.x === 'number' && typeof flag.y === 'number') {
			flags.push({ name: typeof flag.name === 'string' ? flag.name : 'flag', x: flag.x, y: flag.y });
			continue;
		}
		if (typeof flag.data !== 'string') continue;
		for (const entry of flag.data.split('|').filter(Boolean)) {
			const fields = entry.split('~');
			const x = Number(fields[3]), y = Number(fields[4]);
			if (Number.isFinite(x) && Number.isFinite(y)) flags.push({ name: fields[0] || 'flag', x, y });
		}
	}
	return byRoom;
}

// A room's flags, room-local. A label near the room's left/right edge is
// clamped so its centre stays inside the padded tile (TILE_PADDING_TILES on
// each side): outside that, the flag pole itself is still exactly on-tile,
// only its name shifts.
export function drawRoomFlags(ctx: CanvasRenderingContext2D, flags: RoomFlag[]): void {
	for (const flag of flags) {
		const x = flag.x + 0.5;
		const y = flag.y + 0.5;
		poly(ctx, [[x, y + 0.3], [x, y - 0.5], [x + 0.5, y - 0.3], [x, y - 0.1]],
			{ stroke: RENDER_COLORS.flag.foreground, strokeWidth: 0.08, fill: RENDER_COLORS.flag.fill, opacity: 0.9 });
		const halfLabelWidth = flag.name.length * 0.22 / 2;
		const labelX = Math.min(
			Math.max(x, halfLabelWidth - TILE_PADDING_TILES),
			ROOM_SIZE_TILES + TILE_PADDING_TILES - halfLabelWidth,
		);
		text(ctx, flag.name, labelX, y + 0.85, { font: 0.4, fill: RENDER_COLORS.flag.foreground, opacity: 0.8 });
	}
}

export function drawFlags(ctx: CanvasRenderingContext2D, rawFlags: unknown[], layout: StageLayout): void {
	for (const [room, flags] of flagsByRoom(rawFlags, layout)) {
		const roomOffset = layout.offsets[room];
		ctx.save();
		ctx.translate(roomOffset.col * ROOM_SIZE_TILES, roomOffset.row * ROOM_SIZE_TILES);
		drawRoomFlags(ctx, flags);
		ctx.restore();
	}
}

// One-shot render of a whole scene — the map editor and the scenario preview.
// It shares every drawing routine with the replay; what it does NOT share is
// drawFrame's per-tick pass, so anything drawn only there (a reactor, a dropped
// pile) has to be drawn here too or the editor shows an empty tile where the
// replay shows an object.
export function drawStaticScene(
	ctx: CanvasRenderingContext2D,
	scene: { terrain: Record<string, string[]>; frame: Frame; layout: StageLayout },
	options: { initialSourceEnergy?: boolean; terrainTextures?: TerrainTextures; modImages?: ModImages } = {},
): void {
	drawTerrainScene(ctx, scene.terrain, scene.layout, options.terrainTextures);
	drawMergedWalls(ctx, scene.terrain, scene.frame, scene.layout, options.terrainTextures?.wallNoise);
	drawStaticStructures(ctx, scene.frame, scene.layout, options.modImages);
	for (const object of frameObjectsInDrawOrder(scene.frame, scene.layout)) {
		const roomOffset = scene.layout.offsets[object.room];
		if (!roomOffset) continue;
		const cx = roomOffset.col * ROOM_SIZE_TILES + object.x + 0.5;
		const cy = roomOffset.row * ROOM_SIZE_TILES + object.y + 0.5;
		if (object.type === 'tower') drawTowerTurret(ctx, object, cx, cy, scene.frame.gameTime);
		else if (object.type === 'reactor') drawReactor(ctx, object, cx, cy, scene.frame.gameTime, options.modImages);
		else if (options.initialSourceEnergy && object.type === 'source') drawSourceCore(ctx, object, cx, cy);
		else if (object.type === 'nuker') drawNukerFill(ctx, object, cx, cy);
		else if (object.type === 'nuke') drawNuke(ctx, cx, cy);
		else if (!KNOWN_OBJECT_TYPES.has(object.type)) drawUnknownObject(ctx, object, cx, cy);
	}
	drawRamparts(ctx, scene.frame, scene.layout);
	drawNukeFlights(ctx, scene.frame, scene.layout);
	drawRoomNames(ctx, scene.layout);
}

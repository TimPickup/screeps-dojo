import type { Recording, StageLayout, Frame } from '../api/types.ts';
import { drawStructureShell, connectRoads } from './structures.ts';
import { drawSourceCore, drawTowerTurret } from './dynamic.ts';
import { circle, poly, roundedSquare, text } from './primitives.ts';
import { drawWallIslands } from './terrainWalls.ts';
import { drawSwampIslands } from './terrainSwamps.ts';
import { drawRamparts } from './ramparts.ts';
import { frameObjectsInDrawOrder } from './renderOrder.ts';
import { drawDeposit } from './deposits.ts';
import type { TerrainTextures } from './terrainTextures.ts';
import {
	DEFAULT_MINERAL_COLOR,
	MINERAL_COLORS,
	RENDER_COLORS,
	ROOM_SIZE_TILES,
	SOURCE_RENDER_STYLE,
	STATIC_LAYER_RESOLUTION,
	STRUCTURE_SHELL_TYPES,
} from './renderConstants.ts';

export { STATIC_LAYER_RESOLUTION as STATIC_RES } from './renderConstants.ts';

// One room's immutable ground at room-local integer tile coordinates. Walls
// are drawn in the epoch-cached structure layer so constructed walls can join
// their terrain geometry without adding another per-frame canvas layer.
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

function browserCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function darkenMineralColor(color: string): string {
	const darkenedDigits = color.slice(1).split('').map((hexDigit) => (
		(parseInt(hexDigit, 16) * 0.25 | 0).toString(16)
	));
	return `#${darkenedDigits.join('')}`;
}

function buildStaticCanvas(
	layout: StageLayout,
	resolution: number,
	canvasFactory: CanvasFactory,
	draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
	const widthInTiles = (layout.width / layout.pixelsPerRoom) * ROOM_SIZE_TILES;
	const heightInTiles = (layout.height / layout.pixelsPerRoom) * ROOM_SIZE_TILES;
	const canvas = canvasFactory(
		Math.max(1, Math.round(widthInTiles * resolution)),
		Math.max(1, Math.round(heightInTiles * resolution)),
	);
	const ctx = canvas.getContext('2d')!;
	ctx.scale(resolution, resolution);
	draw(ctx);
	return canvas;
}

export function buildTerrainCanvas(
	recording: Recording,
	layout: StageLayout,
	resolution = STATIC_LAYER_RESOLUTION,
	canvasFactory: CanvasFactory = browserCanvas,
	terrainTextures?: TerrainTextures,
): HTMLCanvasElement {
	return buildStaticCanvas(layout, resolution, canvasFactory, (ctx) => {
		drawTerrainScene(ctx, recording.terrain, layout, terrainTextures);
	});
}

export function drawStaticStructures(
	ctx: CanvasRenderingContext2D,
	frame: Frame,
	layout: StageLayout,
): void {
	const objectsInDrawOrder = frameObjectsInDrawOrder(frame, layout);
	for (const room of Object.keys(layout.offsets)) {
		const roomOffset = layout.offsets[room];
		ctx.save();
		ctx.translate(roomOffset.col * ROOM_SIZE_TILES, roomOffset.row * ROOM_SIZE_TILES);
		const roads: number[][] = [];
		for (const object of objectsInDrawOrder) {
			if (object.room !== room) continue;
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
				text(ctx, mineralType, object.x + 0.5, object.y + 0.80, { font: 0.85, fill: mineralColor });
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
		ctx.restore();
	}
	drawFlags(ctx, frame.flags, layout);
}

export function drawMergedWalls(
	ctx: CanvasRenderingContext2D,
	terrain: Record<string, string[]>,
	frame: Frame,
	layout: StageLayout,
	wallTexture?: CanvasImageSource,
): void {
	const constructedWallsByRoom = new Map<string, Array<{ x: number; y: number }>>();
	for (const object of frame.objects) {
		if (object.type !== 'constructedWall' || !layout.offsets[object.room]) continue;
		const roomWalls = constructedWallsByRoom.get(object.room) || [];
		roomWalls.push({ x: object.x, y: object.y });
		constructedWallsByRoom.set(object.room, roomWalls);
	}
	for (const [roomName, roomOffset] of Object.entries(layout.offsets)) {
		ctx.save();
		ctx.translate(roomOffset.col * ROOM_SIZE_TILES, roomOffset.row * ROOM_SIZE_TILES);
		drawWallIslands(ctx, terrain[roomName] || [], wallTexture, constructedWallsByRoom.get(roomName) || []);
		ctx.restore();
	}
}

// Recorded flags use the engine's compact `data` wire string; map previews use
// direct {room,name,x,y} entries. Normalising both here keeps every canvas
// consumer on the replay renderer's visual implementation.
export function drawFlags(ctx: CanvasRenderingContext2D, rawFlags: unknown[], layout: StageLayout): void {
	const flags: Array<{ room: string; name: string; x: number; y: number }> = [];
	for (const value of rawFlags || []) {
		if (!value || typeof value !== 'object') continue;
		const flag = value as Record<string, unknown>;
		const room = typeof flag.room === 'string' ? flag.room : '';
		if (!room || !layout.offsets[room]) continue;
		if (typeof flag.x === 'number' && typeof flag.y === 'number') {
			flags.push({ room, name: typeof flag.name === 'string' ? flag.name : 'flag', x: flag.x, y: flag.y });
			continue;
		}
		if (typeof flag.data !== 'string') continue;
		for (const entry of flag.data.split('|').filter(Boolean)) {
			const fields = entry.split('~');
			const x = Number(fields[3]), y = Number(fields[4]);
			if (Number.isFinite(x) && Number.isFinite(y)) flags.push({ room, name: fields[0] || 'flag', x, y });
		}
	}
	for (const flag of flags) {
		const roomOffset = layout.offsets[flag.room];
		const x = roomOffset.col * ROOM_SIZE_TILES + flag.x + 0.5;
		const y = roomOffset.row * ROOM_SIZE_TILES + flag.y + 0.5;
		poly(ctx, [[x, y + 0.3], [x, y - 0.5], [x + 0.5, y - 0.3], [x, y - 0.1]],
			{ stroke: RENDER_COLORS.flag.foreground, strokeWidth: 0.08, fill: RENDER_COLORS.flag.fill, opacity: 0.9 });
		text(ctx, flag.name, x, y + 0.85, { font: 0.4, fill: RENDER_COLORS.flag.foreground, opacity: 0.8 });
	}
}

export function drawStaticScene(
	ctx: CanvasRenderingContext2D,
	scene: { terrain: Record<string, string[]>; frame: Frame; layout: StageLayout },
	options: { initialSourceEnergy?: boolean; terrainTextures?: TerrainTextures } = {},
): void {
	drawTerrainScene(ctx, scene.terrain, scene.layout, options.terrainTextures);
	drawMergedWalls(ctx, scene.terrain, scene.frame, scene.layout, options.terrainTextures?.wallNoise);
	drawStaticStructures(ctx, scene.frame, scene.layout);
	for (const object of frameObjectsInDrawOrder(scene.frame, scene.layout)) {
		const roomOffset = scene.layout.offsets[object.room];
		if (!roomOffset) continue;
		const cx = roomOffset.col * ROOM_SIZE_TILES + object.x + 0.5;
		const cy = roomOffset.row * ROOM_SIZE_TILES + object.y + 0.5;
		if (object.type === 'tower') drawTowerTurret(ctx, object, cx, cy, scene.frame.gameTime);
		else if (options.initialSourceEnergy && object.type === 'source') drawSourceCore(ctx, object, cx, cy);
	}
	drawRamparts(ctx, scene.frame, scene.layout);
}

export function buildStructureCanvas(
	frame: Frame,
	layout: StageLayout,
	resolution = STATIC_LAYER_RESOLUTION,
	canvasFactory: CanvasFactory = browserCanvas,
	terrain: Record<string, string[]> = {},
	wallTexture?: CanvasImageSource,
): HTMLCanvasElement {
	return buildStaticCanvas(layout, resolution, canvasFactory, (ctx) => {
		drawMergedWalls(ctx, terrain, frame, layout, wallTexture);
		drawStaticStructures(ctx, frame, layout);
	});
}

export function buildRampartCanvas(
	frame: Frame,
	layout: StageLayout,
	resolution = STATIC_LAYER_RESOLUTION,
	canvasFactory: CanvasFactory = browserCanvas,
): HTMLCanvasElement {
	return buildStaticCanvas(layout, resolution, canvasFactory, (ctx) => {
		drawRamparts(ctx, frame, layout);
	});
}

import type { StageLayout } from '../api/types.ts';
import { RENDER_COLORS, ROOM_SIZE_TILES, SWAMP_RENDER_STYLE, WALL_RENDER_STYLE } from './renderConstants.ts';
import {
	appendIslandBoundaryPaths,
	appendIslandFillPaths,
	buildTerrainIslands,
	type TerrainIsland,
} from './terrainIslands.ts';
import type { CanvasPathFactory } from './terrainTextures.ts';
import { wallIslandsFor, type WallTile } from './terrainWalls.ts';

interface RoomSwampPath {
	name: string;
	col: number;
	row: number;
	path: Path2D;
	rows: string[];
	constructedWalls: readonly WallTile[];
	// The room square with its wall islands cut out (evenodd), or null when the
	// room has no walls. Undefined until first needed after a wall change.
	wallHole?: Path2D | null;
}

interface PatternPair {
	first: CanvasPattern;
	second: CanvasPattern;
}

export function buildSwampIslands(rows: string[]): TerrainIsland[] {
	return buildTerrainIslands(rows, '~');
}

// Terrain rows never change for a recording, so each room's swamp islands are
// traced once and shared by every tile LOD and every rebuild. Keyed by the rows
// array itself; callers treat the islands as read-only.
const swampIslandsByRows = new WeakMap<string[], TerrainIsland[]>();
function swampIslandsFor(rows: string[]): TerrainIsland[] {
	let islands = swampIslandsByRows.get(rows);
	if (!islands) swampIslandsByRows.set(rows, islands = buildSwampIslands(rows));
	return islands;
}

function beginFillPaths(ctx: CanvasRenderingContext2D, islands: TerrainIsland[]): void {
	ctx.beginPath();
	appendIslandFillPaths(ctx, islands, SWAMP_RENDER_STYLE.cornerRadius);
}

function beginBoundaryPaths(ctx: CanvasRenderingContext2D, islands: TerrainIsland[]): void {
	ctx.beginPath();
	appendIslandBoundaryPaths(ctx, islands, SWAMP_RENDER_STYLE.cornerRadius);
}

function drawStaticTexture(ctx: CanvasRenderingContext2D, texture: CanvasImageSource): void {
	ctx.globalAlpha = SWAMP_RENDER_STYLE.textureOpacity;
	ctx.globalCompositeOperation = 'multiply';
	ctx.imageSmoothingEnabled = true;
	const textureSize = ROOM_SIZE_TILES / SWAMP_RENDER_STYLE.textureRepeatsPerRoom;
	for (let y = 0; y < ROOM_SIZE_TILES; y += textureSize) {
		for (let x = 0; x < ROOM_SIZE_TILES; x += textureSize) {
			ctx.drawImage(texture, x, y, textureSize, textureSize);
		}
	}
}

export function drawSwampIslands(
	ctx: CanvasRenderingContext2D,
	rows: string[],
	staticTexture?: CanvasImageSource,
): void {
	const islands = swampIslandsFor(rows);
	if (islands.length === 0) return;

	ctx.save();
	beginFillPaths(ctx, islands);
	ctx.fillStyle = RENDER_COLORS.terrain.swamp;
	ctx.fill();
	if (staticTexture) {
		ctx.clip();
		drawStaticTexture(ctx, staticTexture);
	}
	ctx.restore();

	ctx.save();
	beginBoundaryPaths(ctx, islands);
	ctx.strokeStyle = RENDER_COLORS.terrain.swampOutline;
	ctx.lineWidth = SWAMP_RENDER_STYLE.outlineWidth;
	ctx.lineCap = 'butt';
	ctx.lineJoin = 'round';
	ctx.stroke();
	ctx.restore();
}

function imageWidth(image: CanvasImageSource): number {
	const dimensions = image as unknown as { naturalWidth?: number; width?: number };
	return dimensions.naturalWidth || dimensions.width || 1;
}

function imageHeight(image: CanvasImageSource): number {
	const dimensions = image as unknown as { naturalHeight?: number; height?: number };
	return dimensions.naturalHeight || dimensions.height || 1;
}

function wrappedOffset(value: number): number {
	return ((value % ROOM_SIZE_TILES) + ROOM_SIZE_TILES) % ROOM_SIZE_TILES;
}

export class AnimatedSwampRenderer {
	private readonly rooms: RoomSwampPath[] = [];
	private readonly roomsByName = new Map<string, RoomSwampPath>();
	private readonly pathFactory: CanvasPathFactory;
	private readonly textures: readonly [CanvasImageSource, CanvasImageSource];
	private readonly patternsByContext = new WeakMap<CanvasRenderingContext2D, PatternPair>();

	constructor(
		terrain: Record<string, string[]>,
		layout: StageLayout,
		textures: readonly [CanvasImageSource, CanvasImageSource],
		pathFactory: CanvasPathFactory,
	) {
		this.textures = textures;
		this.pathFactory = pathFactory;
		for (const [roomName, rows] of Object.entries(terrain)) {
			const offset = layout.offsets[roomName];
			if (!offset) continue;
			const islands = swampIslandsFor(rows);
			if (islands.length === 0) continue;
			const path = pathFactory();
			appendIslandFillPaths(path, islands, SWAMP_RENDER_STYLE.cornerRadius);
			const room: RoomSwampPath = { name: roomName, col: offset.col, row: offset.row, path, rows, constructedWalls: [] };
			this.rooms.push(room);
			this.roomsByName.set(roomName, room);
		}
	}

	// The walls are drawn under this pass (in the terrain tile), so the moving
	// texture must not multiply over them: over a constructed wall on a swamp
	// tile it would tint and shimmer the whole wall. The caller keeps each room's
	// constructed walls current (StaticLayers.sync).
	setConstructedWalls(roomName: string, constructedWalls: readonly WallTile[]): void {
		const room = this.roomsByName.get(roomName);
		if (!room) return;
		room.constructedWalls = constructedWalls;
		room.wallHole = undefined;
	}

	private wallHole(room: RoomSwampPath): Path2D | null {
		if (room.wallHole !== undefined) return room.wallHole;
		const islands = wallIslandsFor(room.rows, room.constructedWalls);
		if (islands.length === 0) return room.wallHole = null;
		const hole = this.pathFactory();
		hole.rect(0, 0, ROOM_SIZE_TILES, ROOM_SIZE_TILES);
		appendIslandFillPaths(hole, islands, WALL_RENDER_STYLE.cornerRadius);
		return room.wallHole = hole;
	}

	private patterns(ctx: CanvasRenderingContext2D): PatternPair {
		let patterns = this.patternsByContext.get(ctx);
		if (!patterns) {
			const first = ctx.createPattern(this.textures[0], 'repeat');
			const second = ctx.createPattern(this.textures[1], 'repeat');
			if (!first || !second) throw new Error('Could not create animated swamp texture patterns');
			patterns = { first, second };
			this.patternsByContext.set(ctx, patterns);
		}
		return patterns;
	}

	// `rooms` limits the pass to those rooms (the visible ones); omitted, every room.
	draw(ctx: CanvasRenderingContext2D, animationTime: number, rooms?: Set<string>): void {
		if (this.rooms.length === 0) return;
		const patterns = this.patterns(ctx);
		for (const room of this.rooms) {
			if (rooms && !rooms.has(room.name)) continue;
			ctx.save();
			ctx.translate(room.col * ROOM_SIZE_TILES, room.row * ROOM_SIZE_TILES);
			const hole = this.wallHole(room);
			if (hole) ctx.clip(hole, 'evenodd');
			ctx.globalAlpha = SWAMP_RENDER_STYLE.textureOpacity;
			ctx.globalCompositeOperation = 'multiply';
			for (let layerIndex = 0; layerIndex < SWAMP_RENDER_STYLE.textureLayers.length; layerIndex++) {
				const velocity = SWAMP_RENDER_STYLE.textureLayers[layerIndex];
				const pattern = layerIndex === 0 ? patterns.first : patterns.second;
				const texture = this.textures[layerIndex];
				const patternScaleX = ROOM_SIZE_TILES
					/ (imageWidth(texture) * SWAMP_RENDER_STYLE.textureRepeatsPerRoom);
				const patternScaleY = ROOM_SIZE_TILES
					/ (imageHeight(texture) * SWAMP_RENDER_STYLE.textureRepeatsPerRoom);
				pattern.setTransform({
					a: patternScaleX,
					b: 0,
					c: 0,
					d: patternScaleY,
					e: wrappedOffset(animationTime * velocity.velocityX),
					f: wrappedOffset(animationTime * velocity.velocityY),
				});
				ctx.fillStyle = pattern;
				ctx.fill(room.path);
			}
			ctx.restore();
		}
	}
}

import type { StageLayout } from '../api/types.ts';
import { RENDER_COLORS, ROOM_SIZE_TILES, SWAMP_RENDER_STYLE } from './renderConstants.ts';
import {
	appendIslandBoundaryPaths,
	appendIslandFillPaths,
	buildTerrainIslands,
	type TerrainIsland,
} from './terrainIslands.ts';
import type { CanvasPathFactory } from './terrainTextures.ts';

interface RoomSwampPath {
	col: number;
	row: number;
	path: Path2D;
}

interface PatternPair {
	first: CanvasPattern;
	second: CanvasPattern;
}

export function buildSwampIslands(rows: string[]): TerrainIsland[] {
	return buildTerrainIslands(rows, '~');
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
	const islands = buildSwampIslands(rows);
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
	private readonly textures: readonly [CanvasImageSource, CanvasImageSource];
	private readonly patternsByContext = new WeakMap<CanvasRenderingContext2D, PatternPair>();

	constructor(
		terrain: Record<string, string[]>,
		layout: StageLayout,
		textures: readonly [CanvasImageSource, CanvasImageSource],
		pathFactory: CanvasPathFactory,
	) {
		this.textures = textures;
		for (const [roomName, rows] of Object.entries(terrain)) {
			const offset = layout.offsets[roomName];
			if (!offset) continue;
			const islands = buildSwampIslands(rows);
			if (islands.length === 0) continue;
			const path = pathFactory();
			appendIslandFillPaths(path, islands, SWAMP_RENDER_STYLE.cornerRadius);
			this.rooms.push({ col: offset.col, row: offset.row, path });
		}
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

	draw(ctx: CanvasRenderingContext2D, animationTime: number): void {
		if (this.rooms.length === 0) return;
		const patterns = this.patterns(ctx);
		for (const room of this.rooms) {
			ctx.save();
			ctx.translate(room.col * ROOM_SIZE_TILES, room.row * ROOM_SIZE_TILES);
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

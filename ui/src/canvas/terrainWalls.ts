import { RENDER_COLORS, ROOM_SIZE_TILES, WALL_RENDER_STYLE } from './renderConstants.ts';
import {
	appendIslandBoundaryPaths,
	appendIslandFillPaths,
	buildTerrainIslands,
	type TerrainContour,
	type TerrainIsland,
	type TerrainPoint,
} from './terrainIslands.ts';

export type WallPoint = TerrainPoint;
export type WallContour = TerrainContour;
export type WallIsland = TerrainIsland;

export function buildWallIslands(rows: string[]): WallIsland[] {
	return buildTerrainIslands(rows, '#');
}

function beginFillPaths(ctx: CanvasRenderingContext2D, islands: WallIsland[]): void {
	ctx.beginPath();
	appendIslandFillPaths(ctx, islands, WALL_RENDER_STYLE.cornerRadius);
}

function beginBoundaryPaths(ctx: CanvasRenderingContext2D, islands: WallIsland[]): void {
	ctx.beginPath();
	appendIslandBoundaryPaths(ctx, islands, WALL_RENDER_STYLE.cornerRadius);
}

function strokeBoundaries(
	ctx: CanvasRenderingContext2D,
	islands: WallIsland[],
	color: string,
	width: number,
): void {
	beginBoundaryPaths(ctx, islands);
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = 'butt';
	ctx.lineJoin = 'round';
	ctx.stroke();
}

function drawRoomTexture(ctx: CanvasRenderingContext2D, texture: CanvasImageSource): void {
	ctx.imageSmoothingEnabled = true;
	ctx.globalAlpha = WALL_RENDER_STYLE.textureOpacity;
	ctx.globalCompositeOperation = 'source-over';
	ctx.drawImage(texture, 0, 0, ROOM_SIZE_TILES, ROOM_SIZE_TILES);
}

export function drawWallIslands(
	ctx: CanvasRenderingContext2D,
	rows: string[],
	texture?: CanvasImageSource,
): void {
	const islands = buildWallIslands(rows);
	if (islands.length === 0) return;

	ctx.save();
	strokeBoundaries(
		ctx,
		islands,
		RENDER_COLORS.terrain.wallOuterShadow,
		WALL_RENDER_STYLE.outerShadowWidth,
	);
	ctx.restore();

	ctx.save();
	beginFillPaths(ctx, islands);
	ctx.fillStyle = RENDER_COLORS.terrain.wall;
	ctx.fill();
	if (texture) {
		ctx.clip();
		drawRoomTexture(ctx, texture);
	}
	ctx.restore();

	ctx.save();
	beginFillPaths(ctx, islands);
	ctx.clip();
	strokeBoundaries(
		ctx,
		islands,
		RENDER_COLORS.terrain.wallInnerGlow,
		WALL_RENDER_STYLE.innerGlowWidth,
	);
	strokeBoundaries(
		ctx,
		islands,
		RENDER_COLORS.terrain.wallInnerHighlight,
		WALL_RENDER_STYLE.innerHighlightWidth,
	);
	ctx.restore();

	ctx.save();
	strokeBoundaries(
		ctx,
		islands,
		RENDER_COLORS.terrain.wallOutline,
		WALL_RENDER_STYLE.outlineWidth,
	);
	ctx.restore();
}

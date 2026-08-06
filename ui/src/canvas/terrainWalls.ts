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
export type WallTile = TerrainPoint;

export function buildWallIslands(rows: string[], constructedWalls: readonly WallTile[] = []): WallIsland[] {
	return buildTerrainIslands(rows, '#', constructedWalls);
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

function drawConstructedWallMarkers(
	ctx: CanvasRenderingContext2D,
	islands: WallIsland[],
	constructedWalls: readonly WallTile[],
): void {
	if (constructedWalls.length === 0) return;
	ctx.save();
	beginFillPaths(ctx, islands);
	ctx.clip();
	ctx.beginPath();
	for (const wall of constructedWalls) {
		for (const marker of WALL_RENDER_STYLE.constructedMarkers) {
			ctx.moveTo(wall.x + marker.startX, wall.y + marker.y);
			ctx.lineTo(wall.x + marker.startX + marker.length, wall.y + marker.y);
		}
	}
	ctx.strokeStyle = RENDER_COLORS.terrain.constructedWallMarker;
	ctx.lineWidth = WALL_RENDER_STYLE.constructedMarkerWidth;
	ctx.lineCap = 'butt';
	ctx.stroke();
	ctx.restore();
}

export function drawWallIslands(
	ctx: CanvasRenderingContext2D,
	rows: string[],
	texture?: CanvasImageSource,
	constructedWalls: readonly WallTile[] = [],
): void {
	const islands = buildWallIslands(rows, constructedWalls);
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

	drawConstructedWallMarkers(ctx, islands, constructedWalls);
}

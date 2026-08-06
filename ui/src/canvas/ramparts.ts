import type { Frame, FrameObject, StageLayout } from '../api/types.ts';
import {
	appendIslandBoundaryPaths,
	appendIslandFillPaths,
	buildTileIslands,
	type TerrainIsland,
	type TerrainPoint,
} from './terrainIslands.ts';
import { RAMPART_RENDER_STYLE, RENDER_COLORS, ROOM_SIZE_TILES } from './renderConstants.ts';

export type RampartTile = TerrainPoint;

export interface RampartGroups {
	ownPrivate: RampartTile[];
	otherPrivate: RampartTile[];
	ownPublic: RampartTile[];
	otherPublic: RampartTile[];
}

function emptyRampartGroups(): RampartGroups {
	return { ownPrivate: [], otherPrivate: [], ownPublic: [], otherPublic: [] };
}

function addRampart(groups: RampartGroups, rampart: FrameObject): void {
	const tile = { x: rampart.x, y: rampart.y };
	if (rampart.isPublic === true) {
		(rampart.my ? groups.ownPublic : groups.otherPublic).push(tile);
	} else {
		(rampart.my ? groups.ownPrivate : groups.otherPrivate).push(tile);
	}
}

export function partitionRamparts(objects: readonly FrameObject[]): RampartGroups {
	const groups = emptyRampartGroups();
	for (const object of objects) {
		if (object.type === 'rampart') addRampart(groups, object);
	}
	return groups;
}

export function buildRampartIslands(tiles: readonly RampartTile[]): TerrainIsland[] {
	return buildTileIslands(tiles);
}

function beginFillPaths(ctx: CanvasRenderingContext2D, islands: TerrainIsland[]): void {
	ctx.beginPath();
	appendIslandFillPaths(ctx, islands, RAMPART_RENDER_STYLE.cornerRadius);
}

function beginBoundaryPaths(ctx: CanvasRenderingContext2D, islands: TerrainIsland[]): void {
	ctx.beginPath();
	appendIslandBoundaryPaths(ctx, islands, RAMPART_RENDER_STYLE.cornerRadius);
}

function drawPrivateRamparts(
	ctx: CanvasRenderingContext2D,
	tiles: readonly RampartTile[],
	color: string,
): void {
	const islands = buildRampartIslands(tiles);
	if (islands.length === 0) return;
	ctx.save();
	beginFillPaths(ctx, islands);
	ctx.fillStyle = color;
	ctx.globalAlpha = RAMPART_RENDER_STYLE.fillOpacity;
	ctx.fill();
	beginBoundaryPaths(ctx, islands);
	ctx.strokeStyle = color;
	ctx.globalAlpha = RAMPART_RENDER_STYLE.outlineOpacity;
	ctx.lineWidth = RAMPART_RENDER_STYLE.outlineWidth;
	ctx.lineCap = 'butt';
	ctx.lineJoin = 'round';
	ctx.stroke();
	ctx.restore();
}

function drawPublicRamparts(
	ctx: CanvasRenderingContext2D,
	tiles: readonly RampartTile[],
	color: string,
): void {
	if (tiles.length === 0) return;
	const markerHalfLength = RAMPART_RENDER_STYLE.publicMarkerLength / 2;
	ctx.save();
	ctx.beginPath();
	for (const tile of tiles) {
		const centerX = tile.x + 0.5;
		const centerY = tile.y + 0.5;
		ctx.moveTo(centerX - markerHalfLength, centerY);
		ctx.lineTo(centerX + markerHalfLength, centerY);
		ctx.moveTo(centerX, centerY - markerHalfLength);
		ctx.lineTo(centerX, centerY + markerHalfLength);
	}
	ctx.strokeStyle = color;
	ctx.globalAlpha = RAMPART_RENDER_STYLE.publicMarkerOpacity;
	ctx.lineWidth = RAMPART_RENDER_STYLE.publicMarkerWidth;
	ctx.lineCap = 'butt';
	ctx.stroke();
	ctx.restore();
}

function drawRampartGroups(ctx: CanvasRenderingContext2D, groups: RampartGroups): void {
	drawPrivateRamparts(ctx, groups.ownPrivate, RENDER_COLORS.rampart.own);
	drawPrivateRamparts(ctx, groups.otherPrivate, RENDER_COLORS.rampart.other);
	drawPublicRamparts(ctx, groups.ownPublic, RENDER_COLORS.rampart.own);
	drawPublicRamparts(ctx, groups.otherPublic, RENDER_COLORS.rampart.other);
}

export function drawRamparts(
	ctx: CanvasRenderingContext2D,
	frame: Frame,
	layout: StageLayout,
): void {
	const groupsByRoom = new Map<string, RampartGroups>();
	for (const object of frame.objects) {
		if (object.type !== 'rampart' || !layout.offsets[object.room]) continue;
		const groups = groupsByRoom.get(object.room) || emptyRampartGroups();
		addRampart(groups, object);
		groupsByRoom.set(object.room, groups);
	}
	for (const [roomName, groups] of groupsByRoom) {
		const roomOffset = layout.offsets[roomName];
		ctx.save();
		ctx.translate(roomOffset.col * ROOM_SIZE_TILES, roomOffset.row * ROOM_SIZE_TILES);
		drawRampartGroups(ctx, groups);
		ctx.restore();
	}
}

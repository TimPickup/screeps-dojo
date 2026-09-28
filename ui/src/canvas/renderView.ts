import type { StageLayout } from '../api/types.ts';
import { RENDER_DETAIL_THRESHOLDS, ROOM_SIZE_TILES } from './renderConstants.ts';

// What part of the world is on screen, in world tiles, and how many device
// pixels one tile covers. Everything that scales work with zoom reads this.
export interface RenderView { minX: number; minY: number; maxX: number; maxY: number; pixelsPerTile: number }
export type DetailLevel = 'full' | 'simple' | 'minimal';

export function viewFromTransform(canvasWidth: number, canvasHeight: number, scale: number, tx: number, ty: number, dpr: number): RenderView {
	const pixelsPerTile = scale * dpr;
	const offsetX = tx * dpr, offsetY = ty * dpr;
	return {
		minX: (0 - offsetX) / pixelsPerTile,
		minY: (0 - offsetY) / pixelsPerTile,
		maxX: (canvasWidth - offsetX) / pixelsPerTile,
		maxY: (canvasHeight - offsetY) / pixelsPerTile,
		pixelsPerTile,
	};
}

export function visibleRooms(layout: StageLayout, view: RenderView | undefined): Set<string> {
	const rooms = new Set<string>();
	for (const [room, offset] of Object.entries(layout.offsets)) {
		if (!view) { rooms.add(room); continue; }
		const x0 = offset.col * ROOM_SIZE_TILES, y0 = offset.row * ROOM_SIZE_TILES;
		if (x0 < view.maxX && x0 + ROOM_SIZE_TILES > view.minX && y0 < view.maxY && y0 + ROOM_SIZE_TILES > view.minY) rooms.add(room);
	}
	return rooms;
}

export function lodLevels(maxResolution: number): number[] {
	const levels = [maxResolution];
	while (levels[levels.length - 1] / 2 >= 1) levels.push(levels[levels.length - 1] / 2);
	return levels;
}

export function pickLod(levels: number[], pixelsPerTile: number): number {
	let best = levels[0];
	for (const level of levels) if (level >= pixelsPerTile && level < best) best = level;
	return best;
}

export function detailLevel(view: RenderView | undefined): DetailLevel {
	if (!view || view.pixelsPerTile >= RENDER_DETAIL_THRESHOLDS.full) return 'full';
	return view.pixelsPerTile >= RENDER_DETAIL_THRESHOLDS.simple ? 'simple' : 'minimal';
}

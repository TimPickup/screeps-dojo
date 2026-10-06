import type { DetailLevel } from './renderView.ts';

// Everything that can change the picture the render loop draws. If two
// consecutive frames compose equal states, the second one is skipped.
// Object fields compare by identity: the recording object stays the same while
// a live recording grows, so frameCount carries that; layers are replaced when
// fonts, textures or mod images arrive, and layersVersion bumps when a tile is
// built or invalidated.
//
// No clock is needed: every animation is a function of tick + sub. Paused
// (sub null) the swamps are drawn at frameIndex + 0, so they stand still.
export interface DrawState {
	layers: object;
	recording: object;
	frameCount: number;
	tick: number;
	sub: number | null;
	scale: number;
	tx: number;
	ty: number;
	dpr: number;
	width: number;
	height: number;
	resizeEpoch: number;
	selectedId: string | null;
	showVisuals: boolean;
	showMapVisuals: boolean;
	smoothTurns: boolean;
	modImages: object | null;
	powerImages: object | null;
	layersVersion: number;
}

// Interpolate between ticks while playing, except when the map is zoomed so
// far out that creeps are dots a pixel or two across: then draw once per tick.
export function shouldAnimate(detail: DetailLevel, playing: boolean): boolean {
	return playing && detail !== 'minimal';
}

export function needsRedraw(prev: DrawState | null, next: DrawState): boolean {
	if (!prev) return true;
	for (const key of Object.keys(next) as (keyof DrawState)[]) {
		if (!Object.is(prev[key], next[key])) return true;
	}
	return false;
}

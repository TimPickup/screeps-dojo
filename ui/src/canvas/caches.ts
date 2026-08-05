import type { Frame, Recording, StageLayout } from '../api/types.ts';
import { buildTerrainCanvas, buildStructureCanvas, type CanvasFactory } from './staticLayers.ts';
import { populateFrameMy } from './ownership.ts';
import { STATIC_LAYER_OBJECT_TYPES, STATIC_LAYER_RESOLUTION } from './renderConstants.ts';

// ---- Per-epoch static-scene background cache ----
// Epoch = a run of frames with the same structure layout. Key excludes
// energy/progress (those would change every tick); minor in-epoch staleness of
// energy fills is accepted by the cached static layer.
export function epochKey(frame: Frame): string {
	const parts: string[] = [];
	for (const object of frame.objects) {
		if (!STATIC_LAYER_OBJECT_TYPES.has(object.type)) continue;
		parts.push(object.type + ',' + object.room + ',' + object.x + ',' + object.y + ',' + (object.level ?? '') + ',' + (object.user ?? ''));
	}
	for (const flag of frame.flags || []) parts.push('flag,' + JSON.stringify(flag));
	parts.sort();
	return parts.join('|');
}

export class StaticLayers {
	terrain: HTMLCanvasElement;
	structure: HTMLCanvasElement;
	private key: string;
	private layout: StageLayout;
	private resolution: number;
	private canvasFactory?: CanvasFactory;
	private botUserId?: string;

	constructor(recording: Recording, layout: StageLayout, resolution = STATIC_LAYER_RESOLUTION, canvasFactory?: CanvasFactory) {
		this.layout = layout;
		this.resolution = resolution;
		this.canvasFactory = canvasFactory;
		this.botUserId = recording.meta.botUserId;
		this.terrain = buildTerrainCanvas(recording, layout, resolution, canvasFactory);
		const firstFrame = recording.frames[0];
		this.prepare(firstFrame);
		this.key = epochKey(firstFrame);
		this.structure = buildStructureCanvas(firstFrame, layout, resolution, canvasFactory);
	}

	prepare(frame: Frame): void {
		populateFrameMy(frame, this.botUserId);
	}

	// Rebuild the structure layer only when the structure set changes.
	sync(frame: Frame): void {
		this.prepare(frame);
		const nextKey = epochKey(frame);
		if (nextKey !== this.key) {
			this.key = nextKey;
			this.structure = buildStructureCanvas(frame, this.layout, this.resolution, this.canvasFactory);
		}
	}
}

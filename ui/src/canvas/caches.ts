import type { Frame, Recording, StageLayout } from '../api/types.ts';
import {
	buildRampartCanvas,
	buildTerrainCanvas,
	buildStructureCanvas,
	type CanvasFactory,
} from './staticLayers.ts';
import { populateFrameMy } from './ownership.ts';
import { STATIC_LAYER_OBJECT_TYPES, STATIC_LAYER_RESOLUTION, SWAMP_RENDER_STYLE } from './renderConstants.ts';
import { AnimatedSwampRenderer } from './terrainSwamps.ts';
import type { TerrainRenderResources, TerrainTextures } from './terrainTextures.ts';

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

export function rampartEpochKey(frame: Frame): string {
	const parts: string[] = [];
	for (const object of frame.objects) {
		if (object.type !== 'rampart') continue;
		parts.push([
			object.room,
			object.x,
			object.y,
			object.my ? 'own' : 'other',
			object.isPublic === true ? 'public' : 'private',
		].join(','));
	}
	parts.sort();
	return parts.join('|');
}

export class StaticLayers {
	terrain: HTMLCanvasElement;
	structure: HTMLCanvasElement;
	rampart: HTMLCanvasElement | null;
	private structureKey: string;
	private rampartKey: string;
	private layout: StageLayout;
	private resolution: number;
	private canvasFactory?: CanvasFactory;
	private botUserId?: string;
	private animatedSwamps?: AnimatedSwampRenderer;
	private terrainRowsByRoom: Record<string, string[]>;
	private wallTexture?: CanvasImageSource;

	constructor(
		recording: Recording,
		layout: StageLayout,
		resolution = STATIC_LAYER_RESOLUTION,
		canvasFactory?: CanvasFactory,
		terrainResources: TerrainRenderResources = {},
	) {
		this.layout = layout;
		this.resolution = resolution;
		this.canvasFactory = canvasFactory;
		this.botUserId = recording.meta.botUserId;
		this.terrainRowsByRoom = recording.terrain;
		this.wallTexture = terrainResources.textures?.wallNoise;
		const firstSwampTexture = terrainResources.textures?.swampNoise1;
		const secondSwampTexture = terrainResources.textures?.swampNoise2;
		const animateSwamps = SWAMP_RENDER_STYLE.animated
			&& Boolean(firstSwampTexture)
			&& Boolean(secondSwampTexture);
		let cachedTerrainTextures = terrainResources.textures;
		if (animateSwamps && cachedTerrainTextures) {
			cachedTerrainTextures = {
				...cachedTerrainTextures,
				swampNoise1: undefined,
				swampNoise2: undefined,
			} satisfies TerrainTextures;
		}
		this.terrain = buildTerrainCanvas(recording, layout, resolution, canvasFactory, cachedTerrainTextures);
		if (animateSwamps && firstSwampTexture && secondSwampTexture) {
			const pathFactory = terrainResources.pathFactory || (() => new Path2D());
			this.animatedSwamps = new AnimatedSwampRenderer(
				recording.terrain,
				layout,
				[firstSwampTexture, secondSwampTexture],
				pathFactory,
			);
		}
		const firstFrame = recording.frames[0];
		this.prepare(firstFrame);
		this.structureKey = epochKey(firstFrame);
		this.rampartKey = rampartEpochKey(firstFrame);
		this.structure = buildStructureCanvas(
			firstFrame,
			layout,
			resolution,
			canvasFactory,
			this.terrainRowsByRoom,
			this.wallTexture,
		);
		this.rampart = this.rampartKey
			? buildRampartCanvas(firstFrame, layout, resolution, canvasFactory)
			: null;
	}

	prepare(frame: Frame): void {
		populateFrameMy(frame, this.botUserId);
	}

	drawSwamps(ctx: CanvasRenderingContext2D, animationTime: number): void {
		this.animatedSwamps?.draw(ctx, animationTime);
	}

	// Rebuild each cached overlay only when its own visual layout changes.
	sync(frame: Frame): void {
		this.prepare(frame);
		const nextStructureKey = epochKey(frame);
		if (nextStructureKey !== this.structureKey) {
			this.structureKey = nextStructureKey;
			this.structure = buildStructureCanvas(
				frame,
				this.layout,
				this.resolution,
				this.canvasFactory,
				this.terrainRowsByRoom,
				this.wallTexture,
			);
		}
		const nextRampartKey = rampartEpochKey(frame);
		if (nextRampartKey !== this.rampartKey) {
			this.rampartKey = nextRampartKey;
			this.rampart = nextRampartKey
				? buildRampartCanvas(frame, this.layout, this.resolution, this.canvasFactory)
				: null;
		}
	}
}

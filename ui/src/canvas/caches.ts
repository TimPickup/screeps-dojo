import type { Frame, FrameObject, Recording, StageLayout } from '../api/types.ts';
import {
	constructedWallsIn,
	drawRoomStructureLayer,
	drawRoomTerrainLayer,
	flagsByRoom,
	type CanvasFactory,
	type RoomFlag,
} from './staticLayers.ts';
import { drawRoomRamparts } from './ramparts.ts';
import { drawWallIslands } from './terrainWalls.ts';
import { populateFrameMy } from './ownership.ts';
import { objectsByRoom, roomRampartKeys, roomStructureKeys, roomTerrainKeys } from './roomIndex.ts';
import {
	ROOM_SIZE_TILES,
	STATIC_LAYER_RESOLUTION,
	SWAMP_RENDER_STYLE,
	TILE_CACHE_BUDGET_BYTES,
	TILE_PADDING_TILES,
} from './renderConstants.ts';
import { detailLevel, lodLevels, pickLod, visibleRooms, type RenderView } from './renderView.ts';
import { RoomTileCache, type TileImage, type TileLayer } from './roomTiles.ts';
import { createTileCanvas } from './browserTileFinish.ts';
import { AnimatedSwampRenderer } from './terrainSwamps.ts';
import type { ModImages } from './modImages.ts';
import type { TerrainRenderResources, TerrainTextures } from './terrainTextures.ts';

export interface StaticLayerResources extends TerrainRenderResources {
	// Turns a painted tile canvas into what gets drawn (see RoomTileCache).
	// Browser: finishTile from browserTileFinish.ts. Absent: the canvas itself.
	finish?: (canvas: HTMLCanvasElement) => TileImage;
}

const TILE_PADDING: Record<TileLayer, number> = {
	terrain: 0,
	structure: TILE_PADDING_TILES,
	rampart: TILE_PADDING_TILES,
};
const TILE_LAYERS: readonly TileLayer[] = ['terrain', 'structure', 'rampart'];
const BYTES_PER_PIXEL = 4;
// Share of TILE_CACHE_BUDGET_BYTES the tiles on screen may take (see lodFor).
const VISIBLE_TILE_BUDGET_SHARE = 0.75;
// Shared so the wall-island memo (keyed by the rows array) also hits for a
// room the recording has no terrain for.
const NO_TERRAIN_ROWS: string[] = [];
const NO_OBJECTS: FrameObject[] = [];

interface ViewPlan {
	view: RenderView;
	rooms: Set<string>;
	lod: number;
}

// The static map (terrain + walls, structures, ramparts), cached per room.
//
// Two tile caches share the painters:
// - No-view mode (no `view` argument: the video renderer and tests) draws every
//   room at `resolution`, building synchronously. That is the cache's only
//   LOD, so also its lowest: every tile is pinned (no byte budget, no
//   eviction) and an invalidation repaints it at once, as the old whole-map
//   canvases were rebuilt.
// - View mode (the browser) draws only the visible rooms, at the LOD the zoom
//   needs, building within pump()'s per-frame budget and drawing the nearest
//   built tile meanwhile.
export class StaticLayers {
	private readonly layout: StageLayout;
	private readonly resolution: number;
	private readonly botUserId?: string;
	private readonly terrainRowsByRoom: Record<string, string[]>;
	private readonly cachedTerrainTextures?: TerrainTextures;
	private readonly wallTexture?: CanvasImageSource;
	private readonly modImages?: ModImages;
	private readonly animatedSwamps?: AnimatedSwampRenderer;
	private readonly allRooms: string[];
	private readonly levels: number[];
	private readonly exportTiles: RoomTileCache;
	private readonly viewTiles: RoomTileCache;
	// The last synced frame and what is derived from it. The painters read
	// these, so sync() updates them before any invalidate(), which repaints
	// pinned tiles on the spot.
	private frame: Frame;
	private flags: Map<string, RoomFlag[]>;
	private terrainKeys: Map<string, string>;
	private structureKeys: Map<string, string>;
	private rampartKeys: Map<string, string>;
	// Visible rooms and LOD for the last view seen. Every layer of one
	// animation frame draws with the same (never mutated) view object, so this
	// is worked out once per frame.
	private plan?: ViewPlan;

	constructor(
		recording: Recording,
		layout: StageLayout,
		resolution = STATIC_LAYER_RESOLUTION,
		canvasFactory: CanvasFactory = createTileCanvas,
		terrainResources: StaticLayerResources = {},
	) {
		this.layout = layout;
		this.resolution = resolution;
		this.botUserId = recording.meta.botUserId;
		this.terrainRowsByRoom = recording.terrain;
		this.wallTexture = terrainResources.textures?.wallNoise;
		this.modImages = terrainResources.modImages;
		this.allRooms = Object.keys(layout.offsets);
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
		this.cachedTerrainTextures = cachedTerrainTextures;
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
		// prepare() fills in object.my, which the rampart key reads, and keys are
		// cached per frame: it must run before any key is computed.
		this.prepare(firstFrame);
		this.frame = firstFrame;
		this.flags = flagsByRoom(firstFrame.flags, layout);
		this.terrainKeys = roomTerrainKeys(firstFrame, layout);
		this.structureKeys = roomStructureKeys(firstFrame, layout);
		this.rampartKeys = roomRampartKeys(firstFrame, layout);
		for (const room of this.allRooms) this.syncSwampWalls(room);

		const painters: Record<TileLayer, (ctx: CanvasRenderingContext2D, room: string) => void> = {
			terrain: (ctx, room) => this.paintTerrain(ctx, room),
			structure: (ctx, room) => this.paintStructures(ctx, room),
			rampart: (ctx, room) => this.paintRamparts(ctx, room),
		};
		this.levels = lodLevels(resolution);
		this.exportTiles = new RoomTileCache({
			layout,
			lods: [resolution],
			canvasFactory,
			painters,
			padding: TILE_PADDING,
			finish: terrainResources.finish,
			budgetBytes: Infinity,
		});
		this.viewTiles = new RoomTileCache({
			layout,
			lods: this.levels,
			canvasFactory,
			painters,
			padding: TILE_PADDING,
			finish: terrainResources.finish,
			budgetBytes: TILE_CACHE_BUDGET_BYTES,
		});
		// Queue every room's tiny pinned terrain and structure tiles, so a room
		// panned to shows at least a coarse picture. pump() builds them; nothing
		// is built here. No-view mode never pumps, so this costs it nothing.
		this.viewTiles.warm('terrain', this.allRooms);
		this.viewTiles.warm('structure', this.allRooms);
	}

	// Bumps whenever a tile is built or invalidated.
	get version(): number {
		return this.exportTiles.version + this.viewTiles.version;
	}

	prepare(frame: Frame): void {
		populateFrameMy(frame, this.botUserId);
	}

	// Invalidates only the room/layer tiles whose own content key changed.
	sync(frame: Frame): void {
		if (frame === this.frame) return;
		// Before the keys: the rampart key reads object.my, and keys are cached per frame.
		this.prepare(frame);
		const previous: Record<TileLayer, Map<string, string>> = {
			terrain: this.terrainKeys,
			structure: this.structureKeys,
			rampart: this.rampartKeys,
		};
		// State first: invalidate() repaints pinned tiles from it right away.
		this.frame = frame;
		this.flags = flagsByRoom(frame.flags, this.layout);
		this.terrainKeys = roomTerrainKeys(frame, this.layout);
		this.structureKeys = roomStructureKeys(frame, this.layout);
		this.rampartKeys = roomRampartKeys(frame, this.layout);
		const next: Record<TileLayer, Map<string, string>> = {
			terrain: this.terrainKeys,
			structure: this.structureKeys,
			rampart: this.rampartKeys,
		};
		for (const room of this.allRooms) {
			for (const layer of TILE_LAYERS) {
				if (next[layer].get(room) === previous[layer].get(room)) continue;
				this.exportTiles.invalidate(room, layer);
				this.viewTiles.invalidate(room, layer);
				if (layer === 'terrain') this.syncSwampWalls(room);
			}
		}
	}

	beginFrame(): void {
		this.exportTiles.beginFrame();
		this.viewTiles.beginFrame();
	}

	// Terrain with its walls (natural and constructed).
	drawTerrain(ctx: CanvasRenderingContext2D, view?: RenderView): void {
		this.drawLayer(ctx, 'terrain', view);
	}

	drawStructures(ctx: CanvasRenderingContext2D, view?: RenderView): void {
		this.drawLayer(ctx, 'structure', view);
	}

	drawRamparts(ctx: CanvasRenderingContext2D, view?: RenderView): void {
		this.drawLayer(ctx, 'rampart', view);
	}

	// The terrain tile already carries the plain swamp colour; this adds the
	// moving texture, which is invisible below 'full' detail.
	drawSwamps(ctx: CanvasRenderingContext2D, animationTime: number, view?: RenderView): void {
		if (!this.animatedSwamps) return;
		if (!view) {
			this.animatedSwamps.draw(ctx, animationTime);
			return;
		}
		if (detailLevel(view) !== 'full') return;
		this.animatedSwamps.draw(ctx, animationTime, this.planFor(view).rooms);
	}

	// Builds queued tiles within the budget; returns how many were built.
	pump(budgetMs: number, budgetPixels: number): number {
		return this.viewTiles.pump(budgetMs, budgetPixels);
	}

	// The zoom's LOD, stepped down until the tiles the visible rooms actually
	// draw (terrain and structure for each, ramparts only where there are some)
	// fit in 3/4 of the byte budget. Tiles drawn this frame are never evicted,
	// so a visible set over budget would just keep growing; the last quarter
	// holds stale fallbacks and recently seen rooms.
	lodFor(view: RenderView): number {
		return this.planFor(view).lod;
	}

	stats(): { tileBytes: number; pinnedBytes: number; queued: number } {
		return {
			tileBytes: this.exportTiles.bytes() + this.viewTiles.bytes(),
			pinnedBytes: this.exportTiles.pinnedBytes() + this.viewTiles.pinnedBytes(),
			queued: this.exportTiles.queued() + this.viewTiles.queued(),
		};
	}

	// Closes every tile image. Call when these layers are replaced.
	dispose(): void {
		this.exportTiles.dispose();
		this.viewTiles.dispose();
	}

	private drawLayer(ctx: CanvasRenderingContext2D, layer: TileLayer, view?: RenderView): void {
		if (!view) {
			this.exportTiles.draw(ctx, layer, this.roomsWithContent(layer, this.allRooms), this.resolution, true, 0);
			return;
		}
		const plan = this.planFor(view);
		this.viewTiles.draw(ctx, layer, this.roomsWithContent(layer, plan.rooms), plan.lod, false, 0.5 / view.pixelsPerTile);
	}

	// A room without ramparts has an empty rampart tile: skip it rather than
	// build, cache and draw one.
	private roomsWithContent(layer: TileLayer, rooms: Iterable<string>): Iterable<string> {
		if (layer !== 'rampart') return rooms;
		const withRamparts: string[] = [];
		for (const room of rooms) if (this.hasRamparts(room)) withRamparts.push(room);
		return withRamparts;
	}

	private planFor(view: RenderView): ViewPlan {
		if (this.plan?.view === view) return this.plan;
		const rooms = visibleRooms(this.layout, view);
		let rampartRooms = 0;
		for (const room of rooms) if (this.hasRamparts(room)) rampartRooms++;
		const visibleBytes = (lod: number) => rooms.size * (this.tileBytes('terrain', lod) + this.tileBytes('structure', lod))
			+ rampartRooms * this.tileBytes('rampart', lod);
		let index = this.levels.indexOf(pickLod(this.levels, view.pixelsPerTile));
		while (index < this.levels.length - 1
			&& visibleBytes(this.levels[index]) > VISIBLE_TILE_BUDGET_SHARE * TILE_CACHE_BUDGET_BYTES) index++;
		this.plan = { view, rooms, lod: this.levels[index] };
		return this.plan;
	}

	// One tile at `lod`, padding included, sized as RoomTileCache builds it.
	private tileBytes(layer: TileLayer, lod: number): number {
		const px = Math.ceil((ROOM_SIZE_TILES + 2 * TILE_PADDING[layer]) * lod);
		return px * px * BYTES_PER_PIXEL;
	}

	// A rampart key starting `0:` means the room has no ramparts (roomIndex.ts).
	private hasRamparts(room: string): boolean {
		const key = this.rampartKeys.get(room);
		return key !== undefined && !key.startsWith('0:');
	}

	private roomObjects(room: string): FrameObject[] {
		return objectsByRoom(this.frame, this.layout).get(room) || NO_OBJECTS;
	}

	// The animated swamp pass cuts out the walls the terrain tile draws, so it
	// follows the same (synced) frame's constructed walls.
	private syncSwampWalls(room: string): void {
		this.animatedSwamps?.setConstructedWalls(room, constructedWallsIn(this.roomObjects(room)));
	}

	private paintTerrain(ctx: CanvasRenderingContext2D, room: string): void {
		const walls = constructedWallsIn(this.roomObjects(room));
		const rows = this.terrainRowsByRoom[room];
		if (rows) drawRoomTerrainLayer(ctx, rows, walls, this.cachedTerrainTextures, this.wallTexture);
		// The old whole-map canvases drew no ground for a laid-out room the
		// recording has no terrain for, only its constructed walls.
		else drawWallIslands(ctx, NO_TERRAIN_ROWS, this.wallTexture, walls);
	}

	private paintStructures(ctx: CanvasRenderingContext2D, room: string): void {
		drawRoomStructureLayer(ctx, room, this.roomObjects(room), this.flags.get(room) || [], this.modImages);
	}

	private paintRamparts(ctx: CanvasRenderingContext2D, room: string): void {
		drawRoomRamparts(ctx, this.roomObjects(room));
	}
}

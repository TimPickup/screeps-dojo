import type { StageLayout } from '../api/types.ts';
import type { CanvasFactory } from './staticLayers.ts';
import { ROOM_SIZE_TILES } from './renderConstants.ts';

// Per-room tile cache for the static layers (terrain, structures, ramparts).
//
// Replaces the whole-map static canvases: each room/layer is rasterised on its
// own small canvas at one of a few levels of detail (LODs), built lazily within
// a per-frame budget, and evicted LRU when over a byte budget. A tiny copy at
// the lowest LOD is pinned so there is always something to draw.

export type TileLayer = 'terrain' | 'structure' | 'rampart';
// Paints one room in room-local tile coordinates (0..50 on each axis).
export type TilePainter = (ctx: CanvasRenderingContext2D, room: string) => void;
export type TileImage = CanvasImageSource & { width: number; height: number };

export interface RoomTileCacheOptions {
	layout: StageLayout;
	// lodLevels(maxResolution): px per tile, descending. The last is pinned.
	lods: number[];
	canvasFactory: CanvasFactory;
	painters: Record<TileLayer, TilePainter>;
	// Extra tiles painted around the room on each side (terrain 0, structure/rampart TILE_PADDING_TILES).
	padding: Record<TileLayer, number>;
	// Turns a painted canvas into what gets drawn, forcing its raster now so the
	// build budget measures real work. Browser: OffscreenCanvas → transferToImageBitmap().
	// Absent (Node/video, tests): the canvas itself.
	finish?: (canvas: HTMLCanvasElement) => TileImage;
	// Byte budget for current + stale tiles. Infinity in no-view mode.
	budgetBytes: number;
	now?: () => number;
}

// A tile's padding and side in pixels. The pad is rounded up to whole pixels
// on each side, so the room's own 0..50 area starts on a pixel boundary and the
// tile can be drawn 1:1 onto a grid of `lod` px per tile at any lod (video
// export takes any --pixels, e.g. 2.56 px per tile). At the browser LODs
// (24, 12, 6, 3, 1.5 with pad 2) this equals ceil((50 + 2·pad)·lod).
export function tilePadPixels(pad: number, lod: number): number {
	return Math.ceil(pad * lod);
}

export function tilePixels(pad: number, lod: number): number {
	return Math.ceil(ROOM_SIZE_TILES * lod) + 2 * tilePadPixels(pad, lod);
}

interface Tile {
	image: TileImage;
	// The LOD it was built at (a fallback can be drawn in place of another).
	lod: number;
	bytes: number;
	// Frame id of the last frame that drew this tile (or built it).
	lastFrame: number;
}

type Job = [layer: TileLayer, room: string, lod: number];

const BYTES_PER_PIXEL = 4;

export class RoomTileCache {
	// Bumps when a tile is built or invalidated; callers redraw when it changes.
	get version(): number { return this.versionCount; }
	private versionCount = 0;

	private readonly layout: StageLayout;
	private readonly lods: number[];
	private readonly lowest: number;
	private readonly canvasFactory: CanvasFactory;
	private readonly painters: Record<TileLayer, TilePainter>;
	private readonly padding: Record<TileLayer, number>;
	private readonly finish?: (canvas: HTMLCanvasElement) => TileImage;
	private readonly budgetBytes: number;
	private readonly now: () => number;

	// `${layer}|${room}|${lod}` for every LOD except the lowest.
	private readonly current = new Map<string, Tile>();
	// `${layer}|${room}` at the lowest LOD. Never evicted.
	private readonly pinned = new Map<string, Tile>();
	// `${layer}|${room}`: the best tile left over from before an invalidation.
	private readonly stale = new Map<string, Tile>();
	private currentBytes = 0; // current + stale
	private pinnedTotal = 0;

	private frame = 0;
	// Tiles the frame being drawn wanted but did not have, in draw order.
	private requested = new Map<string, Job>();
	private queue: Job[] = [];
	private queueHead = 0;
	// Pinned builds asked for by warm(), served after everything on screen.
	private readonly warmQueue = new Map<string, Job>();

	constructor(options: RoomTileCacheOptions) {
		this.layout = options.layout;
		// Descending order is relied on: the last entry is the pinned lowest LOD,
		// and the fallback's "nearest" is measured by index distance.
		for (let i = 1; i < options.lods.length; i++) {
			if (!(options.lods[i] < options.lods[i - 1])) throw new Error('RoomTileCache: lods must be strictly descending');
		}
		this.lods = options.lods;
		this.lowest = options.lods[options.lods.length - 1];
		this.canvasFactory = options.canvasFactory;
		this.painters = options.painters;
		this.padding = options.padding;
		this.finish = options.finish;
		this.budgetBytes = options.budgetBytes;
		this.now = options.now ?? (() => performance.now());
	}

	beginFrame(): void {
		this.frame++;
		// The queue is replaced, not appended to: it holds only what the last
		// drawn frame asked for, so tiles for views the user has panned or zoomed
		// away from are dropped instead of being built after the fact.
		this.queue = Array.from(this.requested.values());
		this.queueHead = 0;
		this.requested = new Map();
	}

	invalidate(room: string, layer: TileLayer): void {
		const base = `${layer}|${room}`;
		// Drop every non-pinned LOD, but keep the largest as `stale` so the room
		// still shows a near-full-detail picture (slightly out of date) until the
		// current one is rebuilt, instead of falling back to the blurry pinned
		// tile. Stale tiles hold real memory, so they count against bytes().
		// lods is descending, so the first current tile found is the largest.
		let best: Tile | undefined;
		for (const lod of this.lods) {
			if (lod === this.lowest) continue;
			const key = `${base}|${lod}`;
			const tile = this.current.get(key);
			if (!tile) continue;
			this.current.delete(key);
			if (!best) { best = tile; continue; }
			this.currentBytes -= tile.bytes;
			this.release(tile.image);
		}
		// With no current tile to promote, any older stale tile is still the best
		// near-full-detail picture we have, so it is kept.
		if (best) {
			// best's bytes move from current to stale, so the total is unchanged.
			const old = this.stale.get(base);
			if (old) {
				this.currentBytes -= old.bytes;
				this.release(old.image);
			}
			this.stale.set(base, best);
		}
		// The pinned tile is tiny (≤ 81 px square), so rebuild it right away:
		// the last-resort fallback is then never out of date.
		if (this.pinned.has(base)) this.build(layer, room, this.lowest);
		this.versionCount++;
	}

	draw(
		ctx: CanvasRenderingContext2D,
		layer: TileLayer,
		rooms: Iterable<string>,
		lod: number,
		synchronous: boolean,
		expandPx: number,
	): void {
		const pad = this.padding[layer];
		// Padding-0 layers (terrain) are opaque and meet edge to edge; widening
		// them by half a device pixel hides the hairline seams antialiasing leaves
		// between neighbours. Padded layers are transparent and already overlap,
		// so widening them would only blur and misplace their content.
		const e = pad === 0 ? expandPx : 0;
		for (const room of rooms) {
			const offset = this.layout.offsets[room];
			if (!offset) continue;
			let tile = this.lookup(layer, room, lod);
			if (!tile && synchronous) tile = this.build(layer, room, lod);
			if (!tile) {
				// An on-screen room with no pinned tile yet asks for that first:
				// it is tiny, and it is the fallback until the real tile is built.
				if (lod !== this.lowest && !this.pinned.has(`${layer}|${room}`)) {
					this.requested.set(`${layer}|${room}|${this.lowest}`, [layer, room, this.lowest]);
				}
				this.requested.set(`${layer}|${room}|${lod}`, [layer, room, lod]);
				tile = this.fallback(layer, room, lod);
			}
			if (!tile) continue;
			tile.lastFrame = this.frame;
			// Placed by its real pixel size, not by 50 + 2·pad world tiles: when
			// pad·lod is not whole the two differ, and stretching one onto the
			// other resamples (blurs) the whole layer.
			const padTiles = tilePadPixels(pad, tile.lod) / tile.lod;
			ctx.drawImage(
				tile.image,
				offset.col * ROOM_SIZE_TILES - padTiles - e,
				offset.row * ROOM_SIZE_TILES - padTiles - e,
				tile.image.width / tile.lod + 2 * e,
				tile.image.height / tile.lod + 2 * e,
			);
		}
	}

	pump(budgetMs: number, budgetPixels: number): number {
		const start = this.now();
		let built = 0;
		let pixels = 0;
		for (;;) {
			const job = this.nextJob();
			if (!job) break;
			const tile = this.build(job[0], job[1], job[2]);
			built++;
			pixels += tile.image.width * tile.image.height;
			// Checked after the build so each call makes progress (at least one
			// tile). The clock covers finish() too, since that is where the
			// browser actually rasterises.
			if (this.now() - start >= budgetMs || pixels >= budgetPixels) break;
		}
		return built;
	}

	warm(layer: TileLayer, rooms: Iterable<string>): void {
		for (const room of rooms) {
			if (!this.layout.offsets[room] || this.pinned.has(`${layer}|${room}`)) continue;
			this.warmQueue.set(`${layer}|${room}`, [layer, room, this.lowest]);
		}
	}

	bytes(): number {
		return this.currentBytes;
	}

	pinnedBytes(): number {
		return this.pinnedTotal;
	}

	// Builds still waiting (warm-ups, and what drawn frames asked for that the
	// budget has not reached yet; may count a tile twice). For the stats overlay.
	queued(): number {
		return this.warmQueue.size + this.requested.size + (this.queue.length - this.queueHead);
	}

	// Closes every tile image (current, stale and pinned) and forgets all
	// queued work. For when the owner is replaced: ImageBitmaps would otherwise
	// hold their pixels until GC gets round to them.
	dispose(): void {
		for (const map of [this.current, this.stale, this.pinned]) {
			for (const tile of map.values()) this.release(tile.image);
			map.clear();
		}
		this.currentBytes = 0;
		this.pinnedTotal = 0;
		this.requested = new Map();
		this.queue = [];
		this.queueHead = 0;
		this.warmQueue.clear();
		this.versionCount++;
	}

	private lookup(layer: TileLayer, room: string, lod: number): Tile | undefined {
		return lod === this.lowest ? this.pinned.get(`${layer}|${room}`) : this.current.get(`${layer}|${room}|${lod}`);
	}

	// Nearest built current LOD → stale → pinned → nothing.
	private fallback(layer: TileLayer, room: string, lod: number): Tile | undefined {
		const want = this.lods.indexOf(lod);
		let best: Tile | undefined;
		let bestDistance = Infinity;
		for (let i = 0; i < this.lods.length; i++) {
			if (this.lods[i] === this.lowest) continue;
			const tile = this.current.get(`${layer}|${room}|${this.lods[i]}`);
			if (!tile) continue;
			const distance = want < 0 ? i : Math.abs(i - want);
			// Strict < keeps the sharper tile on a tie (lods run high to low).
			if (distance < bestDistance) { best = tile; bestDistance = distance; }
		}
		return best ?? this.stale.get(`${layer}|${room}`) ?? this.pinned.get(`${layer}|${room}`);
	}

	// On-screen work first, warm-ups last: the frame being drawn (pump runs
	// after the draws), then what the previous frame asked for, then warm().
	// Serving warm() first would build the whole map's pinned tiles before any
	// visible one, leaving the screen coarse for tens of frames on first open.
	private nextJob(): Job | undefined {
		// Served entries leave `requested`, so beginFrame only carries over
		// what the budget did not reach.
		for (const [key, job] of this.requested) {
			this.requested.delete(key);
			if (!this.lookup(job[0], job[1], job[2])) return job;
		}
		while (this.queueHead < this.queue.length) {
			const job = this.queue[this.queueHead++];
			// A synchronous draw or an earlier duplicate may have built it already.
			if (!this.lookup(job[0], job[1], job[2])) return job;
		}
		for (const [key, job] of this.warmQueue) {
			this.warmQueue.delete(key);
			if (!this.lookup(job[0], job[1], job[2])) return job;
		}
		return undefined;
	}

	private build(layer: TileLayer, room: string, lod: number): Tile {
		const pad = this.padding[layer];
		// Padding lets structure/rampart art that spills past the room edge
		// (rampart outlines, road stubs, labels) be drawn from this room's tile.
		const px = tilePixels(pad, lod);
		const canvas = this.canvasFactory(px, px);
		const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
		ctx.scale(lod, lod);
		// Whole pixels, matching where draw() puts the tile.
		const padTiles = tilePadPixels(pad, lod) / lod;
		ctx.translate(padTiles, padTiles);
		this.painters[layer](ctx, room);
		const image = this.finish ? this.finish(canvas) : canvas;
		const tile: Tile = { image, lod, bytes: image.width * image.height * BYTES_PER_PIXEL, lastFrame: this.frame };
		const base = `${layer}|${room}`;
		if (lod === this.lowest) {
			// Every lowest-LOD tile is pinned, however it was built: ~81 px square,
			// ~5 MB for 108 rooms, and it is the always-available fallback.
			const old = this.pinned.get(base);
			if (old) {
				this.pinnedTotal -= old.bytes;
				this.release(old.image);
			}
			this.pinned.set(base, tile);
			this.pinnedTotal += tile.bytes;
		} else {
			const key = `${base}|${lod}`;
			const old = this.current.get(key);
			if (old) {
				this.currentBytes -= old.bytes;
				this.release(old.image);
			}
			this.current.set(key, tile);
			this.currentBytes += tile.bytes;
			// A current tile now exists, so the stale one is no longer needed.
			const staleTile = this.stale.get(base);
			if (staleTile) {
				this.stale.delete(base);
				this.currentBytes -= staleTile.bytes;
				this.release(staleTile.image);
			}
		}
		this.versionCount++;
		this.evict();
		return tile;
	}

	// Runs only after a build. Drops the least recently drawn current/stale
	// tiles until under budget, but never one drawn in the current frame: if
	// only those remain we stay over budget, and the caller must choose an LOD
	// whose visible set fits.
	private evict(): void {
		if (this.currentBytes <= this.budgetBytes) return;
		const candidates: { map: Map<string, Tile>; key: string; tile: Tile }[] = [];
		for (const [key, tile] of this.current) if (tile.lastFrame !== this.frame) candidates.push({ map: this.current, key, tile });
		for (const [key, tile] of this.stale) if (tile.lastFrame !== this.frame) candidates.push({ map: this.stale, key, tile });
		candidates.sort((a, b) => a.tile.lastFrame - b.tile.lastFrame);
		for (const c of candidates) {
			if (this.currentBytes <= this.budgetBytes) break;
			c.map.delete(c.key);
			this.currentBytes -= c.tile.bytes;
			this.release(c.tile.image);
		}
	}

	// Called only once a tile is out of every map. In the browser the image is
	// an ImageBitmap whose pixels live outside the JS heap; GC barely sees that
	// memory, so without close() real usage can run far past budgetBytes while
	// panning. Canvases (Node/video, tests) have no close() and are left to GC.
	private release(image: TileImage): void {
		(image as Partial<ImageBitmap>).close?.();
	}
}

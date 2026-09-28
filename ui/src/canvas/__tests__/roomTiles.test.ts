import { describe, expect, it } from 'vitest';
import type { StageLayout } from '../../api/types';
import { RoomTileCache } from '../roomTiles';
import { mockCtx } from './mockCtx';

const layout = { offsets: { A: { col: 0, row: 0 }, B: { col: 1, row: 0 } } } as unknown as StageLayout;
function setup(budgetBytes = Infinity) {
  const built: string[] = [];
  let clock = 0;
  const canvasFactory = (w: number, h: number) => ({ width: w, height: h, getContext: () => mockCtx().ctx }) as unknown as HTMLCanvasElement;
  const painter = (layer: string) => (_: CanvasRenderingContext2D, room: string) => { built.push(`${layer}:${room}`); clock += 1; };
  const cache = new RoomTileCache({
    layout, lods: [24, 12, 6, 3, 1.5], canvasFactory, budgetBytes, now: () => clock,
    painters: { terrain: painter('terrain'), structure: painter('structure'), rampart: painter('rampart') },
    padding: { terrain: 0, structure: 2, rampart: 2 },
  });
  return { cache, built };
}
const images = (log: { op: string; args: unknown[] }[]) => log.filter((c) => c.op === 'drawImage');

describe('RoomTileCache', () => {
  it('builds synchronously in no-view mode and places padded tiles in world tiles', () => {
    const { cache, built } = setup();
    const { ctx, log } = mockCtx();
    cache.beginFrame();
    cache.draw(ctx, 'structure', ['B'], 6, true, 0);
    expect(built).toEqual(['structure:B']);
    const [img, ...rect] = images(log)[0].args as [HTMLCanvasElement, ...number[]];
    expect(img.width).toBe(Math.ceil(54 * 6));
    expect(rect).toEqual([48, -2, 54, 54]);
  });

  it('expands opaque tiles only when asked', () => {
    const { cache } = setup();
    const a = mockCtx(); cache.beginFrame(); cache.draw(a.ctx, 'terrain', ['A'], 3, true, 0.25);
    expect(images(a.log)[0].args.slice(1)).toEqual([-0.25, -0.25, 50.5, 50.5]);
    const b = mockCtx(); cache.draw(b.ctx, 'terrain', ['A'], 3, true, 0);
    expect(images(b.log)[0].args.slice(1)).toEqual([0, 0, 50, 50]);
    const c = mockCtx(); cache.draw(c.ctx, 'structure', ['A'], 3, true, 0.25);   // padded layers never expand
    expect(images(c.log)[0].args.slice(1)).toEqual([-2, -2, 54, 54]);
  });

  it('queues what the frame asked for and falls back to the pinned lowest LOD', () => {
    const { cache, built } = setup();
    cache.warm('structure', ['A']);
    cache.beginFrame(); expect(cache.pump(100, Infinity)).toBe(1);        // pinned A @1.5
    const { ctx, log } = mockCtx();
    cache.beginFrame(); cache.draw(ctx, 'structure', ['A'], 24, false, 0);
    expect((images(log)[0].args[0] as HTMLCanvasElement).width).toBe(Math.ceil(54 * 1.5));
    const v = cache.version;
    cache.beginFrame(); expect(cache.pump(100, Infinity)).toBe(1);        // A @24 built
    expect(cache.version).toBeGreaterThan(v);
    expect(built).toEqual(['structure:A', 'structure:A']);
  });

  it('builds what a visible room asks for before the warm-up queue', () => {
    const many = { offsets: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`R${i}`, { col: i % 10, row: Math.floor(i / 10) }])) } as unknown as StageLayout;
    const built: string[] = [];
    let clock = 0;
    const canvasFactory = (w: number, h: number) => ({ width: w, height: h, getContext: () => mockCtx().ctx }) as unknown as HTMLCanvasElement;
    const painter = (layer: string) => (_: CanvasRenderingContext2D, room: string) => { built.push(`${layer}:${room}`); clock += 1; };
    const cache = new RoomTileCache({
      layout: many, lods: [24, 12, 6, 3, 1.5], canvasFactory, budgetBytes: Infinity, now: () => clock,
      painters: { terrain: painter('terrain'), structure: painter('structure'), rampart: painter('rampart') },
      padding: { terrain: 0, structure: 2, rampart: 2 },
    });
    cache.warm('terrain', Object.keys(many.offsets));
    cache.warm('structure', Object.keys(many.offsets));
    cache.beginFrame();
    cache.draw(mockCtx().ctx, 'terrain', ['R55'], 12, false, 0);
    expect(cache.pump(2, Infinity)).toBe(2);
    expect(built).toEqual(['terrain:R55', 'terrain:R55']);                // its pinned fallback, then the tile
    const { ctx, log } = mockCtx();
    cache.beginFrame(); cache.draw(ctx, 'terrain', ['R55'], 12, false, 0);
    expect((images(log)[0].args[0] as HTMLCanvasElement).width).toBe(600);
  });

  it('drops queued tiles the view no longer asks for', () => {
    const { cache, built } = setup();
    const { ctx } = mockCtx();
    cache.beginFrame(); cache.draw(ctx, 'terrain', ['A', 'B'], 24, false, 0);
    cache.beginFrame(); cache.draw(ctx, 'terrain', ['B'], 24, false, 0);  // panned: only B wanted now
    cache.beginFrame(); cache.pump(100, Infinity);
    expect(built).toEqual(['terrain:B', 'terrain:B']);                    // B's pinned fallback, then B @24
  });

  it('rebuilds only the invalidated room and keeps its pinned fallback current', () => {
    const { cache, built } = setup();
    cache.warm('structure', ['A', 'B']); cache.beginFrame(); cache.pump(100, Infinity);
    const { ctx } = mockCtx();
    cache.beginFrame(); cache.draw(ctx, 'structure', ['A', 'B'], 6, true, 0);
    built.length = 0;
    cache.invalidate('A', 'structure');
    expect(built).toEqual(['structure:A']);                               // pinned rebuilt at once
    const again = mockCtx();
    cache.beginFrame(); cache.draw(again.ctx, 'structure', ['A', 'B'], 6, false, 0);
    expect(images(again.log)).toHaveLength(2);                             // stale A + current B
    cache.beginFrame(); cache.pump(100, Infinity);
    expect(built).toEqual(['structure:A', 'structure:A']);
  });

  it('stops at the pixel budget but always builds one tile', () => {
    const { cache } = setup();
    const { ctx } = mockCtx();
    cache.beginFrame(); cache.draw(ctx, 'terrain', ['A', 'B'], 24, false, 0);
    cache.beginFrame(); expect(cache.pump(100, 1)).toBe(1);
  });

  it('never evicts tiles used this frame', () => {
    const tile = (50 * 24) ** 2 * 4;
    const { cache } = setup(tile * 1.5);
    cache.beginFrame(); cache.draw(mockCtx().ctx, 'terrain', ['A', 'B'], 24, true, 0);  // both on screen
    expect(cache.bytes()).toBe(tile * 2);                                              // over budget, nothing evictable
  });

  it('evicts the least recently used tile when a build goes over budget', () => {
    const tile = (50 * 24) ** 2 * 4;
    const { cache, built } = setup(tile * 1.5);
    cache.beginFrame(); cache.draw(mockCtx().ctx, 'terrain', ['A'], 24, true, 0);
    cache.beginFrame(); cache.draw(mockCtx().ctx, 'terrain', ['B'], 24, true, 0);      // build B evicts A
    expect(cache.bytes()).toBe(tile);
    cache.beginFrame(); cache.draw(mockCtx().ctx, 'terrain', ['A'], 24, true, 0);      // A rebuilt
    expect(built).toEqual(['terrain:A', 'terrain:B', 'terrain:A']);
  });

  it('counts stale tiles in bytes()', () => {
    const { cache } = setup();
    cache.beginFrame(); cache.draw(mockCtx().ctx, 'structure', ['A'], 6, true, 0);
    const before = cache.bytes();
    cache.invalidate('A', 'structure');
    expect(cache.bytes()).toBe(before);                                      // now held as stale
  });

  describe('releases dropped tile images', () => {
    // finish() returns a fake ImageBitmap labelled `layer:room@widthPx` whose close() is recorded.
    function setupClose(budgetBytes = Infinity) {
      const closed: string[] = [];
      let last = '';
      const canvasFactory = (w: number, h: number) => ({ width: w, height: h, getContext: () => mockCtx().ctx }) as unknown as HTMLCanvasElement;
      const painter = (layer: string) => (_: CanvasRenderingContext2D, room: string) => { last = `${layer}:${room}`; };
      const finish = (canvas: HTMLCanvasElement) => {
        const label = `${last}@${canvas.width}`;
        return { width: canvas.width, height: canvas.height, close: () => closed.push(label) } as unknown as ImageBitmap;
      };
      const cache = new RoomTileCache({
        layout, lods: [24, 12, 6, 3, 1.5], canvasFactory, budgetBytes, finish,
        painters: { terrain: painter('terrain'), structure: painter('structure'), rampart: painter('rampart') },
        padding: { terrain: 0, structure: 2, rampart: 2 },
      });
      return { cache, closed };
    }

    it('on eviction', () => {
      const tile = (50 * 24) ** 2 * 4;
      const { cache, closed } = setupClose(tile * 1.5);
      cache.beginFrame(); cache.draw(mockCtx().ctx, 'terrain', ['A'], 24, true, 0);
      cache.beginFrame(); cache.draw(mockCtx().ctx, 'terrain', ['B'], 24, true, 0);
      expect(closed).toEqual(['terrain:A@1200']);
    });

    it('on invalidate for dropped LODs, but not for the tile moved to stale', () => {
      const { cache, closed } = setupClose();
      cache.beginFrame();
      for (const lod of [24, 12, 6]) cache.draw(mockCtx().ctx, 'structure', ['A'], lod, true, 0);
      cache.invalidate('A', 'structure');
      expect(closed.sort()).toEqual(['structure:A@324', 'structure:A@648']);
    });

    it('when a pinned tile is replaced', () => {
      const { cache, closed } = setupClose();
      cache.warm('structure', ['A']); cache.beginFrame(); cache.pump(100, Infinity);
      cache.invalidate('A', 'structure');
      expect(closed).toEqual(['structure:A@81']);
    });

    it('when a current tile makes the stale one redundant', () => {
      const { cache, closed } = setupClose();
      cache.beginFrame(); cache.draw(mockCtx().ctx, 'structure', ['A'], 24, true, 0);
      cache.invalidate('A', 'structure');
      expect(closed).toEqual([]);
      cache.draw(mockCtx().ctx, 'structure', ['A'], 6, true, 0);
      expect(closed).toEqual(['structure:A@1296']);
    });
  });

  it('rejects lods that are not strictly descending', () => {
    const canvasFactory = (() => { throw new Error('unused'); }) as never;
    const noop = () => {};
    expect(() => new RoomTileCache({
      layout, lods: [1.5, 3], canvasFactory, budgetBytes: Infinity,
      painters: { terrain: noop, structure: noop, rampart: noop }, padding: { terrain: 0, structure: 2, rampart: 2 },
    })).toThrow(/descending/);
  });

  it('warm() skips rooms outside the layout', () => {
    const { cache, built } = setup();
    cache.warm('terrain', ['Z', 'A']); cache.beginFrame();
    expect(cache.pump(100, Infinity)).toBe(1);
    expect(built).toEqual(['terrain:A']);
  });
});

import { describe, expect, it } from 'vitest';
import type { Frame, Recording, StageLayout } from '../../api/types';
import { StaticLayers } from '../caches';
import { roomRampartKeys, roomStructureKeys, roomTerrainKeys } from '../roomIndex';
import { mockCtx, type Call } from './mockCtx';

const layout = {
  width: 600,
  height: 600,
  pixelsPerRoom: 600,
  offsets: { W1N1: { col: 0, row: 0 } },
} as unknown as StageLayout;

function frameWithWall(x: number, hits = 100): Frame {
  return {
    gameTime: 1,
    flags: [],
    objects: [{ _id: 'wall', type: 'constructedWall', room: 'W1N1', x, y: 10, hits }],
  } as unknown as Frame;
}

function frameWithRampart(x: number, hits = 100, isPublic = false, user = 'me'): Frame {
  return {
    gameTime: 1,
    flags: [],
    objects: [{ _id: 'rampart', type: 'rampart', room: 'W1N1', x, y: 10, hits, isPublic, user }],
  } as unknown as Frame;
}

function plainTerrain(): string[] {
  return Array.from({ length: 50 }, () => '.'.repeat(50));
}

// Each room tile is rebuilt only when that room's key changes (roomIndex.ts).
const terrainKey = (frame: Frame) => roomTerrainKeys(frame, layout).get('W1N1');
const structureKey = (frame: Frame) => roomStructureKeys(frame, layout).get('W1N1');
const rampartKey = (frame: Frame) => roomRampartKeys(frame, layout).get('W1N1');

describe('static layer room keys', () => {
  it('rebuilds the terrain tile for constructed-wall layout changes but not hit-point changes', () => {
    expect(terrainKey(frameWithWall(10, 100))).toBe(terrainKey(frameWithWall(10, 50)));
    expect(terrainKey(frameWithWall(10))).not.toBe(terrainKey(frameWithWall(11)));
    expect(terrainKey(frameWithWall(10))).not.toBe(terrainKey({
      ...frameWithWall(10),
      objects: [],
    } as unknown as Frame));
    // Walls draw in the terrain tile, so moving one leaves the structure tile alone.
    expect(structureKey(frameWithWall(10))).toBe(structureKey(frameWithWall(11)));
  });

  it('tracks deposit appearance and type but ignores cooldown and power-bank hits', () => {
    const depositFrame = frameWithStaticObject({
      _id: 'deposit', type: 'deposit', room: 'W1N1', x: 10, y: 10,
      depositType: 'biomass', cooldown: 5,
    });
    const changedCooldown = frameWithStaticObject({
      _id: 'deposit', type: 'deposit', room: 'W1N1', x: 10, y: 10,
      depositType: 'biomass', cooldown: 20,
    });
    const changedType = frameWithStaticObject({
      _id: 'deposit', type: 'deposit', room: 'W1N1', x: 10, y: 10,
      depositType: 'mist', cooldown: 20,
    });
    const fullPowerBank = frameWithStaticObject({
      _id: 'bank', type: 'powerBank', room: 'W1N1', x: 20, y: 20, hits: 2000000,
    });
    const damagedPowerBank = frameWithStaticObject({
      _id: 'bank', type: 'powerBank', room: 'W1N1', x: 20, y: 20, hits: 1000,
    });

    expect(structureKey(depositFrame)).toBe(structureKey(changedCooldown));
    expect(structureKey(depositFrame)).not.toBe(structureKey(changedType));
    expect(structureKey(fullPowerBank)).toBe(structureKey(damagedPowerBank));
  });

  it('ignores construction sites entirely: they are drawn per frame, not baked', () => {
    const bare = frameWithStaticObject({
      _id: 'spawn', type: 'spawn', room: 'W1N1', x: 25, y: 25,
    });
    const withSite: Frame = {
      ...bare,
      objects: [...bare.objects, {
        _id: 'site', type: 'constructionSite', room: 'W1N1', x: 10, y: 10,
        structureType: 'extension', progress: 0, progressTotal: 3000, user: 'me',
      }],
    } as unknown as Frame;
    const advancedSite: Frame = {
      ...withSite,
      objects: [withSite.objects[0], { ...withSite.objects[1], progress: 2000 }],
    } as unknown as Frame;

    // Placing one must not throw away a tile it never appears on.
    for (const key of [terrainKey, structureKey, rampartKey]) {
      expect(key(withSite)).toBe(key(bare));
      expect(key(advancedSite)).toBe(key(bare));
    }
  });

  it('rebuilds the rampart tile for layout, ownership, and public-state changes only', () => {
    const mine = frameWithRampart(10, 100);
    mine.objects[0].my = true;
    const damaged = frameWithRampart(10, 50);
    damaged.objects[0].my = true;
    const moved = frameWithRampart(11, 50);
    moved.objects[0].my = true;
    const publicRampart = frameWithRampart(10, 50, true);
    publicRampart.objects[0].my = true;
    const opponent = frameWithRampart(10, 50, false, 'enemy');
    opponent.objects[0].my = false;

    expect(rampartKey(mine)).toBe(rampartKey(damaged));
    expect(rampartKey(mine)).not.toBe(rampartKey(moved));
    expect(rampartKey(mine)).not.toBe(rampartKey(publicRampart));
    expect(rampartKey(mine)).not.toBe(rampartKey(opponent));
  });
});

describe('static layers', () => {
  it('bakes merged walls into a terrain tile', () => {
    const canvasLogs: Call[][] = [];
    const canvasFactory = (width: number, height: number): HTMLCanvasElement => {
      const { ctx, log } = mockCtx();
      canvasLogs.push(log);
      return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
    };
    const recording = {
      meta: {},
      terrain: { W1N1: terrainWithWall(10, 10) },
      frames: [frameWithWall(11)],
    } as unknown as Recording;

    const layers = new StaticLayers(recording, layout, 1, canvasFactory);
    const { ctx } = mockCtx();
    layers.beginFrame();
    layers.drawTerrain(ctx);
    expect(canvasLogs).toHaveLength(1);
    expect(canvasLogs[0].some((call) => call.op === 'moveTo'
      && call.args[0] === 11.3 && call.args[1] === 10 + 1 / 3)).toBe(true);
  });

  function tileFactory(built: string[]) {
    return (width: number, height: number): HTMLCanvasElement => {
      const { ctx, log } = mockCtx();
      built.push(String(width));
      return { width, height, getContext: () => ctx, log } as unknown as HTMLCanvasElement;
    };
  }
  const twoRooms = { ...layout, offsets: { W1N1: { col: 0, row: 0 }, W2N1: { col: 1, row: 0 } } } as unknown as StageLayout;
  const twoRoomRecording = (frame: Frame) => ({ meta: {}, terrain: { W1N1: plainTerrain(), W2N1: plainTerrain() }, frames: [frame] }) as unknown as Recording;

  it('rebuilds only the room whose walls changed, in the terrain layer', () => {
    const built: string[] = [];
    const layers = new StaticLayers(twoRoomRecording(frameWithWall(11)), twoRooms, 1, tileFactory(built));
    const { ctx } = mockCtx();
    layers.beginFrame(); layers.drawTerrain(ctx); layers.drawStructures(ctx);
    const before = built.length;
    layers.sync(frameWithWall(11, 25));                  // hits only: nothing rebuilt
    layers.beginFrame(); layers.drawTerrain(ctx); layers.drawStructures(ctx);
    expect(built.length).toBe(before);
    layers.sync(frameWithWall(12, 25));                  // wall moved in W1N1
    layers.beginFrame(); layers.drawTerrain(ctx); layers.drawStructures(ctx);
    expect(built.length).toBe(before + 1);               // one terrain tile, one room
  });

  it('draws only visible rooms, and nothing is built in the constructor', () => {
    const built: string[] = [];
    const layers = new StaticLayers(twoRoomRecording(frameWithWall(11)), twoRooms, 24, tileFactory(built));
    expect(built).toHaveLength(0);
    const { ctx, log } = mockCtx();
    layers.beginFrame();
    layers.drawTerrain(ctx, { minX: 0, minY: 0, maxX: 40, maxY: 40, pixelsPerTile: 2 });
    expect(log.filter((c) => c.op === 'drawImage').length).toBeLessThanOrEqual(1);   // W1N1 only (or nothing yet)
    layers.pump(1000, Infinity);
    expect(built.length).toBeGreaterThan(0);
    const again = mockCtx();
    layers.beginFrame();
    layers.drawTerrain(again.ctx, { minX: 0, minY: 0, maxX: 40, maxY: 40, pixelsPerTile: 2 });
    const draws = again.log.filter((c) => c.op === 'drawImage');
    expect(draws).toHaveLength(1);                                                     // W1N1, never W2N1
    expect(draws[0].args.slice(1)).toEqual([-0.25, -0.25, 50.5, 50.5]);               // W1N1, widened half a device px
  });

  it('steps down the LOD so the visible rooms fit the budget', () => {
    const many = { ...layout, offsets: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`W${i}N1`, { col: i % 10, row: Math.floor(i / 10) }])) } as unknown as StageLayout;
    const recording = { meta: {}, terrain: {}, frames: [{ gameTime: 1, flags: [], objects: [] }] } as unknown as Recording;
    const layers = new StaticLayers(recording, many, 24, tileFactory([]));
    expect(layers.lodFor({ minX: 0, minY: 0, maxX: 500, maxY: 300, pixelsPerTile: 20 })).toBeLessThan(24);
    expect(layers.lodFor({ minX: 0, minY: 0, maxX: 40, maxY: 40, pixelsPerTile: 20 })).toBe(24);
  });

  it('counts only the layers drawn: ~40 rooms on a 4K screen keep 12 px/tile', () => {
    // 8 x 5 rooms, none with ramparts, at the 4K fit zoom.
    const forty = { ...layout, offsets: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`W${i}N1`, { col: i % 8, row: Math.floor(i / 8) }])) } as unknown as StageLayout;
    const recording = { meta: {}, terrain: {}, frames: [{ gameTime: 1, flags: [], objects: [] }] } as unknown as Recording;
    const layers = new StaticLayers(recording, forty, 24, tileFactory([]));
    expect(layers.lodFor({ minX: 0, minY: 0, maxX: 400, maxY: 250, pixelsPerTile: 9.6 })).toBe(12);
  });
});

function terrainWithWall(x: number, y: number): string[] {
  const rows = plainTerrain();
  rows[y] = `${rows[y].slice(0, x)}#${rows[y].slice(x + 1)}`;
  return rows;
}

function frameWithStaticObject(object: Frame['objects'][number]): Frame {
  return { gameTime: 1, flags: [], objects: [object] };
}

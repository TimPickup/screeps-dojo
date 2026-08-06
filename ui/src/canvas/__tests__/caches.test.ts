import { describe, expect, it } from 'vitest';
import type { Frame, Recording, StageLayout } from '../../api/types';
import { epochKey, rampartEpochKey, StaticLayers } from '../caches';
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

describe('static layer epochs', () => {
  it('invalidates for constructed-wall layout changes but not hit-point changes', () => {
    expect(epochKey(frameWithWall(10, 100))).toBe(epochKey(frameWithWall(10, 50)));
    expect(epochKey(frameWithWall(10))).not.toBe(epochKey(frameWithWall(11)));
    expect(epochKey(frameWithWall(10))).not.toBe(epochKey({
      ...frameWithWall(10),
      objects: [],
    } as unknown as Frame));
  });

  it('invalidates the rampart overlay for layout, ownership, and public-state changes only', () => {
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

    expect(rampartEpochKey(mine)).toBe(rampartEpochKey(damaged));
    expect(rampartEpochKey(mine)).not.toBe(rampartEpochKey(moved));
    expect(rampartEpochKey(mine)).not.toBe(rampartEpochKey(publicRampart));
    expect(rampartEpochKey(mine)).not.toBe(rampartEpochKey(opponent));
  });

  it('bakes merged walls into the structure canvas and rebuilds that canvas on change', () => {
    const canvasLogs: Call[][] = [];
    const canvasFactory = (width: number, height: number): HTMLCanvasElement => {
      const { ctx, log } = mockCtx();
      canvasLogs.push(log);
      return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
    };
    const initialFrame = frameWithWall(11);
    const recording = {
      meta: {},
      terrain: { W1N1: terrainWithWall(10, 10) },
      frames: [initialFrame],
    } as unknown as Recording;

    const layers = new StaticLayers(recording, layout, 1, canvasFactory);
    expect(canvasLogs).toHaveLength(2);
    expect(canvasLogs[1].some((call) => call.op === 'moveTo'
      && call.args[0] === 11.3 && call.args[1] === 10 + 1 / 3)).toBe(true);

    layers.sync(frameWithWall(11, 25));
    expect(canvasLogs).toHaveLength(2);
    layers.sync(frameWithWall(12, 25));
    expect(canvasLogs).toHaveLength(3);
  });

  it('rebuilds the rampart canvas independently from the structure canvas', () => {
    const canvasFactory = (width: number, height: number): HTMLCanvasElement => {
      const { ctx } = mockCtx();
      return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
    };
    const initialFrame = frameWithRampart(10);
    const recording = {
      meta: {},
      terrain: { W1N1: plainTerrain() },
      frames: [initialFrame],
    } as unknown as Recording;
    const layers = new StaticLayers(recording, layout, 1, canvasFactory);
    const initialStructureCanvas = layers.structure;
    const initialRampartCanvas = layers.rampart;

    layers.sync(frameWithRampart(10, 25));
    expect(layers.structure).toBe(initialStructureCanvas);
    expect(layers.rampart).toBe(initialRampartCanvas);

    layers.sync(frameWithRampart(11, 25));
    expect(layers.structure).toBe(initialStructureCanvas);
    expect(layers.rampart).not.toBe(initialRampartCanvas);
  });
});

function terrainWithWall(x: number, y: number): string[] {
  const rows = plainTerrain();
  rows[y] = `${rows[y].slice(0, x)}#${rows[y].slice(x + 1)}`;
  return rows;
}

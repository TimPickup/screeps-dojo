import { describe, it, expect } from 'vitest';
import { drawMergedWalls, drawStaticStructures } from '../staticLayers';
import { mockCtx } from './mockCtx';
import type { Frame, StageLayout } from '../../api/types';

const layout = { width: 600, height: 600, pixelsPerRoom: 600, offsets: { W1N1: { col: 0, row: 0 } } } as unknown as StageLayout;

function frameWith(objects: unknown[]): Frame {
  return { gameTime: 1, objects, flags: [] } as unknown as Frame;
}

describe('drawStaticStructures', () => {
  it('draws a shell for a structure but nothing for a creep/tombstone/energy on the same tile', () => {
    const { ctx, log } = mockCtx();
    drawStaticStructures(ctx, frameWith([
      { _id: 'a', type: 'extension', room: 'W1N1', x: 10, y: 10 },
      { _id: 'b', type: 'creep', room: 'W1N1', x: 10, y: 10 },
      { _id: 'c', type: 'tombstone', room: 'W1N1', x: 11, y: 10 },
      { _id: 'd', type: 'energy', room: 'W1N1', x: 12, y: 10, store: { energy: 50 } },
    ]), layout);
    // The extension contributes its shell and empty backing; the dynamic
    // creep/tombstone/resource objects add nothing to the static layer.
    expect(log.filter((c) => c.op === 'arc').length).toBe(2);
  });

  it('draws constructed walls only through the merged wall layer', () => {
    const frame = frameWith([
      { _id: 'wall', type: 'constructedWall', room: 'W1N1', x: 11, y: 10 },
    ]);
    const staticStructures = mockCtx();
    drawStaticStructures(staticStructures.ctx, frame, layout);
    expect(staticStructures.log.filter((call) => call.op === 'arc')).toHaveLength(0);

    const mergedWalls = mockCtx();
    const terrain = { W1N1: terrainWithWalls([[10, 10]]) };
    drawMergedWalls(mergedWalls.ctx, terrain, frame, layout);
    expect(mergedWalls.log.some((call) => call.op === 'quadraticCurveTo')).toBe(true);
    expect(mergedWalls.log.some((call) => call.op === 'moveTo'
      && call.args[0] === 11.3 && call.args[1] === 10 + 1 / 3)).toBe(true);
  });

  it('renders an unclaimed controller even when it is positioned at (0,0)', () => {
    const { ctx, log } = mockCtx();
    drawStaticStructures(ctx, frameWith([
      { _id: 'ctrl', type: 'controller', room: 'W1N1', x: 0, y: 0, level: 0 },
    ]), layout);
    expect(log.filter((c) => c.op === 'arc').length).toBe(1);
  });

  it('draws a real unclaimed level-0 controller', () => {
    const { ctx, log } = mockCtx();
    drawStaticStructures(ctx, frameWith([
      { _id: 'ctrl', type: 'controller', room: 'W1N1', x: 25, y: 25, level: 0 },
    ]), layout);
    expect(log.filter((c) => c.op === 'arc').length).toBe(1);
  });

  it('draws an owned controller base with one triangular segment per level', () => {
    const { ctx, log } = mockCtx();
    drawStaticStructures(ctx, frameWith([
      { _id: 'ctrl', type: 'controller', room: 'W1N1', x: 25, y: 25, level: 4, user: 'me' },
    ]), layout);
    expect(log.filter((c) => c.op === 'arc').length).toBe(1); // base circle only (no progress core)
    // One closed octagonal base path followed by four closed triangle paths.
    expect(log.filter((c) => c.op === 'closePath').length).toBe(5);
    expect(log.filter((c) => c.op === 'fillText').length).toBe(0);
  });
});

function terrainWithWalls(walls: Array<[number, number]>): string[] {
  const rows = Array.from({ length: 50 }, () => '.'.repeat(50));
  for (const [x, y] of walls) {
    rows[y] = `${rows[y].slice(0, x)}#${rows[y].slice(x + 1)}`;
  }
  return rows;
}

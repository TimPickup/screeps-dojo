import { describe, it, expect } from 'vitest';
import { drawStaticStructures } from '../staticLayers';
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
    // extension shell = exactly one arc (dark body); creep/tombstone/energy add none.
    expect(log.filter((c) => c.op === 'arc').length).toBe(1);
  });

  it('draws an unowned level-0 controller as nothing (loader scaffold)', () => {
    const { ctx, log } = mockCtx();
    drawStaticStructures(ctx, frameWith([
      { _id: 'ctrl', type: 'controller', room: 'W1N1', x: 25, y: 25, level: 0 },
    ]), layout);
    expect(log.filter((c) => c.op === 'arc').length).toBe(0);
  });

  it('draws an owned controller base + level number', () => {
    const { ctx, log } = mockCtx();
    drawStaticStructures(ctx, frameWith([
      { _id: 'ctrl', type: 'controller', room: 'W1N1', x: 25, y: 25, level: 4, user: 'me' },
    ]), layout);
    expect(log.filter((c) => c.op === 'arc').length).toBe(1);       // base circle only (no progress core)
    expect(log.filter((c) => c.op === 'fillText').length).toBe(1);  // the "4"
  });
});

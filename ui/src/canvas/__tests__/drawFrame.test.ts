import { describe, expect, it } from 'vitest';
import type { Recording, StageLayout } from '../../api/types';
import { drawFrame } from '../drawFrame';
import { mockCtx } from './mockCtx';

describe('drawFrame spawn transition', () => {
  it('uses the normal movement interpolation when a spawning creep is released', () => {
    const recording = {
      meta: { scenario: 'spawn-transition', endReason: 'running', ticks: 2 },
      terrain: { W0N0: [] },
      frames: [
        { gameTime: 1, flags: [], objects: [
          { _id: 'creep', type: 'creep', room: 'W0N0', x: 10, y: 10, spawning: true },
        ] },
        { gameTime: 2, flags: [], objects: [
          { _id: 'creep', type: 'creep', room: 'W0N0', x: 11, y: 10, spawning: false },
        ] },
      ],
    } as Recording;
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const draws: Array<{ object: { spawning?: unknown }; x: number; y: number }> = [];
    const sprites = {
      draw: (_ctx: unknown, object: { spawning?: unknown }, x: number, y: number) => draws.push({ object, x, y }),
    };
    const layers = { terrain: {}, structure: {}, prepare: () => undefined };

    const { ctx } = mockCtx();
    drawFrame(ctx, recording, 0, 0.75, {
      sprites: sprites as never, layers: layers as never, layout, showVisuals: false,
    });

    expect(draws).toHaveLength(1);
    expect(draws[0].object.spawning).toBe(false);
    expect(draws[0].x).toBeCloseTo(10.5);
    expect(draws[0].y).toBe(10);
  });
});

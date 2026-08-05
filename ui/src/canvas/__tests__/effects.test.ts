import { describe, expect, it } from 'vitest';
import type { FrameObject, StageLayout } from '../../api/types';
import { drawActionEffects, drawHitPointsBar } from '../effects';
import { RENDER_COLORS } from '../renderConstants';
import { mockCtx } from './mockCtx';

describe('canvas effects', () => {
  it('draws a paused attack beam and target ring with the shared attack color', () => {
    const { ctx, log } = mockCtx();
    const object = {
      _id: 'creep', type: 'creep', room: 'W0N0', x: 10, y: 20,
      actionLog: { attack: { x: 12, y: 20 } },
    } as FrameObject;
    const offsets = { W0N0: { col: 0, row: 0 } } as StageLayout['offsets'];

    drawActionEffects(ctx, object, 10, 20, null, offsets, 'W0N0');

    expect(log.some((call) => call.op === 'set:strokeStyle' && call.args[0] === RENDER_COLORS.actions.attack)).toBe(true);
    expect(log.some((call) => call.op === 'moveTo' && call.args[0] === 10.5 && call.args[1] === 20.5)).toBe(true);
    expect(log.some((call) => call.op === 'lineTo' && call.args[0] === 12.5 && call.args[1] === 20.5)).toBe(true);
  });

  it("uses the shared health color for a damaged object's hit-point bar", () => {
    const { ctx, log } = mockCtx();
    const object = { hits: 50, hitsMax: 100 } as FrameObject;

    drawHitPointsBar(ctx, object, 3, 4, 1);

    expect(log.some((call) => call.op === 'set:fillStyle' && call.args[0] === RENDER_COLORS.health)).toBe(true);
  });
});

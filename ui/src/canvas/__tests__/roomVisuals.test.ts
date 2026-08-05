import { describe, expect, it } from 'vitest';
import { drawUserVisuals } from '../roomVisuals';
import { RENDER_COLORS } from '../renderConstants';
import { mockCtx } from './mockCtx';

describe('RoomVisual canvas replay', () => {
  it('draws an unstyled circle with the shared default fill', () => {
    const { ctx, log } = mockCtx();

    drawUserVisuals(ctx, JSON.stringify({ t: 'c', x: 2, y: 3 }), 10.5, 20.5);

    expect(log.some((call) => call.op === 'arc' && call.args[0] === 12.5 && call.args[1] === 23.5)).toBe(true);
    expect(log.some((call) => call.op === 'set:fillStyle' && call.args[0] === RENDER_COLORS.defaultFill)).toBe(true);
  });

  it('skips malformed commands and transparent rectangle fills', () => {
    const { ctx, log } = mockCtx();
    const commands = ['not-json', JSON.stringify({
      t: 'r', x: 1, y: 2, w: 3, h: 4, s: { fill: RENDER_COLORS.transparent },
    })].join('\n');

    drawUserVisuals(ctx, commands, 0, 0);

    expect(log.some((call) => call.op === 'fillRect')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { drawTerrain } from '../staticLayers';
import { mockCtx } from './mockCtx';

function rows(fill: string): string[] {
  // 50x50 all-plain except one wall at (3,4)
  const r: string[] = [];
  for (let y = 0; y < 50; y++) r.push(fill.repeat(50));
  const line = r[4].split(''); line[3] = '#'; r[4] = line.join('');
  return r;
}

describe('drawTerrain', () => {
  it('draws walls as rounded island paths rather than tile rectangles', () => {
    const { ctx, log } = mockCtx();
    drawTerrain(ctx, rows('.'));
    expect(log.some((call) => call.op === 'quadraticCurveTo')).toBe(true);
    expect(log.some((call) => call.op === 'fillRect'
      && call.args[0] === 3 && call.args[1] === 4 && call.args[2] === 1)).toBe(false);
  });

  it('does not emit a 1x1 fillRect for every plain tile', () => {
    const { ctx, log } = mockCtx();
    drawTerrain(ctx, rows('.'));
    const unitRects = log.filter((c) => c.op === 'fillRect' && c.args[2] === 1 && c.args[3] === 1);
    expect(unitRects.length).toBe(0);
  });

  it('draws left-border exit chevrons with base x=0.65 and tip x=0.2', () => {
    const { ctx, log } = mockCtx();
    // All-plain terrain with no walls means all borders are walkable
    const allPlain: string[] = [];
    for (let y = 0; y < 50; y++) allPlain.push('.'.repeat(50));
    drawTerrain(ctx, allPlain);
    const xs = (op: string) => log.filter((c) => c.op === op).map((c) => (c.args as number[])[0]);
    expect(xs('moveTo').some((x) => Math.abs(x - 0.65) < 1e-6)).toBe(true);
    expect(xs('lineTo').some((x) => Math.abs(x - 0.2) < 1e-6)).toBe(true);
  });
});

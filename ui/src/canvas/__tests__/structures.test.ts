import { describe, it, expect } from 'vitest';
import { drawStructureShell, connectRoads } from '../structures';
import { mockCtx } from './mockCtx';

// Count how many arc() calls (= circles) the shell emitted.
function arcs(log: { op: string }[]) { return log.filter((c) => c.op === 'arc').length; }
function fillRects(log: { op: string }[]) { return log.filter((c) => c.op === 'fillRect').length; }

describe('drawStructureShell — shells only, no fills', () => {
  it('extension draws exactly one circle (dark body), no energy core', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, 10, 10, 'extension');
    expect(arcs(log)).toBe(1); // core circle would be a 2nd arc
  });

  it('spawn draws exactly one circle (body), no energy core', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, 10, 10, 'spawn');
    expect(arcs(log)).toBe(1);
  });

  it('tower draws body circle + body rect + barrel, but no yellow fill rect', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, 10, 10, 'tower');
    // body rect (fill) + barrel rect (fill) = 2 fillRects; the energy fill rect (3rd) must be absent
    expect(arcs(log)).toBe(1);
    expect(fillRects(log)).toBe(2);
  });

  it('centres the shape at tile+0.5', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, 10, 20, 'extension');
    const arc = log.find((c) => c.op === 'arc') as { args: number[] };
    expect(arc.args.slice(0, 2)).toEqual([10.5, 20.5]);
  });
});

describe('connectRoads', () => {
  it('links two orthogonally-adjacent road tiles with a centred line', () => {
    const { ctx, log } = mockCtx();
    connectRoads(ctx, [[5, 5], [6, 5]]);
    const move = log.find((c) => c.op === 'moveTo') as { args: number[] };
    const lineTo = log.find((c) => c.op === 'lineTo') as { args: number[] };
    expect(move.args).toEqual([5.5, 5.5]);
    expect(lineTo.args).toEqual([6.5, 5.5]);
  });

  it('does not link diagonally-only or isolated tiles beyond the 4 checked dirs', () => {
    const { ctx, log } = mockCtx();
    connectRoads(ctx, [[5, 5]]); // isolated
    expect(log.some((c) => c.op === 'lineTo')).toBe(false);
  });
});

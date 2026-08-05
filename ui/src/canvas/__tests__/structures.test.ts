import { describe, it, expect } from 'vitest';
import { drawStructureShell, connectRoads } from '../structures';
import { RENDER_COLORS } from '../renderConstants';
import { mockCtx } from './mockCtx';
import type { FrameObject } from '../../api/types';

// Count how many arc() calls (= circles) the shell emitted.
function arcs(log: { op: string }[]) { return log.filter((c) => c.op === 'arc').length; }
function fillRects(log: { op: string }[]) { return log.filter((c) => c.op === 'fillRect').length; }
function structure(type: string, x: number, y: number, fields: Partial<FrameObject> = {}): FrameObject {
  return { _id: type, type, room: 'W0N0', x, y, ...fields } as FrameObject;
}

describe('drawStructureShell — shells only, no fills', () => {
  it('extension draws its dark shell and empty backing, but no energy core', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, structure('extension', 10, 10));
    const circles = log.filter((call) => call.op === 'arc');
    expect(circles.map((call) => call.args[2])).toEqual([0.5, 0.35]);
    const colors = log.filter((call) => call.op === 'set:fillStyle').map((call) => call.args[0]);
    expect(colors).toEqual([RENDER_COLORS.structure.dark, RENDER_COLORS.structure.medium]);
  });

  it('spawn draws exactly one circle (body), no energy core', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, structure('spawn', 10, 10));
    expect(arcs(log)).toBe(1);
  });

  it('tower draws only its cached body, leaving the turret dynamic', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, structure('tower', 10, 10));
    expect(arcs(log)).toBe(1);
    expect(fillRects(log)).toBe(0);
  });

  it('centres the shape at tile+0.5', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, structure('extension', 10, 20));
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

describe('extractor shell', () => {
  it('draws three alternating sixth-circle arcs around the mineral centre', () => {
    const { ctx, log } = mockCtx();
    drawStructureShell(ctx, structure('extractor', 10, 20, { user: 'me', my: true }));
    const calls = log.filter((call) => call.op === 'arc');
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.args.slice(0, 3)).toEqual([10.5, 20.5, 0.8]);
      expect((call.args[4] as number) - (call.args[3] as number)).toBeCloseTo(Math.PI / 3);
    }
  });
});

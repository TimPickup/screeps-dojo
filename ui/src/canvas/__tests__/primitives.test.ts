import { describe, it, expect } from 'vitest';
import { circle, poly, rect, line, text } from '../primitives';
import { mockCtx, ops, lastSet } from './mockCtx';

describe('primitives', () => {
  it('circle fills and strokes when both given', () => {
    const { ctx, log } = mockCtx();
    circle(ctx, 5, 5, { radius: 0.5, fill: '#111', stroke: '#8FBB93', strokeWidth: 0.05 });
    expect(ops(log)).toEqual(['save', 'beginPath', 'arc', 'fill', 'stroke', 'restore']);
    const arc = log.find((c) => c.op === 'arc')!;
    expect(arc.args.slice(0, 3)).toEqual([5, 5, 0.5]);
  });

  it('circle with no fill only strokes', () => {
    const { ctx, log } = mockCtx();
    circle(ctx, 1, 2, { radius: 0.3, stroke: '#fff' });
    expect(ops(log)).toEqual(['save', 'beginPath', 'arc', 'stroke', 'restore']);
  });

  it('circle treats transparent fill as no fill', () => {
    const { ctx, log } = mockCtx();
    circle(ctx, 0, 0, { fill: 'transparent', stroke: '#fff' });
    expect(ops(log)).not.toContain('fill');
  });

  it('poly draws a closed path through all points then fills', () => {
    const { ctx, log } = mockCtx();
    poly(ctx, [[0, 0], [1, 0], [1, 1]], { fill: '#222' });
    expect(ops(log)).toEqual(['save', 'beginPath', 'moveTo', 'lineTo', 'lineTo', 'closePath', 'fill', 'restore']);
  });

  it('rect fills at the given box', () => {
    const { ctx, log } = mockCtx();
    rect(ctx, 2, 3, 0.8, 0.6, { fill: '#555' });
    const fr = log.find((c) => c.op === 'fillRect')!;
    expect(fr.args).toEqual([2, 3, 0.8, 0.6]);
  });

  it('line strokes between endpoints', () => {
    const { ctx, log } = mockCtx();
    line(ctx, 0, 0, 1, 1, { stroke: '#666', strokeWidth: 0.35 });
    expect(ops(log)).toEqual(['save', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'restore']);
  });

  it('text renders the string', () => {
    const { ctx, log } = mockCtx();
    text(ctx, '7', 5, 5, { font: 0.5, fill: '#fff' });
    const ft = log.find((c) => c.op === 'fillText')!;
    expect(ft.args[0]).toBe('7');
  });

  it('stroke-only circle and rect default lineWidth to 0.05 (matches svgPrimitives)', () => {
    const a = mockCtx();
    circle(a.ctx, 0, 0, { stroke: '#fff' });
    expect(lastSet(a.log, 'lineWidth')).toBe(0.05);
    const b = mockCtx();
    rect(b.ctx, 0, 0, 1, 1, { stroke: '#fff' });
    expect(lastSet(b.log, 'lineWidth')).toBe(0.05);
  });
});

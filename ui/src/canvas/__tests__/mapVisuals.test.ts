import { describe, expect, it } from 'vitest';
import { drawMapVisuals } from '../mapVisuals';
import { RENDER_COLORS } from '../renderConstants';
import { mockCtx } from './mockCtx';

const offsets = { W1N1: { col: 0, row: 0 }, W0N1: { col: 1, row: 0 } };

describe('MapVisual canvas replay', () => {
  it('places a circle by its own room with the map-scale defaults', () => {
    const { ctx, log } = mockCtx();

    drawMapVisuals(ctx, JSON.stringify({ t: 'c', x: 25, y: 25, n: 'W0N1' }), offsets);

    const arc = log.find((call) => call.op === 'arc');
    expect(arc?.args.slice(0, 3)).toEqual([75.5, 25.5, 10]);
    expect(log.some((call) => call.op === 'set:fillStyle' && call.args[0] === RENDER_COLORS.defaultFill)).toBe(true);
  });

  it('draws a line across rooms and skips one that leaves the stage', () => {
    const { ctx, log } = mockCtx();
    const commands = [
      { t: 'l', x1: 10, y1: 10, n1: 'W1N1', x2: 10, y2: 10, n2: 'W0N1' },
      { t: 'l', x1: 10, y1: 10, n1: 'W1N1', x2: 10, y2: 10, n2: 'E5N5' },
    ].map((command) => JSON.stringify(command)).join('\n');

    drawMapVisuals(ctx, commands, offsets);

    expect(log.filter((call) => call.op === 'lineTo').map((call) => call.args)).toEqual([[60.5, 10.5]]);
  });
});

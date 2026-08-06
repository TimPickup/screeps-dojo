import { describe, expect, it } from 'vitest';
import type { FrameObject } from '../../api/types';
import { CreepRenderer } from '../creeps';
import { RENDER_COLORS } from '../renderConstants';
import { mockCtx } from './mockCtx';

function creep(overrides: Partial<FrameObject> = {}): FrameObject {
  return {
    _id: 'creep-1', type: 'creep', room: 'W1N1', x: 10, y: 10,
    user: 'me', my: true,
    body: [{ type: 'move', hits: 100 }, { type: 'work', hits: 100 }],
    store: { energy: 25 }, storeCapacity: 50, ...overrides,
  };
}

describe('native canvas creep renderer', () => {
  it('draws a body-part creep with native Canvas2D paths', () => {
    const { ctx, log } = mockCtx();
    new CreepRenderer().draw(ctx, creep(), 10, 10, 0, 1);
    expect(log.some((call) => call.op === 'drawImage')).toBe(false);
    expect(log.filter((call) => call.op === 'arc').length).toBeGreaterThanOrEqual(5);
    expect(log.some((call) => call.op === 'set:fillStyle' && call.args[0] === RENDER_COLORS.ownership.bot)).toBe(true);
  });

  it('stacks ranged attack with heal at the top of the body ring', () => {
    const { ctx, log } = mockCtx();
    new CreepRenderer().draw(ctx, creep({
      store: {},
      body: [
        { type: 'heal', hits: 100 },
        { type: 'ranged_attack', hits: 100 },
        { type: 'move', hits: 100 },
      ],
    }), 10, 10, 0, 1);
    const arcForColor = (color: string) => {
      const colorIndex = log.findIndex((call) => call.op === 'set:strokeStyle' && call.args[0] === color);
      const arc = log.slice(0, colorIndex).reverse().find((call) => call.op === 'arc');
      return { colorIndex, span: (arc?.args[4] as number) - (arc?.args[3] as number) };
    };
    const ranged = arcForColor(RENDER_COLORS.creep.rangedAttack);
    const heal = arcForColor(RENDER_COLORS.creep.heal);
    expect(ranged.colorIndex).toBeGreaterThan(-1);
    expect(heal.colorIndex).toBeGreaterThan(ranged.colorIndex);
    expect(ranged.span).toBeCloseTo(2 * 360 / 50 * Math.PI / 180);
    expect(heal.span).toBeCloseTo(360 / 50 * Math.PI / 180);
  });

  it('draws TOUGH as a full ring with count-scaled width and opacity', () => {
    const toughStroke = (count: number) => {
      const { ctx, log } = mockCtx();
      new CreepRenderer().draw(ctx, creep({
        store: {},
        body: Array.from({ length: count }, () => ({ type: 'tough', hits: 100 })),
      }), 10, 10, 0, 1);
      const colorIndex = log.findIndex((call) => call.op === 'set:strokeStyle' && call.args[0] === RENDER_COLORS.creep.tough);
      const arc = log.slice(0, colorIndex).reverse().find((call) => call.op === 'arc');
      const width = log.slice(colorIndex).find((call) => call.op === 'set:lineWidth');
      const alpha = log.slice(0, colorIndex).reverse().find((call) => call.op === 'set:globalAlpha');
      return { arc, width: width?.args[0] as number, alpha: alpha?.args[0] as number };
    };

    const one = toughStroke(1);
    const twenty = toughStroke(20);
    const fifty = toughStroke(50);
    expect((one.arc?.args[4] as number) - (one.arc?.args[3] as number)).toBeCloseTo(Math.PI * 2);
    expect(one.width).toBeCloseTo(0.003);
    expect(twenty.width).toBeCloseTo(0.06);
    expect(fifty.width).toBeCloseTo(0.15);
    expect(one.alpha).toBeCloseTo(0.5);
    expect(twenty.alpha).toBeCloseTo(0.5 + 0.5 * 19 / 49);
    expect(fifty.alpha).toBeCloseTo(1);
  });

  it('draws the invader as a native polygon', () => {
    const { ctx, log } = mockCtx();
    new CreepRenderer().draw(ctx, creep({ user: '2', my: false }), 10, 10, 90, 0.5);
    expect(log.some((call) => call.op === 'drawImage')).toBe(false);
    expect(log.filter((call) => call.op === 'lineTo')).toHaveLength(4);
    expect(log.some((call) => call.op === 'set:fillStyle' && call.args[0] === RENDER_COLORS.creep.invaderBody)).toBe(true);
  });
});

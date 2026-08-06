import { describe, expect, it } from 'vitest';
import type { FrameObject } from '../../api/types';
import { drawDeposit } from '../deposits';
import { DEPOSIT_RENDER_STYLE, RENDER_COLORS } from '../renderConstants';
import { mockCtx } from './mockCtx';

describe('deposit rendering', () => {
  it('reproduces the supplied biomass outline and its two finer details', () => {
    const { ctx, log } = mockCtx();
    drawDeposit(ctx, {
      _id: 'biomass', type: 'deposit', depositType: 'biomass', room: 'W0N0', x: 10, y: 20,
    } as FrameObject);

    expect(log.filter((call) => call.op === 'stroke')).toHaveLength(3);
    expect(log.filter((call) => call.op === 'fill')).toHaveLength(1);
    expect(log.filter((call) => call.op === 'bezierCurveTo').length).toBeGreaterThan(10);
    expect(log.some((call) => call.op === 'set:strokeStyle'
      && call.args[0] === RENDER_COLORS.deposit.biomass)).toBe(true);
    const fillIndex = log.findIndex((call) => call.op === 'fill');
    expect(log.slice(0, fillIndex).some((call) => call.op === 'set:fillStyle'
      && call.args[0] === RENDER_COLORS.deposit.biomass)).toBe(true);
    expect(log.slice(0, fillIndex).reverse().find((call) => call.op === 'set:globalAlpha')?.args[0])
      .toBe(DEPOSIT_RENDER_STYLE.fillOpacity);
    expect(log.some((call) => call.op === 'scale'
      && call.args[0] === DEPOSIT_RENDER_STYLE.size / 132
      && call.args[1] === DEPOSIT_RENDER_STYLE.size / 132)).toBe(true);
  });

  it('reproduces the supplied metal outline and its two finer details', () => {
    const { ctx, log } = mockCtx();
    drawDeposit(ctx, {
      _id: 'metal', type: 'deposit', depositType: 'metal', room: 'W0N0', x: 10, y: 20,
    } as FrameObject);

    expect(log.filter((call) => call.op === 'stroke')).toHaveLength(3);
    expect(log.filter((call) => call.op === 'fill')).toHaveLength(1);
    expect(log.filter((call) => call.op === 'bezierCurveTo').length).toBeGreaterThan(10);
    expect(log.some((call) => call.op === 'set:strokeStyle'
      && call.args[0] === RENDER_COLORS.deposit.metal)).toBe(true);
    const fillIndex = log.findIndex((call) => call.op === 'fill');
    expect(log.slice(0, fillIndex).some((call) => call.op === 'set:fillStyle'
      && call.args[0] === RENDER_COLORS.deposit.metal)).toBe(true);
    expect(log.slice(0, fillIndex).reverse().find((call) => call.op === 'set:globalAlpha')?.args[0])
      .toBe(DEPOSIT_RENDER_STYLE.fillOpacity);
    // The metal artwork is wider than it is tall, so its longest side sets the scale.
    expect(log.some((call) => call.op === 'scale'
      && call.args[0] === DEPOSIT_RENDER_STYLE.size / 132
      && call.args[1] === DEPOSIT_RENDER_STYLE.size / 132)).toBe(true);
    // Centred on the tile despite the shorter viewBox height.
    expect(log.some((call) => call.op === 'translate'
      && Math.abs(Number(call.args[1]) - (20.5 - 117.54 * (DEPOSIT_RENDER_STYLE.size / 132) / 2)) < 1e-9))
      .toBe(true);
  });

  it('reproduces the supplied mist outline and its funnel detail', () => {
    const { ctx, log } = mockCtx();
    drawDeposit(ctx, {
      _id: 'mist', type: 'deposit', depositType: 'mist', room: 'W0N0', x: 10, y: 20,
    } as FrameObject);

    // Body fill, funnel detail, body outline.
    expect(log.filter((call) => call.op === 'fill')).toHaveLength(1);
    expect(log.filter((call) => call.op === 'stroke')).toHaveLength(2);
    expect(log.some((call) => call.op === 'set:strokeStyle'
      && call.args[0] === RENDER_COLORS.deposit.mist)).toBe(true);
    expect(log.some((call) => call.op === 'scale'
      && call.args[0] === DEPOSIT_RENDER_STYLE.size / 141.67)).toBe(true);
  });

  it('draws the silicon chip body with all eight pins at the outline weight', () => {
    const { ctx, log } = mockCtx();
    drawDeposit(ctx, {
      _id: 'silicon', type: 'deposit', depositType: 'silicon', room: 'W0N0', x: 10, y: 20,
    } as FrameObject);

    const scale = DEPOSIT_RENDER_STYLE.size / 128;
    // Rounded-rect body, filled then outlined, so eight arcTo calls in total.
    expect(log.filter((call) => call.op === 'arcTo')).toHaveLength(8);
    expect(log.filter((call) => call.op === 'fill')).toHaveLength(1);
    // One stroke for the pins, one for the body outline.
    expect(log.filter((call) => call.op === 'stroke')).toHaveLength(2);
    expect(log.filter((call) => call.op === 'lineTo')).toHaveLength(8);
    // Pins share the outline weight and keep flat ends.
    expect(log.filter((call) => call.op === 'set:lineWidth').map((call) => call.args[0]))
      .toEqual([
        DEPOSIT_RENDER_STYLE.outlineWidth / scale,
        DEPOSIT_RENDER_STYLE.outlineWidth / scale,
      ]);
    expect(log.some((call) => call.op === 'set:lineCap' && call.args[0] === 'butt')).toBe(true);
  });

  it('does not substitute another deposit shape for an unsupported deposit type', () => {
    const { ctx, log } = mockCtx();
    drawDeposit(ctx, {
      _id: 'unknown', type: 'deposit', depositType: 'unobtainium', room: 'W0N0', x: 10, y: 20,
    } as FrameObject);
    expect(log).toHaveLength(0);
  });
});

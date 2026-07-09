import { describe, it, expect } from 'vitest';
import {
  energyFillFraction, drawExtensionFill, drawSourceCore, drawDroppedResource, CONTROLLER_LEVELS, drawControllerProgress,
} from '../dynamic';
import { mockCtx } from './mockCtx';
import type { FrameObject } from '../../api/types';

const ext = (energy: number): FrameObject => ({ _id: 'e', type: 'extension', room: 'W1N1', x: 0, y: 0, store: { energy }, storeCapacityResource: { energy: 200 } } as unknown as FrameObject);

describe('energy fills', () => {
  it('energyFillFraction is store/cap clamped', () => {
    expect(energyFillFraction(ext(100))).toBeCloseTo(0.5);
    expect(energyFillFraction(ext(0))).toBe(0);
  });

  it('drawExtensionFill draws a yellow core scaled by fill', () => {
    const { ctx, log } = mockCtx();
    drawExtensionFill(ctx, ext(200), 5.5, 5.5);
    const arc = log.find((c) => c.op === 'arc') as { args: number[] };
    expect(arc).toBeTruthy();
    expect(arc.args[2]).toBeCloseTo(0.35); // radius = 0.35 * fraction(=1)
  });

  it('drawExtensionFill draws NOTHING when empty (the stale-fill bug this fixes)', () => {
    const { ctx, log } = mockCtx();
    drawExtensionFill(ctx, ext(0), 5.5, 5.5);
    expect(log.some((c) => c.op === 'arc')).toBe(false);
  });

  it('drawSourceCore hides when depleted', () => {
    const { ctx, log } = mockCtx();
    drawSourceCore(ctx, { energy: 0, energyCapacity: 3000 } as unknown as FrameObject, 1.5, 1.5);
    expect(log.some((c) => c.op === 'arc')).toBe(false);
  });
});

describe('dropped resource', () => {
  it('scales radius with amount, energy is yellow', () => {
    const { ctx, log } = mockCtx();
    drawDroppedResource(ctx, 3.5, 3.5, 1000, 'energy');
    const arc = log.find((c) => c.op === 'arc') as { args: number[] };
    expect(arc.args[2]).toBeCloseTo(0.3); // 0.15 + 0.15 * min(1, 1000/1000)
  });
});

describe('constants', () => {
  it('has controller level totals', () => {
    expect(CONTROLLER_LEVELS[8]).toBeFalsy();
    expect(CONTROLLER_LEVELS[7]).toBeGreaterThan(0);
    expect(CONTROLLER_LEVELS[1]).toBeGreaterThan(0);
  });
});

describe('controller progress', () => {
  it('drawControllerProgress draws nothing for a maxed (level 8) controller, even with progress', () => {
    const { ctx, log } = mockCtx();
    drawControllerProgress(ctx, { level: 8, progress: 5_000_000 } as any, 5.5, 5.5);
    expect(log.some((c) => c.op === 'arc')).toBe(false);
  });
  it('drawControllerProgress draws a progress core+arc for a mid-level controller', () => {
    const { ctx, log } = mockCtx();
    drawControllerProgress(ctx, { level: 4, progress: 200000 } as any, 5.5, 5.5);
    expect(log.some((c) => c.op === 'arc')).toBe(true);
  });
});

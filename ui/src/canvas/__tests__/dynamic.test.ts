import { describe, it, expect } from 'vitest';
import {
  energyFillFraction, drawExtensionFill, drawTerminalFill, drawLabFill, drawTowerTurret, towerTurretAngle, drawSourceCore, drawDroppedResource, CONTROLLER_LEVELS, drawControllerProgress,
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

describe('terminal fill', () => {
  it('draws cumulative centred squares from other to energy', () => {
    const { ctx, log } = mockCtx();
    drawTerminalFill(ctx, {
      storeCapacity: 300,
      store: { energy: 100, utrium: 100 },
    } as unknown as FrameObject, 5.5, 5.5);

    const fills = log.filter((call) => call.op === 'fillRect');
    expect(fills).toHaveLength(2);
    expect(fills[0].args).toEqual([5.2, 5.2, 0.6, 0.6]);
    expect(fills[1].args).toEqual([5.35, 5.35, 0.3, 0.3]);
    const colors = log.filter((call) => call.op === 'set:fillStyle').map((call) => call.args[0]);
    expect(colors).toEqual(['#FFF', '#FFE87B']);
  });

  it('fills the complete inner terminal square at full capacity', () => {
    const { ctx, log } = mockCtx();
    drawTerminalFill(ctx, {
      storeCapacity: 300,
      store: { energy: 300 },
    } as unknown as FrameObject, 5.5, 5.5);
    const fill = log.find((call) => call.op === 'fillRect');
    expect(fill?.args).toEqual([5.05, 5.05, 0.9, 0.9]);
  });

  it('nests power between other resources and energy', () => {
    const { ctx, log } = mockCtx();
    drawTerminalFill(ctx, {
      storeCapacity: 300,
      store: { energy: 100, power: 100, utrium: 100 },
    } as unknown as FrameObject, 5.5, 5.5);
    const sizes = log.filter((call) => call.op === 'fillRect').map((call) => call.args[2]);
    expect(sizes).toEqual([0.9, 0.6, 0.3]);
    const colors = log.filter((call) => call.op === 'set:fillStyle').map((call) => call.args[0]);
    expect(colors).toEqual(['#FFF', '#F00', '#FFE87B']);
  });
});

describe('lab fill', () => {
  it('draws the compound as an expanding white circle and energy left-to-right', () => {
    const { ctx, log } = mockCtx();
    drawLabFill(ctx, {
      store: { energy: 1000, XGH2O: 1500 },
      storeCapacityResource: { energy: 2000, XGH2O: 3000 },
    } as unknown as FrameObject, 5.5, 5.5);

    const compound = log.find((call) => call.op === 'arc');
    expect(compound?.args).toEqual([5.5, 5.475, 0.2, 0, Math.PI * 2]);
    const energy = log.find((call) => call.op === 'fillRect');
    expect(energy?.args).toEqual([5.075, 5.825, 0.425, 0.2]);
    const colors = log.filter((call) => call.op === 'set:fillStyle').map((call) => call.args[0]);
    expect(colors).toEqual(['#FFF', '#FFE87B']);
  });

  it('uses the standard compound capacity when raw lab data omits it', () => {
    const { ctx, log } = mockCtx();
    drawLabFill(ctx, {
      store: { energy: 0, ZK: 3000 },
      storeCapacityResource: { energy: 2000 },
    } as unknown as FrameObject, 1.5, 1.5);

    const compound = log.find((call) => call.op === 'arc');
    expect(compound?.args[2]).toBeCloseTo(0.4);
    expect(log.some((call) => call.op === 'fillRect')).toBe(false);
  });
});

describe('tower turret', () => {
  type TowerTargetKey = 'attack' | 'heal' | 'repair';
  const tower = (actionLog?: FrameObject['actionLog']) => ({
    _id: 'tower', type: 'tower', room: 'W0N0', x: 10, y: 10, actionLog,
  } as FrameObject);

  it('rotates deterministically from replay time while idle', () => {
    const { ctx, log } = mockCtx();
    drawTowerTurret(ctx, {
      ...tower(), store: { energy: 500 }, storeCapacityResource: { energy: 1000 },
    }, 10.5, 10.5, 2);
    expect(towerTurretAngle(tower(), 2)).toBeCloseTo(Math.PI / 2);
    expect(log.find((call) => call.op === 'translate')?.args).toEqual([10.5, 10.5]);
    expect(log.find((call) => call.op === 'rotate')?.args[0]).toBeCloseTo(Math.PI / 2);
    expect(log.filter((call) => call.op === 'arcTo')).toHaveLength(4);
    expect(log.filter((call) => call.op === 'clip')).toHaveLength(1);
    const rectangles = log.filter((call) => call.op === 'fillRect');
    expect(rectangles.map((call) => call.args)).toEqual([
      [-0.4, -0.3, 0.8, 0.6],
      [-0.4, 0, 0.8, 0.3],
      [-0.2, -0.9, 0.4, 0.5],
    ]);
  });

  const actions: Array<[string, TowerTargetKey, { x: number; y: number }, number]> = [
    ['attacks', 'attack', { x: 11, y: 10 }, Math.PI / 2],
    ['heals', 'heal', { x: 10, y: 9 }, 0],
    ['repairs', 'repair', { x: 10, y: 11 }, Math.PI],
  ];
  for (const [label, action, target, expected] of actions) {
    it(`faces its target when it ${label}`, () => {
      expect(towerTurretAngle(tower({ [action]: target }), 123)).toBeCloseTo(expected);
    });
  }
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

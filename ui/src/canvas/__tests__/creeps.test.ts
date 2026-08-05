import { describe, expect, it } from 'vitest';
import type { FrameObject } from '../../api/types';
import { CreepRenderer } from '../creeps';
import { mockCtx } from './mockCtx';

function creep(overrides: Partial<FrameObject> = {}): FrameObject {
  return {
    _id: 'creep-1', type: 'creep', room: 'W1N1', x: 10, y: 10,
    user: 'me', body: [{ type: 'move', hits: 100 }, { type: 'work', hits: 100 }],
    store: { energy: 25 }, storeCapacity: 50, ...overrides,
  };
}

describe('native canvas creep renderer', () => {
  it('draws a body-part creep with native Canvas2D paths', () => {
    const { ctx, log } = mockCtx();
    new CreepRenderer('me').draw(ctx, creep(), 10, 10, 0, 1);
    expect(log.some((call) => call.op === 'drawImage')).toBe(false);
    expect(log.filter((call) => call.op === 'arc').length).toBeGreaterThanOrEqual(5);
    expect(log.some((call) => call.op === 'set:fillStyle' && call.args[0] === '#5577ff')).toBe(true);
  });

  it('draws the invader as a native polygon', () => {
    const { ctx, log } = mockCtx();
    new CreepRenderer('me').draw(ctx, creep({ user: '2' }), 10, 10, 90, 0.5);
    expect(log.some((call) => call.op === 'drawImage')).toBe(false);
    expect(log.filter((call) => call.op === 'lineTo')).toHaveLength(4);
    expect(log.some((call) => call.op === 'set:fillStyle' && call.args[0] === '#e51f36')).toBe(true);
  });
});

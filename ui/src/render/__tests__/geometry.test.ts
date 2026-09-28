import { describe, expect, it } from 'vitest';
import type { Frame, FrameObject } from '../../api/types';
import { computeStageLayout, creepFacing, FacingCache } from '../geometry';

function creep(id: string, x: number, y: number, actionLog?: FrameObject['actionLog']): FrameObject {
  return { _id: id, type: 'creep', room: 'W0N0', x, y, actionLog } as FrameObject;
}

function powerCreep(id: string, x: number, y: number, actionLog?: FrameObject['actionLog']): FrameObject {
  return { _id: id, type: 'powerCreep', room: 'W0N0', x, y, actionLog } as FrameObject;
}

function frame(...objects: FrameObject[]): Frame {
  return { gameTime: 0, objects, flags: [] };
}

describe('creepFacing cache', () => {
  const layout = computeStageLayout(['W0N0']);

  it('carries the last movement angle through stationary ticks', () => {
    const frames = [frame(creep('c', 1, 1)), frame(creep('c', 2, 1)), frame(creep('c', 2, 1)), frame(creep('c', 2, 1))];
    expect(creepFacing(frames, 0, 'c', layout)).toBe(0);
    expect(creepFacing(frames, 3, 'c', layout)).toBe(0);
  });

  it('holds an action angle through the stationary ticks that follow it', () => {
    const frames = [
      frame(creep('c', 1, 1)),
      frame(creep('c', 2, 1)),
      frame(creep('c', 2, 1, { harvest: { x: 2, y: 0 } })),
      frame(creep('c', 2, 1)),
    ];
    // Turns north to harvest on tick 2, then stands still: it keeps facing the
    // source rather than snapping back to the east it last walked.
    expect(creepFacing(frames, 1, 'c', layout)).toBe(-90);
    expect(creepFacing(frames, 3, 'c', layout)).toBe(-90);
  });

  it('turns a power creep toward its power target but ignores a self-target', () => {
    const frames = [
      frame(powerCreep('c', 2, 1)),
      frame(powerCreep('c', 2, 1, { power: { x: 2, y: 0 } })),
      frame(powerCreep('c', 2, 1, { power: { x: 2, y: 1 } })),
      frame(powerCreep('c', 2, 1)),
    ];
    // Turns north toward the power target (same convention as a creep's
    // harvest target above).
    expect(creepFacing(frames, 0, 'c', layout)).toBe(-90);
    // GENERATE_OPS/SHIELD log the power creep's own tile as the target.
    // facingDelta returns undefined for dx = dy = 0, so the previous heading
    // (north, from the tick before) is kept rather than reset to 0.
    expect(creepFacing(frames, 1, 'c', layout)).toBe(-90);
  });

  it('updates the previous final frame when a live recording appends', () => {
    const frames = [frame(creep('c', 1, 1))];
    expect(creepFacing(frames, 0, 'c', layout, 45)).toBe(45);
    frames.push(frame(creep('c', 1, 2)));
    expect(creepFacing(frames, 0, 'c', layout, 45)).toBe(90);
    expect(creepFacing(frames, 1, 'c', layout, 45)).toBe(90);
  });

  it('keeps at most the last frame index once facings are resolved', () => {
    const frames = Array.from({ length: 50 }, (_, i) => frame(creep('c', 1 + (i % 2), 1)));
    const cache = new FacingCache(frames, layout);
    expect(cache.retainedIndexes()).toBeLessThanOrEqual(2);
    frames.push(frame(creep('c', 5, 5)));
    expect(cache.get(49, 'c', 0)).toBe(Math.atan2(4, 4 - (49 % 2)) * 180 / Math.PI);
    expect(cache.retainedIndexes()).toBeLessThanOrEqual(2);
    // Resolved values survive for every earlier frame (scrubbing back).
    expect(cache.get(0, 'c', 7)).toBe(0);
    expect(cache.get(1, 'c', 7)).toBe(180);
  });
});

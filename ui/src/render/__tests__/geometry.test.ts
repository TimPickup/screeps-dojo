import { describe, expect, it } from 'vitest';
import type { Frame, FrameObject } from '../../api/types';
import { computeStageLayout, creepFacing } from '../geometry';

function creep(id: string, x: number, y: number, actionLog?: FrameObject['actionLog']): FrameObject {
  return { _id: id, type: 'creep', room: 'W0N0', x, y, actionLog } as FrameObject;
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

  it('uses an action for the current facing without replacing movement history', () => {
    const frames = [
      frame(creep('c', 1, 1)),
      frame(creep('c', 2, 1)),
      frame(creep('c', 2, 1, { harvest: { x: 2, y: 0 } })),
      frame(creep('c', 2, 1)),
    ];
    expect(creepFacing(frames, 1, 'c', layout)).toBe(-90);
    expect(creepFacing(frames, 3, 'c', layout)).toBe(0);
  });

  it('updates the previous final frame when a live recording appends', () => {
    const frames = [frame(creep('c', 1, 1))];
    expect(creepFacing(frames, 0, 'c', layout, 45)).toBe(45);
    frames.push(frame(creep('c', 1, 2)));
    expect(creepFacing(frames, 0, 'c', layout, 45)).toBe(90);
    expect(creepFacing(frames, 1, 'c', layout, 45)).toBe(90);
  });
});

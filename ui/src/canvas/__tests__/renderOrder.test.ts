import { describe, expect, it } from 'vitest';
import type { Frame, StageLayout } from '../../api/types';
import { frameObjectsInDrawOrder } from '../renderOrder';

const layout = {
  rooms: ['W0N0', 'W0S0'],
  offsets: {
    W0N0: { col: 0, row: 0 },
    W0S0: { col: 0, row: 1 },
  },
  pixelsPerRoom: 600,
  width: 600,
  height: 1200,
} as StageLayout;

describe('frame object draw order', () => {
  it('orders objects by ascending world y and preserves recording order for ties', () => {
    const frame = {
      gameTime: 1,
      flags: [],
      objects: [
        { _id: 'bottom-room', type: 'creep', room: 'W0S0', x: 10, y: 0 },
        { _id: 'top-room-tie-a', type: 'creep', room: 'W0N0', x: 20, y: 10 },
        { _id: 'top-room-upper', type: 'creep', room: 'W0N0', x: 10, y: 5 },
        { _id: 'top-room-tie-b', type: 'creep', room: 'W0N0', x: 5, y: 10 },
      ],
    } as Frame;

    expect(frameObjectsInDrawOrder(frame, layout).map((object) => object._id)).toEqual([
      'top-room-upper',
      'top-room-tie-a',
      'top-room-tie-b',
      'bottom-room',
    ]);
  });

  it('reuses the cached order for the same immutable frame and layout', () => {
    const frame = { gameTime: 1, flags: [], objects: [] } as Frame;
    expect(frameObjectsInDrawOrder(frame, layout)).toBe(frameObjectsInDrawOrder(frame, layout));
  });
});

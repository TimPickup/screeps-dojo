import { describe, expect, it } from 'vitest';
import type { Frame } from '../../api/types';
import { populateFrameMy } from '../ownership';

describe('populateFrameMy', () => {
  it('derives my from the existing bot user id without changing user', () => {
    const frame = {
      gameTime: 1,
      flags: [],
      objects: [
        { _id: 'mine', type: 'controller', room: 'W1N1', x: 1, y: 1, user: 'user1' },
        { _id: 'enemy', type: 'controller', room: 'W1N1', x: 2, y: 2, user: 'user2' },
        { _id: 'npc', type: 'creep', room: 'W1N1', x: 3, y: 3, user: '2' },
        { _id: 'neutral', type: 'controller', room: 'W1N1', x: 4, y: 4 },
      ],
    } as Frame;

    populateFrameMy(frame, 'user1');

    expect(frame.objects[0]).toMatchObject({ my: true, user: 'user1' });
    expect(frame.objects[1]).toMatchObject({ my: false, user: 'user2' });
    expect(frame.objects[2]).toMatchObject({ my: false, user: '2' });
    expect(frame.objects[3].my).toBe(false);
  });

  it('recognises the friendly me tag used by previews and the editor', () => {
    const frame = {
      gameTime: 0, flags: [],
      objects: [{ _id: 'preview', type: 'spawn', room: 'W1N1', x: 1, y: 1, user: 'me' }],
    } as Frame;
    populateFrameMy(frame);
    expect(frame.objects[0].my).toBe(true);
  });
});

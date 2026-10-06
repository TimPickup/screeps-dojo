import { describe, expect, it } from 'vitest';
import type { Frame, StageLayout } from '../../api/types';
import { objectById, objectsByRoom, roomRampartKeys, roomStructureKeys, roomTerrainKeys } from '../roomIndex';

const layout = { offsets: { A: { col: 0, row: 0 }, B: { col: 1, row: 0 } } } as unknown as StageLayout;
const f = (objects: object[], flags: object[] = []) => ({ gameTime: 1, flags, objects }) as unknown as Frame;
const road = (room: string, x: number, hits = 5000) => ({ _id: room + x, type: 'road', room, x, y: 1, hits });

describe('room index', () => {
  it('groups objects by room in draw order and caches per frame', () => {
    const frame = f([road('B', 1), road('A', 2), { _id: 'c', type: 'creep', room: 'A', x: 0, y: 0 }]);
    const byRoom = objectsByRoom(frame, layout);
    expect(byRoom.get('A')!.map((o) => o._id)).toEqual(['c', 'A2']);
    expect(objectsByRoom(frame, layout)).toBe(byRoom);
  });
  it('changes only the room whose structures changed', () => {
    const before = roomStructureKeys(f([road('A', 1), road('B', 1)]), layout);
    const decayed = roomStructureKeys(f([road('A', 1, 100), road('B', 1)]), layout);
    const gone = roomStructureKeys(f([road('B', 1)]), layout);
    expect(decayed.get('A')).toBe(before.get('A'));        // hits never matter
    expect(gone.get('A')).not.toBe(before.get('A'));
    expect(gone.get('B')).toBe(before.get('B'));
  });
  it('keys a room by its flags too', () => {
    const plain = roomStructureKeys(f([]), layout);
    const flagged = roomStructureKeys(f([], [{ room: 'B', name: 'x', x: 1, y: 1 }]), layout);
    expect(flagged.get('A')).toBe(plain.get('A'));
    expect(flagged.get('B')).not.toBe(plain.get('B'));
  });
  it('keys ramparts per room by position, owner side and public flag', () => {
    const rp = (x: number, extra = {}) => ({ _id: 'r' + x, type: 'rampart', room: 'A', x, y: 1, hits: 1, ...extra });
    const a = roomRampartKeys(f([rp(1)]), layout).get('A');
    expect(roomRampartKeys(f([rp(1, { hits: 9 })]), layout).get('A')).toBe(a);
    expect(roomRampartKeys(f([rp(1, { isPublic: true })]), layout).get('A')).not.toBe(a);
    expect(roomRampartKeys(f([rp(1)]), layout).get('B')).toBe(roomRampartKeys(f([]), layout).get('B'));
  });
  it('keys terrain by constructed walls only', () => {
    const wall = (x: number, hits = 1) => ({ _id: 'w' + x, type: 'constructedWall', room: 'A', x, y: 1, hits });
    const a = roomTerrainKeys(f([wall(1)]), layout).get('A');
    expect(roomTerrainKeys(f([wall(1, 5), road('A', 3)]), layout).get('A')).toBe(a);
    expect(roomTerrainKeys(f([wall(2)]), layout).get('A')).not.toBe(a);
  });
  it('leaves constructed walls out of the structure key', () => {
    const wall = (x: number) => ({ _id: 'w' + x, type: 'constructedWall', room: 'A', x, y: 1, hits: 1 });
    const a = roomStructureKeys(f([road('A', 3), wall(1)]), layout).get('A');
    expect(roomStructureKeys(f([road('A', 3), wall(2)]), layout).get('A')).toBe(a);
    expect(roomStructureKeys(f([road('A', 3)]), layout).get('A')).toBe(a);
  });
  it('keys every room, with an empty room keyed as zero parts', () => {
    const keys = roomRampartKeys(f([{ _id: 'r', type: 'rampart', room: 'A', x: 1, y: 1 }]), layout);
    expect(keys.get('A')).toMatch(/^1:[0-9a-f]{8}$/);
    expect(keys.get('B')).toMatch(/^0:[0-9a-f]{8}$/);
  });
  it('caches only a few recent frames', () => {
    const frames = Array.from({ length: 6 }, () => f([road('A', 1)]));
    const first = objectsByRoom(frames[0], layout);
    for (const frame of frames.slice(1)) objectsByRoom(frame, layout);
    expect(objectsByRoom(frames[0], layout)).not.toBe(first);
  });
  it('looks objects up by id', () => {
    const frame = f([road('A', 1), { _id: 'c', type: 'creep', room: 'B', x: 0, y: 0 }]);
    expect(objectById(frame, 'c')!.type).toBe('creep');
    expect(objectById(frame, 'A1')!.type).toBe('road');
    expect(objectById(frame, 'missing')).toBeUndefined();
  });
});

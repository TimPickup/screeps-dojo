import { describe, expect, it } from 'vitest';
import type { Frame } from '../types';
import { FrameMarker, FrameResolver } from '../frameShare';

const frame = (objects: object[]) => ({ gameTime: 1, objects }) as unknown as Frame;
const clone = <T>(x: T): T => structuredClone(x);

describe('frame sharing', () => {
  it('round-trips frames and shares unchanged objects by reference', () => {
    const marker = new FrameMarker(), resolver = new FrameResolver();
    const f1 = frame([{ _id: 'a', x: 1 }, { _id: 'b', x: 1 }]);
    const f2 = frame([{ _id: 'b', x: 2 }, { _id: 'a', x: 1 }]);
    const f3 = frame([{ _id: 'a', x: 1 }]);
    const r1 = resolver.resolve(clone(marker.mark(clone(f1))));
    const sent2 = marker.mark(clone(f2));
    expect(sent2.objects[1]).toEqual({ $same: 'a' });
    const r2 = resolver.resolve(clone(sent2));
    const r3 = resolver.resolve(clone(marker.mark(clone(f3))));
    expect(r2).toEqual(f2); expect(r3).toEqual(f3);
    expect(r2.objects[1]).toBe(r1.objects[0]);
    expect(r3.objects[0]).toBe(r1.objects[0]);
  });
  it('sends an object in full again after it was absent for a frame', () => {
    const marker = new FrameMarker();
    marker.mark(frame([{ _id: 'a', x: 1 }]));
    marker.mark(frame([]));
    expect(marker.mark(frame([{ _id: 'a', x: 1 }])).objects[0]).toEqual({ _id: 'a', x: 1 });
  });
  it('never shares duplicate ids', () => {
    const marker = new FrameMarker();
    marker.mark(frame([{ _id: 'd', x: 1 }, { _id: 'd', x: 2 }]));
    expect(marker.mark(frame([{ _id: 'd', x: 1 }, { _id: 'd', x: 2 }])).objects).toEqual([{ _id: 'd', x: 1 }, { _id: 'd', x: 2 }]);
  });
  it('refuses a marker it cannot resolve', () => {
    expect(() => new FrameResolver().resolve(frame([{ $same: 'nope' }]))).toThrow();
  });
  it('never marks objects without an id', () => {
    const marker = new FrameMarker();
    marker.mark(frame([{ x: 1 }]));
    expect(marker.mark(frame([{ x: 1 }])).objects[0]).toEqual({ x: 1 });
  });
});

import type { Frame, FrameObject } from './types';

// Most objects in a replay are identical from one tick to the next. The worker
// replaces each such object with a marker, and the main thread swaps the marker
// for the previous frame's object, so unchanged objects are shared by reference
// instead of being stored once per frame.
//
// Only objects with an _id that is unique in both the previous and the current
// frame are shared. An object that is absent for a frame is sent in full when
// it returns. Array order is kept as recorded.

// An object identical to the previous frame's object with this _id.
export interface SameMarker { $same: string }

type Entry = FrameObject | SameMarker;

// The ids that occur exactly once in this list.
function uniqueIds(objects: readonly Entry[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const object of objects) {
    const id = idOf(object);
    if (id === undefined) continue;
    if (seen.has(id)) repeated.add(id);
    else seen.add(id);
  }
  for (const id of repeated) seen.delete(id);
  return seen;
}

function idOf(object: Entry): string | undefined {
  const id = (object as { _id?: unknown })._id;
  return typeof id === 'string' ? id : undefined;
}

// Worker side: one per stream, fed every frame in order.
export class FrameMarker {
  private previous = new Map<string, string>();

  mark(frame: Frame): Frame {
    const unique = uniqueIds(frame.objects);
    const next = new Map<string, string>();
    const objects: Entry[] = frame.objects.map((object) => {
      const id = idOf(object);
      if (id === undefined || !unique.has(id)) return object;
      const json = JSON.stringify(object);
      next.set(id, json);
      return this.previous.get(id) === json ? { $same: id } : object;
    });
    this.previous = next;
    return { ...frame, objects: objects as FrameObject[] };
  }
}

// Main-thread side: one per opened replay, fed every marked frame in order.
export class FrameResolver {
  private previous = new Map<string, FrameObject>();

  resolve(frame: Frame): Frame {
    const entries = frame.objects as Entry[];
    const objects = entries.map((object) => {
      if (!('$same' in object)) return object as FrameObject;
      const id = (object as SameMarker).$same;
      const shared = this.previous.get(id);
      if (!shared) throw new Error('Replay frame ' + frame.gameTime + ' refers to an unknown object ' + id + '.');
      return shared;
    });
    const unique = uniqueIds(objects);
    const next = new Map<string, FrameObject>();
    for (const object of objects) if (unique.has(object._id)) next.set(object._id, object);
    this.previous = next;
    return { ...frame, objects };
  }
}

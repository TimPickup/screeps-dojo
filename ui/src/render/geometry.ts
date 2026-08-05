// Shared pure layout/interpolation math used by browser playback and exports.
import type { Frame, FrameObject, StageLayout } from '../api/types.ts';

const ROOM_NAME_PATTERN = /^([WE])(\d+)([NS])(\d+)$/;
export function roomNameToXY(name: string): { x: number; y: number } {
  const m = ROOM_NAME_PATTERN.exec(name);
  if (!m) return { x: 0, y: 0 };
  const x = m[1] === 'W' ? -Number(m[2]) - 1 : Number(m[2]);
  const y = m[3] === 'N' ? -Number(m[4]) - 1 : Number(m[4]);
  return { x, y };
}

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

// Build a StageLayout from the recording's room list (client-side, for canvas mode).
export function computeStageLayout(rooms: string[], pixelsPerRoom = 600): StageLayout {
  const positions = rooms.map((name) => ({ name, ...roomNameToXY(name) }));
  const minX = positions.length ? Math.min(...positions.map((p) => p.x)) : 0;
  const minY = positions.length ? Math.min(...positions.map((p) => p.y)) : 0;
  const offsets: Record<string, { col: number; row: number }> = {};
  let columns = 1, rows = 1;
  for (const p of positions) {
    const col = p.x - minX, row = p.y - minY;
    offsets[p.name] = { col, row };
    columns = Math.max(columns, col + 1);
    rows = Math.max(rows, row + 1);
  }
  return { rooms, offsets, pixelsPerRoom, width: columns * pixelsPerRoom, height: rows * pixelsPerRoom };
}

// half-tick split: creep holds at base for the first half, glides over the second
export function tPos(s: number): number { return Math.max(0, 2 * s - 1); }
// actions/effects animate over the first half, gone by mid-tick
export function tFx(s: number): number { return s < 0.5 ? s / 0.5 : 0; }

// next position expressed in the BASE room's local space (cross-room seam glide)
export function nextLocal(base: FrameObject, next: FrameObject, layout: StageLayout): { x: number; y: number } {
  if (next.room === base.room) return { x: next.x, y: next.y };
  const o = layout.offsets;
  if (!o[next.room] || !o[base.room]) return { x: next.x, y: next.y };
  return {
    x: next.x + (o[next.room].col - o[base.room].col) * 50,
    y: next.y + (o[next.room].row - o[base.room].row) * 50
  };
}

// Facing angle in degrees.
const ACTION_KEYS = ['harvest', 'attack', 'upgradeController', 'heal', 'rangedAttack', 'rangedHeal', 'build'];
function facingDelta(a: FrameObject, b: { room: string; x: number; y: number }, layout: StageLayout): number | undefined {
  let dx: number, dy: number;
  if (a.room === b.room) { dx = b.x - a.x; dy = b.y - a.y; }
  else {
    const offsets = layout && layout.offsets;
    if (!offsets || !offsets[a.room] || !offsets[b.room]) return undefined;
    dx = (b.x + offsets[b.room].col * 50) - (a.x + offsets[a.room].col * 50);
    dy = (b.y + offsets[b.room].row * 50) - (a.y + offsets[a.room].row * 50);
  }
  return dx !== 0 || dy !== 0 ? Math.atan2(dy, dx) * 180 / Math.PI : undefined;
}

class FacingCache {
  private frames: Frame[];
  private layout: StageLayout;
  private indexed: Array<Record<string, FrameObject>> = [];
  private values: Array<Record<string, number | undefined>> = [];
  private lastMovement: Record<string, number | undefined> = {};

  constructor(frames: Frame[], layout: StageLayout) {
    this.frames = frames;
    this.layout = layout;
    this.sync();
  }

  private indexFrame(frame: Frame): Record<string, FrameObject> {
    const indexed: Record<string, FrameObject> = {};
    for (const object of frame.objects) if (object.type === 'creep') indexed[object._id] = object;
    return indexed;
  }

  private resolve(curr: FrameObject, next: FrameObject | undefined): number | undefined {
    let action: number | undefined;
    let movement: number | undefined;
    if (next) {
      if (next.actionLog) {
        for (const key of ACTION_KEYS) {
          const target = (next.actionLog as Record<string, { x: number; y: number }>)[key];
          if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') continue;
          action = facingDelta(curr, { room: next.room, x: target.x, y: target.y }, this.layout);
          if (action !== undefined) break;
        }
      }
      movement = facingDelta(curr, next, this.layout);
      if (movement !== undefined) this.lastMovement[curr._id] = movement;
    }
    return action ?? movement ?? this.lastMovement[curr._id];
  }

  sync(): void {
    while (this.indexed.length < this.frames.length) {
      const nextIndex = this.indexed.length;
      const nextObjects = this.indexFrame(this.frames[nextIndex]);
      this.indexed.push(nextObjects);
      if (nextIndex === 0) {
        const first: Record<string, number | undefined> = {};
        for (const id of Object.keys(nextObjects)) first[id] = this.lastMovement[id];
        this.values.push(first);
        continue;
      }

      const previousObjects = this.indexed[nextIndex - 1];
      const previous: Record<string, number | undefined> = {};
      for (const id of Object.keys(previousObjects)) previous[id] = this.resolve(previousObjects[id], nextObjects[id]);
      this.values[nextIndex - 1] = previous;

      const final: Record<string, number | undefined> = {};
      for (const id of Object.keys(nextObjects)) final[id] = this.lastMovement[id];
      this.values.push(final);
    }
  }

  get(frameIndex: number, objectId: string, fallbackAngle: number): number {
    this.sync();
    return this.values[frameIndex]?.[objectId] ?? fallbackAngle;
  }
}

const facingCaches = new WeakMap<Frame[], WeakMap<StageLayout, FacingCache>>();

export function creepFacing(frames: Frame[], frameIndex: number, objectId: string, layout: StageLayout, fallbackAngle = 0): number {
  let layouts = facingCaches.get(frames);
  if (!layouts) { layouts = new WeakMap(); facingCaches.set(frames, layouts); }
  let cache = layouts.get(layout);
  if (!cache) { cache = new FacingCache(frames, layout); layouts.set(layout, cache); }
  return cache.get(frameIndex, objectId, fallbackAngle);
}

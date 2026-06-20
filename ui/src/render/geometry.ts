// Ported from src/render/frameRenderer.js (pure math) so the canvas renderer's
// positions/facing are IDENTICAL to the SVG/MP4 renderer. Keep in sync.
import type { Frame, FrameObject, StageLayout } from '../api/types';

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

// Facing angle (degrees) — ported verbatim from frameRenderer.creepFacing.
const ACTION_KEYS = ['harvest', 'attack', 'upgradeController', 'heal', 'rangedAttack', 'rangedHeal', 'build'];
export function creepFacing(frames: Frame[], frameIndex: number, objectId: string, layout: StageLayout, fallbackAngle = 0): number {
  const offsets = layout ? layout.offsets : null;
  const posAt = (fi: number): FrameObject | null => {
    const frame = frames[fi];
    if (!frame) return null;
    for (let i = 0; i < frame.objects.length; i++) if (frame.objects[i]._id === objectId) return frame.objects[i];
    return null;
  };
  const worldDelta = (a: FrameObject, b: { room: string; x: number; y: number }): { dx: number; dy: number } | null => {
    let dx: number, dy: number;
    if (a.room === b.room) { dx = b.x - a.x; dy = b.y - a.y; }
    else {
      if (!offsets || !offsets[a.room] || !offsets[b.room]) return null;
      dx = (b.x + offsets[b.room].col * 50) - (a.x + offsets[a.room].col * 50);
      dy = (b.y + offsets[b.room].row * 50) - (a.y + offsets[a.room].row * 50);
    }
    return dx !== 0 || dy !== 0 ? { dx, dy } : null;
  };
  const curr = posAt(frameIndex);
  const next = posAt(frameIndex + 1);
  if (curr && next && next.actionLog) {
    for (const key of ACTION_KEYS) {
      const target = (next.actionLog as Record<string, { x: number; y: number }>)[key];
      if (target && typeof target.x === 'number' && typeof target.y === 'number') {
        const delta = worldDelta(curr, { room: next.room, x: target.x, y: target.y });
        if (delta) return Math.atan2(delta.dy, delta.dx) * 180 / Math.PI;
      }
    }
  }
  if (curr && next) {
    const delta = worldDelta(curr, next);
    if (delta) return Math.atan2(delta.dy, delta.dx) * 180 / Math.PI;
  }
  for (let k = frameIndex; k >= 1; k--) {
    const a = posAt(k - 1); const b = posAt(k);
    if (a && b) { const delta = worldDelta(a, b); if (delta) return Math.atan2(delta.dy, delta.dx) * 180 / Math.PI; }
  }
  return fallbackAngle;
}

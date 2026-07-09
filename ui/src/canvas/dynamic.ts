import type { FrameObject } from '../api/types';
import { circle, poly, rect } from './primitives';

type Ctx = CanvasRenderingContext2D;
const ENERGY = '#FFE87B';

// Screeps controller progress totals (from @screeps/common constants).
export const CONTROLLER_LEVELS: Record<number, number> = {
  1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000, 8: 0,
};

export function energyFillFraction(o: FrameObject): number {
  const cap = (o.storeCapacityResource as Record<string, number> | undefined)?.energy;
  if (!cap || cap <= 0) return 0;
  const energy = (o.store as Record<string, number> | undefined)?.energy || 0;
  return Math.max(0, Math.min(1, energy / cap));
}

export function storeFillFraction(o: FrameObject): number {
  const cap = (o.storeCapacity as number | undefined) || 0;
  if (cap <= 0) return 0;
  const store = (o.store as Record<string, number> | undefined) || {};
  let used = 0; for (const k of Object.keys(store)) used += store[k];
  return Math.max(0, Math.min(1, used / cap));
}

export function drawExtensionFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
  const f = energyFillFraction(o);
  if (f > 0) circle(ctx, cx, cy, { radius: 0.35 * f, fill: ENERGY });
}

export function drawLinkFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
  const f = Math.max(0, Math.min(1, ((o.store as Record<string, number> | undefined)?.energy || 0) / 800));
  if (f <= 0) return;
  const inner = [[0, -0.3], [0.25, 0], [0, 0.3], [-0.25, 0]].map((p) => [p[0] * f + cx, p[1] * f + cy]);
  poly(ctx, inner, { fill: ENERGY });
}

export function drawStorageFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
  const f = storeFillFraction(o);
  if (f <= 0) return;
  rect(ctx, cx - 0.35, cy + 0.45 - 0.9 * f, 0.7, 0.9 * f, { fill: ENERGY });
}

export function drawContainerFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
  const f = storeFillFraction(o);
  if (f <= 0) return;
  rect(ctx, cx - 0.17, cy + 0.27 - 0.2 * f, 0.34, 0.2 * f, { fill: ENERGY });
}

export function drawSourceCore(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
  const cap = (o.energyCapacity as number | undefined) || 0;
  const f = cap > 0 ? Math.max(0, Math.min(1, ((o.energy as number | undefined) || 0) / cap)) : 0;
  if (f > 0) circle(ctx, cx, cy, { radius: 0.32 * f, fill: ENERGY, opacity: 0.95 });
}

export function drawControllerProgress(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
  const total = CONTROLLER_LEVELS[(o.level as number) || 0];
  const f = total ? Math.min(1, ((o.progress as number | undefined) || 0) / total) : 0;
  if (f <= 0) return;
  circle(ctx, cx, cy, { radius: 0.45 * f, fill: '#ffe25a', opacity: 0.85 });
  ctx.save();
  ctx.strokeStyle = '#ffe25a'; ctx.lineWidth = 0.08; ctx.beginPath();
  ctx.arc(cx, cy, 0.6, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
  ctx.stroke(); ctx.restore();
}

export function drawSpawnProgress(ctx: Ctx, o: FrameObject, cx: number, cy: number, gameTime: number, sub: number) {
  const sp = o.spawning as { needTime?: number; spawnTime?: number } | undefined;
  if (!sp || !sp.needTime || sp.needTime <= 0) return;
  const start = (sp.spawnTime || 0) - sp.needTime;
  const f = Math.max(0, Math.min(1, (gameTime + sub - start) / sp.needTime));
  if (f <= 0) return;
  ctx.save();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.12; ctx.globalAlpha = 0.85; ctx.beginPath();
  ctx.arc(cx, cy, 0.52, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
  ctx.stroke(); ctx.restore();
}

// Tombstone: rounded headstone + dark cross. Ported from frameRenderer.tombstoneSvg.
export function drawTombstone(ctx: Ctx, cx: number, cy: number) {
  ctx.save();
  ctx.fillStyle = '#9a9a9a'; ctx.strokeStyle = '#555555'; ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.moveTo(cx - 0.25, cy + 0.25);
  ctx.lineTo(cx - 0.25, cy - 0.1);
  ctx.arc(cx, cy - 0.1, 0.25, Math.PI, 0); // top semicircle
  ctx.lineTo(cx + 0.25, cy + 0.25);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#444444'; ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 0.22); ctx.lineTo(cx, cy + 0.1);
  ctx.moveTo(cx - 0.1, cy - 0.12); ctx.lineTo(cx + 0.1, cy - 0.12);
  ctx.stroke();
  ctx.restore();
}

// Dropped resource dot. Ported from frameRenderer.droppedResourceSvg.
export function drawDroppedResource(ctx: Ctx, cx: number, cy: number, amount: number, resourceType: string) {
  const radius = 0.15 + 0.15 * Math.min(1, amount / 1000);
  circle(ctx, cx, cy, { radius, fill: resourceType === 'energy' ? ENERGY : '#ffffff', opacity: 0.85 });
}

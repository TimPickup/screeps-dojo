import type { Recording, FrameObject, StageLayout } from '../api/types';
import { lerp, tPos, tFx, nextLocal, creepFacing } from '../render/geometry';
import { SpriteCache, BackgroundCache, epochKey } from './caches';

const S = 1.25; // CREEP_SIZE_TILES

interface DrawOpts {
  sprites: SpriteCache;
  backgrounds: BackgroundCache;
  layout: StageLayout;
  showVisuals: boolean;
}

// Draws one frame (tick) at sub-frame `sub` (null = paused/scrub → static look,
// matching the SVG renderer's staticActions; a number ∈ [0,1) = animating).
// Works in TILE coordinates — the caller has applied the world→screen transform.
export function drawFrame(ctx: CanvasRenderingContext2D, recording: Recording, tick: number, sub: number | null, opts: DrawOpts) {
  const { sprites, backgrounds, layout } = opts;
  const frames = recording.frames;
  const count = frames.length;
  const i = Math.max(0, Math.min(count - 1, tick));
  const base = frames[i];
  const next = sub !== null && i + 1 < count ? frames[i + 1] : null;
  const off = layout.offsets;
  const colsTiles = (layout.width / layout.pixelsPerRoom) * 50;
  const rowsTiles = (layout.height / layout.pixelsPerRoom) * 50;

  // 1) static background (per epoch)
  const bg = backgrounds.get(i, epochKey(base));
  if (bg) ctx.drawImage(bg, 0, 0, colsTiles, rowsTiles);

  // world tile coords for a room-local position
  const wpos = (room: string, x: number, y: number) => {
    const o = off[room];
    return o ? { wx: o.col * 50 + x, wy: o.row * 50 + y } : null;
  };

  const nextById = next ? indexById(next.objects) : null;
  const baseById = indexById(base.objects);

  // 2) creeps (interpolated) + HP + effects
  for (const obj of base.objects) {
    if (obj.type !== 'creep' || obj.spawning) continue;
    let x = obj.x, y = obj.y, room = obj.room, opacity = 1;
    let actionSrc: FrameObject = obj;
    if (next) {
      const n = nextById![obj._id];
      if (n && (n.room === obj.room || off[n.room])) {
        const nl = nextLocal(obj, n, layout);
        const tp = tPos(sub as number);
        x = lerp(obj.x, nl.x, tp); y = lerp(obj.y, nl.y, tp);
        actionSrc = n;
        // work/attack bob during the action half
        const bobT = (n.actionLog && ((n.actionLog as any).harvest || (n.actionLog as any).attack));
        if (bobT) {
          const dx = bobT.x - x, dy = bobT.y - y, d = Math.hypot(dx, dy);
          if (d > 0) { const amp = 0.15 * Math.sin(Math.PI * tFx(sub as number)); x += amp * dx / d; y += amp * dy / d; }
        }
      } else { opacity = 1 - (sub as number); } // died/left layout: fade
    }
    const p = wpos(room, x, y);
    if (!p) continue;
    const facing = creepFacing(frames, i, obj._id, layout);
    const sprite = sprites.isNpc(obj) ? sprites.invaderSprite() : sprites.creepSprite(obj);
    drawSprite(ctx, sprite, p.wx, p.wy, facing, opacity, sprites.isNpc(obj));
    drawHpBar(ctx, obj, p.wx, p.wy, opacity);
    if (obj.actionLog && (obj.actionLog as any).say && (obj.actionLog as any).say.message) {
      drawSay(ctx, (obj.actionLog as any).say.message, p.wx, p.wy);
    }
    drawEffects(ctx, actionSrc, p.wx, p.wy, sub, off, room);
  }
  // creeps that appear only next frame (spawned): fade in
  if (next) {
    for (const n of next.objects) {
      if (n.type !== 'creep' || n.spawning || baseById[n._id]) continue;
      const p = wpos(n.room, n.x, n.y);
      if (!p) continue;
      const sprite = sprites.isNpc(n) ? sprites.invaderSprite() : sprites.creepSprite(n);
      drawSprite(ctx, sprite, p.wx, p.wy, creepFacing(frames, i + 1, n._id, layout), sub as number, sprites.isNpc(n));
    }
  }

  // 2b) towers: live energy fill + attack/heal/repair beams. Towers are baked
  //     into the per-epoch background (epochKey excludes energy), so their
  //     current fill and per-tick actions must be drawn here on top. Beams reuse
  //     the creep effect renderer — tower actionLog keys (attack/heal/repair)
  //     are a subset of the creep ones, so they read identically.
  for (const obj of base.objects) {
    if (obj.type !== 'tower') continue;
    const p = wpos(obj.room, obj.x, obj.y);
    if (!p) continue;
    drawTowerFill(ctx, obj, p.wx, p.wy);
    // actionLog lives on the structure doc; prefer the next frame's (the
    // transition being animated), matching the link-beam approach.
    const nextDoc = nextById ? nextById[obj._id] : null;
    drawEffects(ctx, (nextDoc || obj) as FrameObject, p.wx, p.wy, sub, off, obj.room);
  }

  // 3) bot's own RoomVisual draws, on top (drawn from the recording's raw
  //    command strings — no server round-trip; instant toggle)
  if (opts.showVisuals && base.visuals) {
    for (const room of Object.keys(base.visuals)) {
      const o = off[room];
      if (!o) continue;
      // +0.5: RoomVisual coords are tile-centred (svgPrimitives.elementToSvg adds
      // +0.5 to every coordinate); match that so canvas visuals align with SVG.
      drawUserVisuals(ctx, base.visuals[room] as string, o.col * 50 + 0.5, o.row * 50 + 0.5);
    }
  }
}

// Replays the bot's RoomVisual command strings ({t:'c'|'l'|'r'|'p'|'t'}) onto
// the canvas. Geometry is exact; styling maps the common RoomVisual options.
function drawUserVisuals(ctx: CanvasRenderingContext2D, raw: string, ox: number, oy: number) {
  for (const lineStr of raw.split('\n')) {
    if (!lineStr.trim()) continue;
    let v: any; try { v = JSON.parse(lineStr); } catch { continue; }
    const s = v.s || {};
    ctx.save();
    ctx.globalAlpha = s.opacity !== undefined ? s.opacity : (v.t === 't' ? 1 : 0.5);
    const stroke = s.stroke || s.color;
    const sw = s.strokeWidth !== undefined ? s.strokeWidth : (s.width !== undefined ? s.width : 0.1);
    if (s.lineStyle === 'dashed') ctx.setLineDash([0.3, 0.2]);
    else if (s.lineStyle === 'dotted') ctx.setLineDash([0.1, 0.1]);
    if (v.t === 'c') {
      ctx.beginPath(); ctx.arc(ox + v.x, oy + v.y, s.radius !== undefined ? s.radius : 0.15, 0, Math.PI * 2);
      if (s.fill !== undefined && s.fill !== 'transparent') { ctx.fillStyle = s.fill; ctx.fill(); }
      else if (s.fill === undefined && stroke === undefined) { ctx.fillStyle = '#ffffff'; ctx.fill(); }
      if (stroke) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.stroke(); }
    } else if (v.t === 'l') {
      ctx.beginPath(); ctx.moveTo(ox + v.x1, oy + v.y1); ctx.lineTo(ox + v.x2, oy + v.y2);
      ctx.lineWidth = sw; ctx.strokeStyle = stroke || '#ffffff'; ctx.stroke();
    } else if (v.t === 'r') {
      if (s.fill !== undefined && s.fill !== 'transparent') { ctx.fillStyle = s.fill; ctx.fillRect(ox + v.x, oy + v.y, v.w, v.h); }
      if (stroke) { ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.strokeRect(ox + v.x, oy + v.y, v.w, v.h); }
    } else if (v.t === 'p') {
      ctx.beginPath();
      const pts = v.points || [];
      for (let k = 0; k < pts.length; k++) {
        const px = ox + pts[k][0], py = oy + pts[k][1];
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      if (s.fill !== undefined && s.fill !== 'transparent') { ctx.fillStyle = s.fill; ctx.fill(); }
      if (stroke !== undefined || s.fill === undefined) { ctx.lineWidth = sw; ctx.strokeStyle = stroke || '#ffffff'; ctx.stroke(); }
    } else if (v.t === 't') {
      const size = s.font !== undefined ? (typeof s.font === 'number' ? s.font : 0.5) : 0.5;
      ctx.font = size + 'px monospace'; ctx.textAlign = (s.align || 'center');
      ctx.fillStyle = s.color || '#ffffff'; ctx.fillText(String(v.text), ox + v.x, oy + v.y);
    }
    ctx.restore();
  }
}

function indexById(objects: FrameObject[]): Record<string, FrameObject> {
  const m: Record<string, FrameObject> = {};
  for (const o of objects) m[o._id] = o;
  return m;
}

function drawSprite(ctx: CanvasRenderingContext2D, sprite: HTMLImageElement | null, wx: number, wy: number, facing: number, opacity: number, isNpc: boolean) {
  if (!sprite) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.translate(wx + 0.5, wy + 0.5);
  if (isNpc) {
    ctx.rotate(facing * Math.PI / 180);
    const sz = 0.95;
    ctx.drawImage(sprite, -sz / 2, -sz / 2, sz, sz);
  } else {
    ctx.rotate((facing + 90) * Math.PI / 180); // sprite faces up; +90 → heading where 0=east
    ctx.drawImage(sprite, -S / 2, -S / 2, S, S);
  }
  ctx.restore();
}

function drawHpBar(ctx: CanvasRenderingContext2D, o: FrameObject, wx: number, wy: number, opacity: number) {
  if (o.hits === undefined || !o.hitsMax || o.hits >= o.hitsMax) return;
  const frac = Math.max(0, o.hits / o.hitsMax);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = '#555555'; ctx.fillRect(wx - 0.5, wy - 0.85, 1.0, 0.15);
  ctx.fillStyle = '#65fd62'; ctx.fillRect(wx - 0.5, wy - 0.85, frac, 0.15);
  ctx.restore();
}

// Yellow energy gauge over a tower's central grey body rect. The body is drawn
// by lib/RoomVisual's tower structure as rect(cx-0.4, cy-0.3, 0.8, 0.6); we fill
// it bottom-up proportional to store.energy / capacity so fullness reads at a
// glance (the static background draws the grey rect underneath).
function drawTowerFill(ctx: CanvasRenderingContext2D, o: FrameObject, wx: number, wy: number) {
  const cap = (o.storeCapacityResource as Record<string, number> | undefined)?.energy;
  if (!cap || cap <= 0) return;
  const energy = (o.store && (o.store as Record<string, number>).energy) || 0;
  const frac = Math.max(0, Math.min(1, energy / cap));
  if (frac <= 0) return;
  const cx = wx + 0.5, cy = wy + 0.5;
  const h = 0.6 * frac;
  ctx.save();
  ctx.fillStyle = '#FFE87B';
  ctx.fillRect(cx - 0.4, cy + 0.3 - h, 0.8, h);
  ctx.restore();
}

function drawSay(ctx: CanvasRenderingContext2D, message: string, wx: number, wy: number) {
  const text = String(message).slice(0, 10);
  ctx.save();
  ctx.font = '0.5px monospace'; ctx.textAlign = 'center';
  const w = Math.max(0.8, text.length * 0.32);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(ctx, wx + 0.5 - w / 2, wy - 1.5, w, 0.6, 0.1); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillText(text, wx + 0.5, wy - 1.05);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Effects — colours mirror frameRenderer.drawEffects. sub=null → static solid
// (matches the SVG static look); number → animated over the action half (tFx).
function drawEffects(ctx: CanvasRenderingContext2D, creep: FrameObject, wx: number, wy: number, sub: number | null, off: StageLayout['offsets'], room: string) {
  const a = creep.actionLog as Record<string, { x: number; y: number } | undefined> | undefined;
  if (!a) return;
  const o = off[room];
  if (!o) return;
  const cx = wx + 0.5, cy = wy + 0.5;
  const fx = sub === null ? 1 : tFx(sub);
  const target = (t: { x: number; y: number }) => ({ tx: o.col * 50 + t.x + 0.5, ty: o.row * 50 + t.y + 0.5 });
  const beam = (t: { x: number; y: number }, color: string, width: number) => {
    const { tx, ty } = target(t);
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = 0.85; ctx.lineCap = 'round';
    if (sub === null) { line(ctx, cx, cy, tx, ty); }
    else { const head = fx, tail = Math.max(0, head - 0.18); line(ctx, lerp(cx, tx, tail), lerp(cy, ty, tail), lerp(cx, tx, head), lerp(cy, ty, head)); }
    ctx.restore();
  };
  if (a.attack) { beam(a.attack, '#ff4040', 0.15); ring(ctx, target(a.attack), 0.5, '#ff4040'); }
  if (a.rangedAttack) beam(a.rangedAttack, '#ff4040', 0.1);
  if (a.harvest) beam(a.harvest, '#ffe87b', 0.1);
  if (a.build) beam(a.build, '#ffffff', 0.1);
  if (a.repair) beam(a.repair, '#9aa0aa', 0.08);
  if (a.upgradeController) beam(a.upgradeController, '#ffe25a', 0.12);
  if (a.heal) {
    if (a.heal.x === creep.x && a.heal.y === creep.y) ring(ctx, { tx: cx, ty: cy }, sub === null ? 0.6 : 0.55 + 0.1 * Math.sin(Math.PI * fx), '#5cff6a');
    else beam(a.heal, '#65fd62', 0.1);
  }
  if (a.rangedHeal) beam(a.rangedHeal, '#65fd62', 0.08);
  if (a.rangedMassAttack) {
    const r = sub === null ? 3 : Math.max(0.2, 3 * fx);
    ctx.save(); ctx.strokeStyle = '#5d80b2'; ctx.lineWidth = 0.1; ctx.globalAlpha = sub === null ? 0.5 : 0.8 * (1 - fx);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
function ring(ctx: CanvasRenderingContext2D, c: { tx: number; ty: number }, r: number, color: string) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 0.08; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.arc(c.tx, c.ty, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}

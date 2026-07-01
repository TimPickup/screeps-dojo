import { useEffect, useRef, useState } from 'react';
import type { Recording, StageLayout, FrameObject } from '../../api/types';
import { api } from '../../api/client';
import { SpriteCache, BackgroundCache, epochKey } from '../../canvas/caches';
import { drawFrame } from '../../canvas/drawFrame';
import styles from './CanvasStage.module.css';

// Friendly names for the multi-object picker (when several objects share one tile).
const TYPE_LABELS: Record<string, string> = {
  creep: 'Creep', powerCreep: 'Power Creep', spawn: 'Spawn', extension: 'Extension', tower: 'Tower',
  rampart: 'Rampart', constructedWall: 'Wall', wall: 'Wall', storage: 'Storage', terminal: 'Terminal',
  link: 'Link', lab: 'Lab', factory: 'Factory', extractor: 'Extractor', observer: 'Observer',
  nuker: 'Nuker', powerSpawn: 'Power Spawn', container: 'Container', road: 'Road', source: 'Source',
  mineral: 'Mineral', deposit: 'Deposit', controller: 'Controller', keeperLair: 'Keeper Lair',
  portal: 'Portal', powerBank: 'Power Bank', invaderCore: 'Invader Core', tombstone: 'Tombstone',
  ruin: 'Ruin', energy: 'Resource', resource: 'Resource',
};

function objectLabel(o: FrameObject): string {
  const base = TYPE_LABELS[o.type] || (o.type ? o.type[0].toUpperCase() + o.type.slice(1) : 'Object');
  if (o.type === 'creep' && o.name) return base + ' · ' + o.name;
  if (o.type === 'energy' || o.type === 'resource') {
    const amt = o.store ? Object.values(o.store).reduce((a, b) => a + b, 0) : undefined;
    return amt !== undefined ? base + ' · ' + amt : base;
  }
  return base;
}

interface Props {
  recording: Recording;
  layout: StageLayout;
  relPath: string;
  playing: boolean;
  speed: number;
  tick: number;                 // controlled (scrub); advanced via onTick during play
  onTick: (t: number) => void;
  onEnded: () => void;
  showVisuals: boolean;
  selectedId: string | null;
  onSelectObject: (id: string | null) => void;
}

// Canvas replay renderer (option 2): rasterized SVG background per structure
// epoch + reused creep sprites + client-side interpolation/effects/visuals.
// Smooth (rAF), instant first paint (one scene SVG), no render-all.
export function CanvasStage({ recording, layout, relPath, playing, speed, tick, onTick, onEnded, showVisuals, selectedId, onSelectObject }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useRef({ scale: 1, tx: 0, ty: 0 });
  const fittedRef = useRef<StageLayout | null>(null);
  const caches = useRef<{ sprites: SpriteCache; backgrounds: BackgroundCache } | null>(null);
  const playhead = useRef(0);
  const lastTs = useRef(0);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const stateRef = useRef({ playing, speed, tick, showVisuals, selectedId });
  const [ready, setReady] = useState(false);
  // Multi-object picker: when a click lands on a tile holding >1 object, offer a menu.
  const [menu, setMenu] = useState<{ x: number; y: number; items: FrameObject[] } | null>(null);
  stateRef.current = { playing, speed, tick, showVisuals, selectedId };

  const colsTiles = (layout.width / layout.pixelsPerRoom) * 50;
  const rowsTiles = (layout.height / layout.pixelsPerRoom) * 50;

  // set up caches + prewarm sprites + first-epoch background
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const sprites = new SpriteCache(recording.meta.botUserId);
    const backgrounds = new BackgroundCache((frameIndex) => api.scene(relPath, frameIndex), layout);
    caches.current = { sprites, backgrounds };
    playhead.current = stateRef.current.tick;
    (async () => {
      await sprites.prewarm(recording);
      await backgrounds.ensure(0, epochKey(recording.frames[0]));
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [recording, layout, relPath]);

  // keep playhead synced to a scrubbed tick when paused
  useEffect(() => { if (!playing) playhead.current = tick; }, [tick, playing]);

  const fit = () => {
    const el = containerRef.current; if (!el) return;
    const cw = el.clientWidth || 1, ch = el.clientHeight || 1;
    const scale = Math.min(cw / colsTiles, ch / rowsTiles) * 0.96;
    view.current = { scale, tx: (cw - colsTiles * scale) / 2, ty: (ch - rowsTiles * scale) / 2 };
  };
  useEffect(() => { if (fittedRef.current !== layout) { fittedRef.current = layout; fit(); } });

  // resize canvas to container × dpr
  useEffect(() => {
    const el = containerRef.current, cv = canvasRef.current; if (!el || !cv) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.floor(el.clientWidth * dpr));
      cv.height = Math.max(1, Math.floor(el.clientHeight * dpr));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // render loop
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current, c = caches.current; if (!cv || !c) return;
      const ctx = cv.getContext('2d'); if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const st = stateRef.current;
      const count = recording.frames.length;

      // advance playhead during playback (1 tick = 1s at 1x)
      const dt = lastTs.current ? (ts - lastTs.current) / 1000 : 0;
      lastTs.current = ts;
      let sub: number | null = null;
      if (st.playing && ready) {
        playhead.current += dt * st.speed;
        if (playhead.current >= count - 1) { playhead.current = count - 1; onEnded(); }
        const t = Math.floor(playhead.current);
        sub = playhead.current - t;
        if (t !== st.tick) onTick(t);
      }
      const drawTick = st.playing ? Math.floor(playhead.current) : st.tick;

      // clear + world transform (tile → device px)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0e0e0e';
      ctx.fillRect(0, 0, cv.width, cv.height);
      const s = view.current.scale * dpr;
      ctx.setTransform(s, 0, 0, s, view.current.tx * dpr, view.current.ty * dpr);
      if (c) drawFrame(ctx, recording, drawTick, st.playing ? sub : null, { sprites: c.sprites, backgrounds: c.backgrounds, layout, showVisuals: st.showVisuals });

      // selection ring
      if (st.selectedId) {
        const f = recording.frames[Math.min(drawTick, count - 1)];
        const o = f && f.objects.find((x) => x._id === st.selectedId);
        if (o && layout.offsets[o.room]) {
          const wx = layout.offsets[o.room].col * 50 + o.x + 0.5, wy = layout.offsets[o.room].row * 50 + o.y + 0.5;
          ctx.strokeStyle = '#65fd62'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.arc(wx, wy, 0.6, 0, Math.PI * 2); ctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [recording, layout, ready]);

  // pan / zoom / select (screen → tile)
  const toTile = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.current.tx) / view.current.scale, y: (clientY - rect.top - view.current.ty) / view.current.scale };
  };
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const v = view.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const scale = Math.max(0.05, Math.min(40, v.scale * factor));
      view.current = { scale, tx: mx - (mx - v.tx) * (scale / v.scale), ty: my - (my - v.ty) * (scale / v.scale) };
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => { const d = drag.current; if (!d) return; view.current.tx = d.tx + (e.clientX - d.x); view.current.ty = d.ty + (e.clientY - d.y); };
    const onUp = () => { drag.current = null; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => { drag.current = { x: e.clientX, y: e.clientY, tx: view.current.tx, ty: view.current.ty }; document.body.style.userSelect = 'none'; };
  const moved = useRef(false);
  const onClick = (e: React.MouseEvent) => {
    const t = toTile(e.clientX, e.clientY);
    const f = recording.frames[Math.min(stateRef.current.tick, recording.frames.length - 1)];
    // Gather every object on the clicked tile (a tile can hold a creep + rampart + structure + resource).
    const cx = Math.floor(t.x), cy = Math.floor(t.y);
    const hits: FrameObject[] = [];
    for (const o of (f ? f.objects : [])) {
      const off = layout.offsets[o.room]; if (!off) continue;
      if (off.col * 50 + o.x === cx && off.row * 50 + o.y === cy) hits.push(o);
    }
    if (hits.length === 0) { onSelectObject(null); setMenu(null); return; }
    if (hits.length === 1) { onSelectObject(hits[0]._id); setMenu(null); return; }
    // >1: order them sensibly (creeps/resources first, big static structures last) and show a picker.
    const rank = (o: FrameObject) => (o.type === 'creep' ? 0 : o.type === 'energy' || o.type === 'resource' ? 1 : o.type === 'rampart' ? 9 : 5);
    hits.sort((a, b) => rank(a) - rank(b));
    const rect = containerRef.current!.getBoundingClientRect();
    setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, items: hits });
  };

  return (
    <div ref={containerRef} className={styles.stage}
      onMouseDown={(e) => { moved.current = false; setMenu(null); onMouseDown(e); }}
      onMouseMove={() => { if (drag.current) moved.current = true; }}
      onClick={(e) => { if (!moved.current) onClick(e); }}
      onDoubleClick={fit}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {!ready && <div className={styles.loading}>preparing canvas…</div>}
      <div className={styles.hint}>scroll = zoom · drag = pan · dbl-click = reset</div>
      {menu && (
        <div className={styles.picker} style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <div className={styles.pickerHead}>{menu.items.length} objects here</div>
          {menu.items.map((o) => (
            <button key={o._id} type="button"
              className={o._id === selectedId ? `${styles.pickerItem} ${styles.pickerItemSel}` : styles.pickerItem}
              onClick={() => { onSelectObject(o._id); setMenu(null); }}>
              {objectLabel(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

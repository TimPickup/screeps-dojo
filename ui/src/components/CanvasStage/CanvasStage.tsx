import { useEffect, useRef, useState } from 'react';
import type { Recording, StageLayout, FrameObject } from '../../api/types';
import { api } from '../../api/client';
import { SpriteCache, BackgroundCache, epochKey } from '../../canvas/caches';
import { drawFrame } from '../../canvas/drawFrame';
import styles from './CanvasStage.module.css';

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
    let best: FrameObject | null = null, bestD = 0.8;
    for (const o of (f ? f.objects : [])) {
      const off = layout.offsets[o.room]; if (!off) continue;
      const d = Math.hypot((off.col * 50 + o.x + 0.5) - t.x, (off.row * 50 + o.y + 0.5) - t.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    onSelectObject(best ? best._id : null);
  };

  return (
    <div ref={containerRef} className={styles.stage}
      onMouseDown={(e) => { moved.current = false; onMouseDown(e); }}
      onMouseMove={() => { if (drag.current) moved.current = true; }}
      onClick={(e) => { if (!moved.current) onClick(e); }}
      onDoubleClick={fit}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {!ready && <div className={styles.loading}>preparing canvas…</div>}
      <div className={styles.hint}>scroll = zoom · drag = pan · dbl-click = reset</div>
    </div>
  );
}

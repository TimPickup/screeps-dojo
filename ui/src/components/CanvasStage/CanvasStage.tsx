import { useEffect, useRef, useState } from 'react';
import type { Recording, StageLayout, FrameObject } from '../../api/types';
import { StaticLayers } from '../../canvas/caches';
import { CreepRenderer } from '../../canvas/creeps';
import { drawFrame } from '../../canvas/drawFrame';
import { droppedPile } from '../../canvas/dynamic';
import { useRenderFonts } from '../../hooks/useRenderFonts';
import { useTerrainTextures } from '../../hooks/useTerrainTextures';
import { useModImages } from '../../hooks/useModImages';
import { usePowerImages } from '../../hooks/usePowerImages';
import { STATIC_LAYER_RESOLUTION, TILE_BUILD_BUDGET_MS, TILE_BUILD_BUDGET_PIXELS } from '../../canvas/renderConstants';
import { detailLevel, viewFromTransform, visibleRooms, type DetailLevel, type RenderView } from '../../canvas/renderView';
import { needsRedraw, shouldAnimate, type DrawState } from '../../canvas/renderScheduler';
import { objectById } from '../../canvas/roomIndex';
import { createTileCanvas, finishTile } from '../../canvas/browserTileFinish';
import { SMOOTH_TURN_MAX_SPEED } from '../../render/geometry';
import styles from './CanvasStage.module.css';

// ?renderStats=1 shows the render-loop overlay. Read once, at load.
const SHOW_RENDER_STATS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('renderStats') === '1';
const STATS_INTERVAL_MS = 500;
const DRAW_MS_EMA_WEIGHT = 0.1;

// What the loop leaves for the stats overlay; read by a timer, never rendered by React.
interface RenderStats { drawMsEma: number; draws: number; detail: DetailLevel; view: RenderView | null }

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
  if ((o.type === 'creep' || o.type === 'powerCreep') && o.name) return base + ' · ' + o.name;
  if (o.type === 'energy' || o.type === 'resource') {
    const pile = droppedPile(o);
    return base + ' · ' + pile.amount + (pile.resourceType === 'energy' ? '' : ' ' + pile.resourceType);
  }
  return base;
}

interface Props {
  recording: Recording;
  layout: StageLayout;
  relPath: string;
  playing: boolean;
  loading?: boolean;
  speed: number;
  tick: number;                 // controlled (scrub); advanced via onTick during play
  onTick: (t: number) => void;
  onEnded: () => void;
  showVisuals: boolean;
  showMapVisuals?: boolean;
  selectedId: string | null;
  onSelectObject: (id: string | null) => void;
}

// Shared canvas replay/live renderer: cached terrain + structure layers with
// native Canvas2D creeps, interpolation, effects and RoomVisual playback.
export function CanvasStage({ recording, layout, relPath, playing, loading = false, speed, tick, onTick, onEnded, showVisuals, showMapVisuals = false, selectedId, onSelectObject }: Props) {
  const fontsReady = useRenderFonts();
  const terrainTextures = useTerrainTextures();
  const modImages = useModImages();
  const powerImages = usePowerImages();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const fittedRef = useRef<StageLayout | null>(null);
  const caches = useRef<{ sprites: CreepRenderer; layers: StaticLayers } | null>(null);
  const recordingRef = useRef(recording);
  const playhead = useRef(0);
  const lastTs = useRef(0);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const stateRef = useRef({ playing, loading, speed, tick, showVisuals, showMapVisuals, selectedId, onEnded });
  // The draw loop is created once; a ref lets it pick up the artwork as it
  // finishes decoding, without tearing the loop down and back up.
  const modImagesRef = useRef(modImages);
  const powerImagesRef = useRef(powerImages);
  // Bumps whenever the canvas bitmap is cleared behind the loop's back (a
  // resize, or the context being restored), so the next frame redraws.
  const resizeEpoch = useRef(0);
  const statsRef = useRef<RenderStats>({ drawMsEma: 0, draws: 0, detail: 'full', view: null });
  const statsEl = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  // Multi-object picker: when a click lands on a tile holding >1 object, offer a menu.
  const [menu, setMenu] = useState<{ x: number; y: number; items: FrameObject[] } | null>(null);
  recordingRef.current = recording;
  stateRef.current = { playing, loading, speed, tick, showVisuals, showMapVisuals, selectedId, onEnded };
  modImagesRef.current = modImages;
  powerImagesRef.current = powerImages;

  const colsTiles = (layout.width / layout.pixelsPerRoom) * 50;
  const rowsTiles = (layout.height / layout.pixelsPerRoom) * 50;

  // Set up the static layers once per recording/layout identity.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    if (!fontsReady || !terrainTextures) return () => { cancelled = true; };
    const initial = recordingRef.current;
    const sprites = new CreepRenderer();
    const layers = new StaticLayers(initial, layout, STATIC_LAYER_RESOLUTION, createTileCanvas, { textures: terrainTextures, modImages, finish: finishTile });
    caches.current = { sprites, layers };
    playhead.current = stateRef.current.tick;
    if (!cancelled) setReady(true);
    // The next run (or unmount) replaces these layers: close their tile
    // ImageBitmaps now, since GC barely sees the memory they hold.
    return () => {
      cancelled = true;
      if (caches.current?.layers === layers) caches.current = null;
      layers.dispose();
    };
  }, [layout, relPath, recording.meta.botUserId, fontsReady, terrainTextures, modImages]);

  // keep playhead synced to a scrubbed tick when paused
  useEffect(() => { if (!playing) playhead.current = tick; }, [tick, playing]);

  const fit = () => {
    const el = containerRef.current; if (!el) return;
    const cw = el.clientWidth || 1, ch = el.clientHeight || 1;
    const scale = Math.min(cw / colsTiles, ch / rowsTiles) * 0.96;
    viewRef.current = { scale, tx: (cw - colsTiles * scale) / 2, ty: (ch - rowsTiles * scale) / 2 };
  };
  useEffect(() => { if (fittedRef.current !== layout) { fittedRef.current = layout; fit(); } });

  // resize canvas to container × dpr
  useEffect(() => {
    const el = containerRef.current, cv = canvasRef.current; if (!el || !cv) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(el.clientWidth * dpr));
      const height = Math.max(1, Math.floor(el.clientHeight * dpr));
      // Assigning a canvas dimension clears its bitmap even when the value is
      // unchanged, and the loop only redraws when something changed.
      if (cv.width === width && cv.height === height) return;
      cv.width = width;
      cv.height = height;
      resizeEpoch.current++;
    });
    const onRestored = () => { resizeEpoch.current++; };
    ro.observe(el);
    cv.addEventListener('contextrestored', onRestored);
    return () => { ro.disconnect(); cv.removeEventListener('contextrestored', onRestored); };
  }, []);

  // Stats overlay: a timer copies the loop's numbers into the DOM.
  useEffect(() => {
    if (!SHOW_RENDER_STATS) return;
    let lastDraws = 0;
    const id = window.setInterval(() => {
      const el = statsEl.current, c = caches.current, s = statsRef.current;
      if (!el) return;
      const drawsPerSecond = (s.draws - lastDraws) * 1000 / STATS_INTERVAL_MS;
      lastDraws = s.draws;
      if (!c || !s.view) { el.textContent = 'render stats: waiting for a frame'; return; }
      const stats = c.layers.stats();
      const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
      el.textContent = [
        `draw ${s.drawMsEma.toFixed(2)} ms · ${drawsPerSecond.toFixed(0)} draws/s`,
        `detail ${s.detail} · lod ${c.layers.lodFor(s.view)} px/tile`,
        `visible rooms ${visibleRooms(layout, s.view).size}`,
        `tiles ${mb(stats.tileBytes)} MB · pinned ${mb(stats.pinnedBytes)} MB`,
        `queue ${stats.queued}`,
      ].join('\n');
    }, STATS_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [layout]);

  // render loop
  useEffect(() => {
    let raf = 0;
    // What the canvas shows now; a frame composing an equal state is skipped.
    let lastDrawn: DrawState | null = null;
    // Static layers are synced once per tick, not once per animation frame.
    let synced: { tick: number; recording: Recording; layers: StaticLayers } | null = null;
    // The last draw error logged, so a failing state logs once, not 60 times a second.
    let lastDrawError: string | null = null;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const cv = canvasRef.current, c = caches.current; if (!cv || !c) return;
      const ctx = cv.getContext('2d'); if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const st = stateRef.current;
      const activeRecording = recordingRef.current;
      const count = activeRecording.frames.length;
      if (!count) return;

      const { scale, tx, ty } = viewRef.current;
      const view = viewFromTransform(cv.width, cv.height, scale, tx, ty, dpr);
      const detail = detailLevel(view);

      // advance playhead during playback (1 tick = 1s at 1x)
      const dt = lastTs.current ? (ts - lastTs.current) / 1000 : 0;
      lastTs.current = ts;
      if (st.playing && ready) {
        playhead.current += dt * st.speed;
        if (playhead.current >= count - 1) {
          playhead.current = count - 1;
          if (!st.loading) st.onEnded();
        }
        const t = Math.floor(playhead.current);
        if (t !== st.tick) onTick(t);
      }
      const drawTick = Math.min(count - 1, st.playing ? Math.floor(playhead.current) : st.tick);
      // Zoomed right out, creeps are dots: draw once per tick instead of gliding.
      const sub = shouldAnimate(detail, st.playing && ready) ? playhead.current - Math.floor(playhead.current) : null;

      const next: DrawState = {
        layers: c.layers, recording: activeRecording, frameCount: count, tick: drawTick, sub,
        scale, tx, ty, dpr, width: cv.width, height: cv.height, resizeEpoch: resizeEpoch.current,
        selectedId: st.selectedId, showVisuals: st.showVisuals, showMapVisuals: st.showMapVisuals,
        smoothTurns: st.speed <= SMOOTH_TURN_MAX_SPEED,
        modImages: modImagesRef.current, powerImages: powerImagesRef.current, layersVersion: c.layers.version,
      };
      if (needsRedraw(lastDrawn, next)) {
        const drawStart = SHOW_RENDER_STATS ? performance.now() : 0;
        const f0 = activeRecording.frames[drawTick];
        // beginFrame before any tile is drawn: it starts a new frame id, and the
        // cache never evicts a tile drawn in the current frame. The build queue
        // it takes over is what the last frame lacked.
        c.layers.beginFrame();
        // A new tick, a new recording, or new layers (the setup effect swaps
        // them when fonts, textures or mod images arrive without re-running
        // this effect) are the only things that can change the static map.
        if (!synced || synced.tick !== drawTick || synced.recording !== activeRecording || synced.layers !== c.layers) {
          c.layers.sync(f0);
          synced = { tick: drawTick, recording: activeRecording, layers: c.layers };
        }

        // A throw here must not kill the loop: rAF is already re-armed, but an
        // uncaught error would skip lastDrawn and pump, and the next frame would
        // retry the same failing state forever. A null beam target once froze
        // the whole view that way with no sign but the console. So log it once,
        // count this state as drawn, and let a change of state try again.
        try {
          // clear + world transform (tile → device px)
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = '#0e0e0e';
          ctx.fillRect(0, 0, cv.width, cv.height);
          const s = scale * dpr;
          ctx.setTransform(s, 0, 0, s, tx * dpr, ty * dpr);
          drawFrame(ctx, activeRecording, drawTick, sub, {
            sprites: c.sprites, layers: c.layers, layout, showVisuals: st.showVisuals, showMapVisuals: st.showMapVisuals,
            modImages: modImagesRef.current, powerImages: powerImagesRef.current, smoothTurns: next.smoothTurns,
            view,
          });

          // selection ring
          if (st.selectedId) {
            const o = objectById(f0, st.selectedId);
            if (o && layout.offsets[o.room]) {
              const wx = layout.offsets[o.room].col * 50 + o.x + 0.5, wy = layout.offsets[o.room].row * 50 + o.y + 0.5;
              ctx.strokeStyle = 'rgba(70, 130, 255, 0.7)';
              ctx.lineWidth = 0.15;
              ctx.beginPath();
              ctx.arc(wx, wy, 1, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message !== lastDrawError) {
            lastDrawError = message;
            console.error('Replay draw failed:', error);
          }
        }

        // sync can invalidate tiles (bumping version) before this draw, which
        // already shows them; only builds after this point need another draw.
        lastDrawn = { ...next, layersVersion: c.layers.version };
        if (SHOW_RENDER_STATS) {
          const stats = statsRef.current;
          const ms = performance.now() - drawStart;
          stats.drawMsEma = stats.draws ? stats.drawMsEma + (ms - stats.drawMsEma) * DRAW_MS_EMA_WEIGHT : ms;
          stats.draws++;
          stats.detail = detail;
          stats.view = view;
        }
      }
      // Pumped even when nothing was drawn, so background tiles keep building.
      // It runs after the draws so the tiles this frame needs are already marked
      // in use; pumping first could evict tiles that are on screen, only to
      // rebuild them every frame. A tile it builds bumps layers.version, and
      // the next frame redraws.
      c.layers.pump(TILE_BUILD_BUDGET_MS, TILE_BUILD_BUDGET_PIXELS);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layout, ready]);

  // pan / zoom / select (screen → tile)
  const toTile = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - viewRef.current.tx) / viewRef.current.scale, y: (clientY - rect.top - viewRef.current.ty) / viewRef.current.scale };
  };
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const scale = Math.max(0.05, Math.min(40, v.scale * factor));
      viewRef.current = { scale, tx: mx - (mx - v.tx) * (scale / v.scale), ty: my - (my - v.ty) * (scale / v.scale) };
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => { const d = drag.current; if (!d) return; viewRef.current.tx = d.tx + (e.clientX - d.x); viewRef.current.ty = d.ty + (e.clientY - d.y); };
    const onUp = () => { drag.current = null; };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // preventDefault suppresses the browser's text-selection drag. Toggling
  // `user-select` on <body> did the same job but invalidated styles for the
  // entire document, which stalled the first frame of every pan by however
  // long it took to recalculate the console drawer's line elements.
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
  };
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
    const rank = (o: FrameObject) => (o.type === 'creep' || o.type === 'powerCreep' ? 0 : o.type === 'energy' || o.type === 'resource' ? 1 : o.type === 'rampart' ? 9 : 5);
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
      {SHOW_RENDER_STATS && <div ref={statsEl} className={styles.stats} />}
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

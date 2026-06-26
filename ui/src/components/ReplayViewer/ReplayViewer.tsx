import { useEffect, useMemo, useState } from 'react';
import type { Recording, StageLayout } from '../../api/types';
import { api } from '../../api/client';
import { usePrefs, setPrefs } from '../../state/prefs';
import { SvgStage } from '../SvgStage/SvgStage';
import { CanvasStage } from '../CanvasStage/CanvasStage';
import { computeStageLayout } from '../../render/geometry';
import { ConsoleDrawer } from '../ConsoleDrawer/ConsoleDrawer';
import { ObjectInspector } from '../ObjectInspector/ObjectInspector';
import styles from './ReplayViewer.module.css';

const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32, 64];

export function ReplayViewer({ recording, relPath }: { recording: Recording; relPath: string }) {
  const prefs = usePrefs();
  const frames = recording.frames;
  const count = frames.length;
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(prefs.defaultReplaySpeed || 1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [render, setRender] = useState<{ status: string; relPath?: string } | null>(null);
  const [showVisuals, setShowVisuals] = useState(prefs.showUserVisuals);
  const renderer = prefs.renderer; // 'svg' | 'canvas'

  // SVG renderer (option 1): pre-rendered frames + separate visual layer
  const [svgs, setSvgs] = useState<string[] | null>(null);
  const [visualLayers, setVisualLayers] = useState<string[] | null>(null);
  const [svgLayout, setSvgLayout] = useState<StageLayout | null>(null);
  const [renderErr, setRenderErr] = useState<string | null>(null);
  useEffect(() => {
    if (renderer !== 'svg') return;
    let cancelled = false;
    setSvgs(null); setVisualLayers(null); setSvgLayout(null); setRenderErr(null);
    api.renderedRecording(relPath)
      .then((r) => { if (!cancelled) { setSvgs(r.frames); setVisualLayers(r.visualLayers); setSvgLayout(r.layout); } })
      .catch((e) => { if (!cancelled) setRenderErr(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [relPath, renderer]);

  // canvas renderer (option 2): layout computed client-side; CanvasStage owns
  // its own rAF playback clock (so the SVG-mode interval below stays off for it).
  const canvasLayout = useMemo(() => computeStageLayout(Object.keys(recording.terrain || {})), [recording]);

  // SVG-mode discrete playback (canvas mode drives its own clock via onTick)
  useEffect(() => {
    if (!playing || renderer !== 'svg') return;
    const interval = Math.max(40, 1000 / speed);
    const step = Math.max(1, Math.round(speed * interval / 1000));
    const id = window.setInterval(() => {
      setTick((t) => { if (t >= count - 1) { setPlaying(false); return t; } return Math.min(count - 1, t + step); });
    }, interval);
    return () => window.clearInterval(id);
  }, [playing, speed, count, renderer]);

  const frame = frames[Math.min(tick, count - 1)] || null;
  // Peak per-tick CPU across the recording, to scale the CPU bar in the toolbar.
  const maxCpu = useMemo(() => {
    let m = 0;
    for (const f of frames) if (typeof f.cpu === 'number' && f.cpu > m) m = f.cpu;
    return m;
  }, [frames]);
  const curCpu = frame && typeof frame.cpu === 'number' ? frame.cpu : null;
  const cpuFrac = maxCpu > 0 && curCpu != null ? Math.min(1, curCpu / maxCpu) : 0;
  const cpuColor = cpuFrac > 0.8 ? '#e0564f' : cpuFrac > 0.5 ? '#e0a84f' : '#5bb98a';
  const selectedObj = useMemo(
    () => (selectedId && frame ? frame.objects.find((o) => o._id === selectedId) || null : null),
    [selectedId, frame]
  );
  const consoleLines = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i <= Math.min(tick, count - 1); i++) {
      const c = frames[i] && frames[i].console;
      if (c && c.length) for (const l of c) out.push('[' + (frames[i].gameTime ?? i) + '] ' + l);
    }
    return out;
  }, [tick, frames, count]);

  const doRender = async (format: 'gif' | 'mp4') => {
    setRender({ status: 'Rendering ' + format.toUpperCase() + '… this can take a while for long/multi-room runs.' });
    try {
      const { id } = await api.render(relPath, format);
      const es = new EventSource(api.renderStreamUrl(id));
      es.addEventListener('log', (e) => { try { setRender({ status: 'Rendering ' + format.toUpperCase() + '… ' + JSON.parse((e as MessageEvent).data).line }); } catch { /* */ } });
      es.addEventListener('done', (e) => {
        const rel = JSON.parse((e as MessageEvent).data).relPath;
        setRender({ status: 'done', relPath: rel });
        es.close();
        window.open(api.renderFileUrl(rel), '_blank', 'noopener');
      });
      es.addEventListener('failed', (e) => {
        let msg = 'render failed';
        try { const d = JSON.parse((e as MessageEvent).data); if (d.error) msg = 'render failed: ' + d.error; } catch { /* */ }
        setRender({ status: msg }); es.close();
      });
    } catch (e) { setRender({ status: 'error: ' + (e as Error).message }); }
  };

  const test = recording.meta.test;
  const clampTick = Math.min(tick, count - 1);

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <span className={styles.scenario}>{recording.meta.scenario}</span>
        {test && <span className={test.passed ? styles.pass : styles.fail}>{test.passed ? 'PASS' : 'FAIL'}</span>}
        <span className={styles.dim}>{recording.meta.endReason} · {count} frames</span>
        <span className={styles.dim} title="Bot CPU used this tick (ms)" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          · CPU {curCpu != null ? curCpu.toFixed(1) : '—'}ms
          <span style={{ display: 'inline-block', width: 56, height: 8, background: '#2a2a2a', borderRadius: 2, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${cpuFrac * 100}%`, background: cpuColor }} />
          </span>
        </span>
        <span className={styles.spacer} />
        <button className={styles.btn} title="Switch renderer" onClick={() => { setPlaying(false); setPrefs({ renderer: renderer === 'canvas' ? 'svg' : 'canvas' }); }}>
          {renderer === 'canvas' ? '◗ canvas' : '▢ svg'}
        </button>
        <button className={showVisuals ? styles.toggleOn : styles.btn} onClick={() => setShowVisuals((v) => !v)} title="Toggle the bot's own RoomVisual draws">👁 visuals</button>
        <button className={styles.btn} onClick={() => doRender('gif')}>⤓ GIF</button>
        <button className={styles.btn} onClick={() => doRender('mp4')}>⤓ MP4</button>
      </div>
      {render && (
        <div className={styles.render}>
          {render.relPath
            ? <span>✓ ready — <a href={api.renderFileUrl(render.relPath)} target="_blank" rel="noopener noreferrer">open in new tab</a> (or it opened automatically)</span>
            : render.status}
        </div>
      )}

      <div className={styles.canvas}>
        {renderer === 'canvas' ? (
          <CanvasStage recording={recording} layout={canvasLayout} relPath={relPath}
            playing={playing} speed={speed} tick={clampTick} onTick={setTick} onEnded={() => setPlaying(false)}
            showVisuals={showVisuals} selectedId={selectedId} onSelectObject={setSelectedId} />
        ) : renderErr ? <div className={styles.loading}>render error: {renderErr}</div>
          : !svgs ? <div className={styles.loading}>rendering frames…</div>
          : <SvgStage svg={svgs[clampTick] || null} layout={svgLayout}
              overlaySvg={showVisuals && visualLayers ? (visualLayers[clampTick] || null) : null}
              objects={frame ? frame.objects : []} selectedId={selectedId} onSelectObject={setSelectedId} />}
      </div>

      <div className={styles.scrub}>
        <button className={styles.play} onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚' : '▶'}</button>
        <input className={styles.range} type="range" min={0} max={Math.max(0, count - 1)} value={clampTick} onChange={(e) => { setPlaying(false); setTick(Number(e.target.value)); }} />
        <span className={styles.tickLabel}>tick {clampTick}/{count - 1}</span>
        <select className={styles.speed} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>

      <ConsoleDrawer lines={consoleLines} rightPanel={<ObjectInspector obj={selectedObj} gameTime={frame?.gameTime} />} rightTitle="Inspector" />
    </div>
  );
}

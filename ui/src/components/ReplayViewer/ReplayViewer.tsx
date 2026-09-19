import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Recording } from '../../api/types';
import { api } from '../../api/client';
import { usePrefs, REPLAY_SPEEDS } from '../../state/prefs';
import { CanvasStage } from '../CanvasStage/CanvasStage';
import { computeStageLayout } from '../../render/geometry';
import { ConsoleDrawer } from '../ConsoleDrawer/ConsoleDrawer';
import { buildConsoleIndex } from '../../api/consoleIndex';
import { ObjectInspector } from '../ObjectInspector/ObjectInspector';
import styles from './ReplayViewer.module.css';


interface RenderProgress {
  phase: 'preparing' | 'palette' | 'rendering' | 'finalising' | 'saving';
  completedFrames: number;
  totalFrames: number;
  percent: number;
  paletteFrames?: number;
  paletteTotalFrames?: number;
}

interface RenderState {
  status: string;
  id?: string;
  relPath?: string;
  progress?: RenderProgress;
  cancelling?: boolean;
}

function renderProgressLabel(format: 'gif' | 'mp4', progress: RenderProgress): string {
  const name = format.toUpperCase();
  if (progress.phase === 'preparing') return 'Preparing ' + name + '…';
  if (progress.phase === 'palette') return 'Building ' + name + ' palette…';
  if (progress.phase === 'finalising') return 'Finalising ' + name + '…';
  if (progress.phase === 'saving') return 'Saving ' + name + '…';
  return 'Rendering ' + name + '…';
}

export function ReplayViewer({ recording, relPath, loading = false, onPriority }: {
  recording: Recording; relPath: string; loading?: boolean; onPriority?: (urgent: boolean) => void;
}) {
  const prefs = usePrefs();
  const frames = recording.frames;
  const count = frames.length;
  const total = loading ? Math.max(count, (recording.meta.ticks || 0) + 1) : count;
  const [tick, setTick] = useState(0);
  const waiting = loading && tick >= count;
  useEffect(() => { onPriority?.(waiting); }, [waiting, onPriority]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(prefs.defaultReplaySpeed || 1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);
  const [showVisuals, setShowVisuals] = useState(prefs.showUserVisuals);
  // Jump-to-tick: the label doubles as the way in, so the scrub bar keeps its
  // single row.
  const [tickDraft, setTickDraft] = useState<string | null>(null);
  const editingTick = tickDraft !== null;
  const tickInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!editingTick) return;
    const input = tickInputRef.current;
    if (!input) return;
    input.focus();
    input.select(); // typing a new tick replaces the current one
  }, [editingTick]);
  // Layout is computed client-side; CanvasStage owns its rAF playback clock.
  const canvasLayout = useMemo(() => computeStageLayout(Object.keys(recording.terrain || {})), [recording.terrain]);

  const frame = waiting ? null : frames[Math.min(tick, count - 1)] || null;
  // Peak per-tick CPU across the recording, to scale the CPU bar in the toolbar.
  const cpuPeak = useRef({ frames, count: 0, max: 0 });
  if (cpuPeak.current.frames !== frames) cpuPeak.current = { frames, count: 0, max: 0 };
  for (let i = cpuPeak.current.count; i < count; i++) {
    cpuPeak.current.max = Math.max(cpuPeak.current.max, frames[i].cpu || 0);
  }
  cpuPeak.current.count = count;
  const maxCpu = cpuPeak.current.max;
  const curCpu = frame && typeof frame.cpu === 'number' ? frame.cpu : null;
  const cpuFrac = maxCpu > 0 && curCpu != null ? Math.min(1, curCpu / maxCpu) : 0;
  const cpuColor = cpuFrac > 0.8 ? '#e0564f' : cpuFrac > 0.5 ? '#e0a84f' : '#5bb98a';
  const selectedObj = useMemo(
    () => (selectedId && frame ? frame.objects.find((o) => o._id === selectedId) || null : null),
    [selectedId, frame]
  );
  // Indexed once per recording, not rebuilt per tick: playback and scrubbing
  // only need to know how many lines exist at the current tick, and the drawer
  // formats the handful it actually shows.
  const consoleIndex = useMemo(() => buildConsoleIndex(frames), [frames]);

  const doRender = async (format: 'gif' | 'mp4') => {
    setRender({ status: 'Rendering ' + format.toUpperCase() + '… this can take a while for long/multi-room runs.' });
    try {
      // Reuse the replay's existing speed selection; export speed has exactly
      // the same multiplier semantics and needs no separate control.
      const { id } = await api.render(relPath, format, speed);
      setRender({ id, status: 'Preparing ' + format.toUpperCase() + '…' });
      const es = new EventSource(api.renderStreamUrl(id));
      es.addEventListener('log', (e) => {
        try {
          const line = JSON.parse((e as MessageEvent).data).line;
          setRender((current) => ({ ...current, id, status: 'Rendering ' + format.toUpperCase() + '… ' + line }));
        } catch { /* */ }
      });
      es.addEventListener('progress', (e) => {
        try {
          const progress = JSON.parse((e as MessageEvent).data) as RenderProgress;
          setRender({ id, status: renderProgressLabel(format, progress), progress });
        } catch { /* */ }
      });
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
      es.addEventListener('cancelling', () => setRender((current) => ({ ...current, id, status: 'Cancelling export…', cancelling: true })));
      es.addEventListener('cancelled', () => { setRender({ status: 'Export cancelled and temporary files removed.' }); es.close(); });
    } catch (e) { setRender({ status: 'error: ' + (e as Error).message }); }
  };

  const cancelRender = async () => {
    if (!render?.id || render.cancelling) return;
    setRender((current) => current ? { ...current, status: 'Cancelling export…', cancelling: true } : current);
    try {
      await api.cancelRender(render.id);
    } catch (e) {
      setRender((current) => current ? { ...current, status: 'cancel failed: ' + (e as Error).message, cancelling: false } : current);
    }
  };

  const test = recording.meta.test;
  const clampTick = Math.min(tick, total - 1);
  const timelineStyle = {
    '--played': `${Math.min(clampTick, count - 1) / Math.max(1, total - 1) * 100}%`,
    '--loaded': `${(count - 1) / Math.max(1, total - 1) * 100}%`,
  } as CSSProperties;

  const openTickInput = () => { setPlaying(false); setTickDraft(String(clampTick)); };
  const commitTickInput = () => {
    const wanted = Number.parseInt(tickDraft ?? '', 10);
    if (Number.isFinite(wanted)) setTick(Math.max(0, Math.min(total - 1, wanted)));
    setTickDraft(null);
  };

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <span className={styles.scenario}>{recording.meta.scenario}</span>
        {test && <span className={test.passed ? styles.pass : styles.fail}>{test.passed ? 'PASS' : 'FAIL'}</span>}
        <span className={styles.dim}>{recording.meta.endReason} · {total} frames</span>
        <span className={styles.dim} title="Bot CPU used this tick (ms)" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          · CPU {curCpu != null ? curCpu.toFixed(1) : '—'}ms
          <span style={{ display: 'inline-block', width: 56, height: 8, background: '#2a2a2a', borderRadius: 2, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${cpuFrac * 100}%`, background: cpuColor }} />
          </span>
        </span>
        <span className={styles.spacer} />
        <button className={showVisuals ? styles.toggleOn : styles.btn} onClick={() => setShowVisuals((v) => !v)} title="Toggle the bot's own RoomVisual draws">👁 visuals</button>
        <button className={styles.btn} onClick={() => doRender('gif')}>⤓ GIF</button>
        <button className={styles.btn} onClick={() => doRender('mp4')}>⤓ MP4</button>
      </div>
      {render && (
        <div className={styles.render}>
          {render.relPath
            ? <span>✓ ready — <a href={api.renderFileUrl(render.relPath)} target="_blank" rel="noopener noreferrer">open in new tab</a> (or it opened automatically)</span>
            : <>
                <div className={styles.renderLine}>
                  <span>{render.status}</span>
                  <span className={styles.renderActions}>
                    {render.progress && (render.progress.phase === 'palette'
                      ? `${render.progress.paletteFrames?.toLocaleString() || 0} / ${render.progress.paletteTotalFrames?.toLocaleString() || 0} samples`
                      : `${render.progress.percent}% · ${render.progress.completedFrames.toLocaleString()} / ${render.progress.totalFrames.toLocaleString()} frames`)}
                    {render.id && <button type="button" className={styles.cancel} disabled={render.cancelling} onClick={cancelRender}>{render.cancelling ? 'cancelling…' : 'cancel'}</button>}
                  </span>
                </div>
                {render.progress && (
                  <div className={styles.renderTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={render.progress.percent}>
                    <span className={styles.renderFill} style={{ width: `${render.progress.percent}%` }} />
                  </div>
                )}
              </>}
        </div>
      )}

      <div className={styles.canvas}>
        <CanvasStage recording={recording} layout={canvasLayout} relPath={relPath}
          playing={playing && !waiting} loading={loading} speed={speed} tick={clampTick} onTick={setTick} onEnded={() => setPlaying(false)}
          showVisuals={showVisuals} selectedId={selectedId} onSelectObject={setSelectedId} />
        {waiting && <div className={styles.seekLoading} role="status">Loading tick {clampTick.toLocaleString()}…</div>}
      </div>

      <div className={styles.scrub}>
        <button className={styles.play} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚' : '▶'}</button>
        <input className={styles.range} type="range" min={0} max={Math.max(0, total - 1)} value={clampTick}
          aria-label="Replay timeline" aria-valuetext={`Tick ${clampTick} of ${total - 1}, loaded through tick ${count - 1}`}
          style={timelineStyle}
          onChange={(e) => { setPlaying(false); setTick(Number(e.target.value)); }} />
        {loading && <span className={styles.bufferStatus}>{playing && clampTick >= count - 1 ? 'Buffering…' : `Loading ${Math.min(99, Math.floor(count / total * 100))}%`}</span>}
        <span className={styles.tickLabel}>
          {tickDraft === null
            ? <button type="button" className={styles.tickButton} onClick={openTickInput}
                title="Jump to a tick">tick {clampTick}/{total - 1}</button>
            : <>
                <input ref={tickInputRef} className={styles.tickInput} type="text" inputMode="numeric"
                  value={tickDraft} aria-label={`Jump to a tick (0-${total - 1})`}
                  onChange={(e) => setTickDraft(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTickInput();
                    else if (e.key === 'Escape') setTickDraft(null);
                  }}
                  // Clicking away accepts what was typed; OK commits it itself.
                  onBlur={(e) => { if (!(e.relatedTarget instanceof HTMLElement) || !e.relatedTarget.hasAttribute('data-tick-go')) commitTickInput(); }} />
                <button type="button" className={styles.tickGo} data-tick-go="" onClick={commitTickInput}>OK</button>
                <span className={styles.dim}>/{total - 1}</span>
              </>}
        </span>
        <select className={styles.speed} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {REPLAY_SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>

      <ConsoleDrawer source={consoleIndex} available={waiting ? 0 : consoleIndex.countUpTo(clampTick)} sourceKey={relPath}
        rightPanel={<ObjectInspector obj={selectedObj} gameTime={frame?.gameTime} botUserId={recording.meta.botUserId} />} rightTitle="Inspector" />
    </div>
  );
}

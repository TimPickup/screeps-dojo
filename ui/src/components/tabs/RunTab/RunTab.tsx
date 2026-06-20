import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { useJobStream } from '../../../hooks/useJobStream';
import { SvgStage } from '../../SvgStage/SvgStage';
import { ObjectInspector } from '../../ObjectInspector/ObjectInspector';
import { ConsoleDrawer } from '../../ConsoleDrawer/ConsoleDrawer';
import styles from './RunTab.module.css';

export function RunTab({ scenario }: { scenario: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [record, setRecord] = useState(true);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stream = useJobStream(jobId);
  const running = jobId !== null && !stream.ended;

  // Reconnect to a run already in progress for this scenario when the tab
  // remounts (e.g. you navigated to Edit and came back) — the server keeps the
  // active job and the stream replays its history, so it keeps rendering live.
  useEffect(() => {
    if (jobId) return;
    let cancelled = false;
    api.activeJob().then((j) => {
      if (!cancelled && j && j.kind === 'run' && j.scenario === scenario) setJobId(j.jobId);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [scenario, jobId]);
  const selectedObj = stream.lastFrame && selectedId ? (stream.lastFrame.objects.find((o) => o._id === selectedId) || null) : null;

  const play = async () => {
    setBusy(true); setRunError(null);
    try { const r = await api.run(scenario, record); setJobId(r.jobId); }
    catch (e) { setRunError(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };
  const abort = async () => { if (jobId) await api.abort(jobId); };
  const reset = () => { setJobId(null); setRunError(null); };

  return (
    <div className={styles.run}>
      <div className={styles.toolbar}>
        {!running && <button className={styles.play} disabled={busy} onClick={play}>▶ Run</button>}
        {running && <button className={styles.abort} onClick={abort}>■ Abort</button>}
        {jobId && stream.ended && <button className={styles.again} onClick={reset}>↺ New run</button>}
        <label className={styles.record}><input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} /> record</label>
        <span className={styles.spacer} />
        {jobId && <span className={styles.tick}>tick {stream.lastTick}{stream.maxTicks ? '/' + stream.maxTicks : ''}</span>}
        {stream.ended && <span className={styles.end}>{stream.error ? 'error: ' + stream.error : 'ended: ' + stream.endReason}</span>}
        {runError && <span className={styles.end} style={{ color: 'var(--warn)' }}>{runError}</span>}
      </div>

      {stream.error && (
        <div className={styles.errorBanner}>⚠ Run failed: {stream.error}</div>
      )}
      <div className={styles.canvas}>
        {!jobId ? (
          <div className={styles.idle}>
            <button className={styles.bigPlay} disabled={busy} onClick={play}>▶</button>
            <div className={styles.idleHint}>Press Run — it streams live here.</div>
          </div>
        ) : stream.lastFrame && stream.lastFrame.svg ? (
          <SvgStage svg={stream.lastFrame.svg} layout={stream.layout} objects={stream.lastFrame.objects} selectedId={selectedId} onSelectObject={setSelectedId} />
        ) : (
          <div className={styles.idle}><div className={styles.idleHint}>booting server…</div></div>
        )}
      </div>

      {stream.ended && stream.recordingPath && (
        <div className={styles.recnote}>recording saved — see the <b>Replays</b> tab</div>
      )}
      <ConsoleDrawer lines={stream.console} rightPanel={<ObjectInspector obj={selectedObj} />} rightTitle="Inspector" />
    </div>
  );
}

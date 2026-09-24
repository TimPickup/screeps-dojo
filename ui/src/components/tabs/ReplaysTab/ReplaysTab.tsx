import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { recordingSubtitle, statusLabel } from '../../../api/recordingLabels';
import type { RecordingEntry, Recording } from '../../../api/types';
import type { ReplayBatch } from '../../../api/replayStream';
import { ReplayViewer } from '../../ReplayViewer/ReplayViewer';
import type { CpuSummary } from '../../../state/cpuSummary';
import styles from './ReplaysTab.module.css';

export function ReplaysTab({ scenario }: { scenario: string }) {
  const [list, setList] = useState<RecordingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [buffering, setBuffering] = useState(false);
  // True only once the last batch has arrived. A failed stream also stops
  // buffering, but leaves a partial replay that must not be averaged and cached.
  const [complete, setComplete] = useState(false);
  const replayWorker = useRef<Worker | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Every load is stamped, and only the newest one is allowed to write state.
  // Without this, switching scenarios while a request is in flight can let the
  // older response land last and repopulate the list with the wrong scenario.
  const latestLoad = useRef(0);
  // Synchronous in-flight latch. The disabled attribute below only applies on
  // the next render, so without this a burst of clicks in a single tick all slip
  // through it and stack up requests.
  const inFlight = useRef(false);

  const load = useCallback((forScenario: string) => {
    const id = ++latestLoad.current;
    inFlight.current = true;
    setLoading(true);
    api.recordings(forScenario)
      .then((entries) => {
        if (id !== latestLoad.current) return;
        setList(entries);
        setError(null);
      })
      .catch((e: Error) => {
        if (id !== latestLoad.current) return;
        setList([]);
        setError(String(e.message || e));
      })
      .finally(() => {
        // only the newest load clears the latch, so a scenario switch mid-flight
        // cannot let an older response reopen the gate early
        if (id === latestLoad.current) { inFlight.current = false; setLoading(false); }
      });
  }, []);

  useEffect(() => {
    setList([]);
    setSelected(null);
    setRecording(null);
    setError(null);
    load(scenario);
    return () => { replayWorker.current?.terminate(); replayWorker.current = null; };
  }, [scenario, load]);

  // Scenario changes always load (the effect calls load directly); only the
  // manual button is gated, so repeated clicks cannot queue up requests.
  const refresh = () => { if (!inFlight.current) load(scenario); };
  // First time a replay is averaged: store it on the server, and on the list
  // entry so reopening it in this session doesn't average it again either.
  const saveCpuAvg = useCallback((relPath: string, cpuAvg: CpuSummary) => {
    setList((entries) => entries.map((e) => (e.relPath === relPath && e.meta ? { ...e, meta: { ...e.meta, cpuAvg } } : e)));
    api.saveRecordingCpuAvg(relPath, cpuAvg).catch(() => { /* a cache: recomputed next time */ });
  }, []);
  const setReplayPriority = useCallback((urgent: boolean) => {
    replayWorker.current?.postMessage({ type: 'priority', urgent });
  }, []);

  const open = (entry: RecordingEntry) => {
    replayWorker.current?.terminate();
    setSelected(entry.relPath);
    setRecording(null);
    setBuffering(true);
    setComplete(false);
    setError(null);
    const worker = new Worker(new URL('../../../api/replay.worker.ts', import.meta.url), { type: 'module' });
    replayWorker.current = worker;
    let current: Recording | null = null;
    const fail = (message: string) => {
      if (replayWorker.current !== worker) return;
      setError(message);
      setBuffering(false);
      worker.terminate();
    };
    worker.onerror = () => fail('Unable to load this replay. Select it to retry.');
    worker.onmessage = ({ data }: MessageEvent<ReplayBatch>) => {
      if (replayWorker.current !== worker) return;
      if (data.error) { fail(data.error); return; }
      // meta.json (the list entry) can carry a CPU average cached after the
      // recording.json was written; it wins over the embedded copy.
      if (!current) current = { meta: { ...data.meta!, cpuAvg: entry.meta?.cpuAvg ?? data.meta!.cpuAvg }, terrain: data.terrain!, frames: [] };
      // Append once; do not copy the entire replay with each incoming batch.
      for (const frame of data.frames) current.frames.push(frame);
      setRecording({ ...current });
      setBuffering(!data.done);
      setComplete(data.done);
      if (data.done) worker.terminate();
      else worker.postMessage('ack');
    };
    worker.postMessage(entry.relPath);
  };

  return (
    <div className={styles.wrap}>
      <aside className={styles.list}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className={styles.meta}>Recordings</span>
          <button
            className={styles.btn}
            onClick={refresh}
            disabled={loading}
            title={loading ? 'Loading…' : 'Refresh'}
          >↻</button>
        </div>
        {loading && <div className={styles.meta}>Loading recordings…</div>}
        {!loading && !error && list.length === 0 && (
          <div className={styles.meta}>No recordings yet. Run with “record”.</div>
        )}
        {/* hide the stale list while reloading rather than leave it on screen */}
        {!loading && list.map((r) => {
          const t = r.meta?.test;
          // An unfinalised run has no PASS/FAIL to show — it never got as far as
          // expect() — so its state is the badge instead.
          const stateClass = r.status === 'running' ? styles.badgeLive
            : r.status === 'interrupted' ? styles.badgeStale
            : styles.meta;
          return (
            <button key={r.relPath} className={`${styles.row} ${selected === r.relPath ? styles.rowSel : ''}`} onClick={() => open(r)}>
              <div>
                {t ? <span className={t.passed ? styles.badgePass : styles.badgeFail}>● {t.passed ? 'PASS' : 'FAIL'}</span>
                   : <span className={stateClass}>● {statusLabel(r.status)}</span>}
              </div>
              <div className={styles.meta}>{recordingSubtitle(r, { includeStatus: Boolean(t) })}</div>
            </button>
          );
        })}
      </aside>
      <section className={styles.main}>
        {error && <div style={{ color: 'var(--hostile)', padding: 12 }}>{error}</div>}
        {!selected && !error && <div className={styles.empty}>Select a recording to watch.</div>}
        {selected && !recording && !error && <div className={styles.empty}>Loading…</div>}
        {recording && selected && <ReplayViewer key={selected} recording={recording} relPath={selected} loading={buffering} complete={complete} onPriority={setReplayPriority} onCpuAvg={saveCpuAvg} />}
      </section>
    </div>
  );
}

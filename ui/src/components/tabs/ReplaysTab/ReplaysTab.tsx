import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { recordingSubtitle, statusLabel } from '../../../api/recordingLabels';
import type { RecordingEntry, Recording } from '../../../api/types';
import { ReplayViewer } from '../../ReplayViewer/ReplayViewer';
import styles from './ReplaysTab.module.css';

export function ReplaysTab({ scenario }: { scenario: string }) {
  const [list, setList] = useState<RecordingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
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
  }, [scenario, load]);

  // Scenario changes always load (the effect calls load directly); only the
  // manual button is gated, so repeated clicks cannot queue up requests.
  const refresh = () => { if (!inFlight.current) load(scenario); };

  const open = async (entry: RecordingEntry) => {
    setSelected(entry.relPath);
    setRecording(null);
    setError(null);
    try { setRecording(await api.recording(entry.relPath)); }
    catch (e) { setError(String((e as Error).message || e)); }
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
        {recording && selected && <ReplayViewer recording={recording} relPath={selected} />}
      </section>
    </div>
  );
}

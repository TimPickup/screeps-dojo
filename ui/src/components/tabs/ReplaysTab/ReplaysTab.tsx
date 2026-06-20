import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { RecordingEntry, Recording } from '../../../api/types';
import { ReplayViewer } from '../../ReplayViewer/ReplayViewer';
import styles from './ReplaysTab.module.css';

export function ReplaysTab({ scenario }: { scenario: string }) {
  const [list, setList] = useState<RecordingEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    api.recordings().then((all) => setList(all.filter((r) => r.scenario === scenario))).catch((e) => setError(String(e.message || e)));
  useEffect(() => { refresh(); }, [scenario]);

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
          <button className={styles.btn} onClick={refresh}>↻</button>
        </div>
        {list.length === 0 && <div className={styles.meta}>No recordings yet. Run with “record”.</div>}
        {list.map((r) => {
          const t = r.meta?.test;
          return (
            <button key={r.relPath} className={`${styles.row} ${selected === r.relPath ? styles.rowSel : ''}`} onClick={() => open(r)}>
              <div>
                {t ? <span className={t.passed ? styles.badgePass : styles.badgeFail}>● {t.passed ? 'PASS' : 'FAIL'}</span>
                   : <span className={styles.meta}>● {r.meta?.endReason || '?'}</span>}
              </div>
              <div className={styles.meta}>{r.timestamp} · {r.meta?.ticks ?? '?'}t · {r.meta?.endReason}</div>
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

import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { bootstrapCopy } from './bootstrapCopy';
import styles from './Bootstrap.module.css';

// First-run welcome: streams the in-container install log. Survives a closed
// tab (the server tails a log file), so reopening re-attaches.
//
// It also covers the repair case — a container whose node_modules is older than
// the code it runs, which happens once to anyone updating from a release before
// the launchers renewed the volume. Same screen, same log, different words: the
// first-run copy would tell someone mid-project that this is their first run.
export function Bootstrap({ onReady }: { onReady: () => void }) {
  const [log, setLog] = useState('');
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState<'install' | 'repair' | null>(null);
  const bodyRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    // Best effort: if this fails the screen still works, it just uses the
    // first-run wording.
    api.bootstrapStatus().then((s) => setReason(s.reason)).catch(() => {});
  }, []);

  useEffect(() => {
    const es = new EventSource(api.bootstrapStreamUrl());
    es.addEventListener('log', (e) => { try { setLog((l) => l + JSON.parse((e as MessageEvent).data).line); } catch { /* */ } });
    es.addEventListener('ready', () => { es.close(); onReady(); });
    es.addEventListener('failed', () => { es.close(); setFailed(true); });
    return () => es.close();
  }, [onReady]);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [log]);

  const copy = bootstrapCopy(reason, failed);

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.sub}>{copy.sub}</p>
      <pre className={styles.log} ref={bodyRef}>{log || 'starting…'}</pre>
      {!failed && <div className={styles.spinner}>● ● ●</div>}
    </div>
  );
}

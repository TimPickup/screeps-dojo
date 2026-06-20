import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import styles from './Bootstrap.module.css';

// First-run welcome: streams the in-container install log. Survives a closed
// tab (the server tails a log file), so reopening re-attaches.
export function Bootstrap({ onReady }: { onReady: () => void }) {
  const [log, setLog] = useState('');
  const [failed, setFailed] = useState(false);
  const bodyRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const es = new EventSource(api.bootstrapStreamUrl());
    es.addEventListener('log', (e) => { try { setLog((l) => l + JSON.parse((e as MessageEvent).data).line); } catch { /* */ } });
    es.addEventListener('ready', () => { es.close(); onReady(); });
    es.addEventListener('failed', () => { es.close(); setFailed(true); });
    return () => es.close();
  }, [onReady]);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [log]);

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>⛬ Setting up Screeps Dojo</h1>
      <p className={styles.sub}>{failed ? 'Install failed — check the log below and your Docker setup.' : 'Installing the server toolchain (first run, a few minutes). You can leave this tab; the install keeps running.'}</p>
      <pre className={styles.log} ref={bodyRef}>{log || 'starting…'}</pre>
      {!failed && <div className={styles.spinner}>● ● ●</div>}
    </div>
  );
}

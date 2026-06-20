import { useState } from 'react';
import { api } from '../../../api/client';
import { useJobStream } from '../../../hooks/useJobStream';
import styles from './TestTab.module.css';

export function TestTab({ scenario }: { scenario: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stream = useJobStream(jobId);
  const running = jobId !== null && !stream.ended;

  const run = async () => {
    setBusy(true);
    try { const r = await api.test(scenario); setJobId(r.jobId); }
    finally { setBusy(false); }
  };

  const verdict = stream.ended ? (stream.error ? 'ERROR' : stream.test ? (stream.test.passed ? 'PASSED' : 'FAILED') : stream.endReason) : null;
  const verdictClass = verdict === 'PASSED' ? styles.pass : verdict === 'FAILED' || verdict === 'ERROR' ? styles.fail : styles.neutral;

  return (
    <div className={styles.test}>
      <div className={styles.toolbar}>
        <button className={styles.run} disabled={busy || running} onClick={run}>▶ Run test</button>
        {running && <span className={styles.dim}>running… tick {stream.lastTick}/{stream.maxTicks}</span>}
      </div>
      <div className={styles.output}>
        {!jobId && <div className={styles.dim}>Run the scenario headlessly and see pass/fail.</div>}
        {jobId && (
          <>
            <div className={styles.line}>› scenario: {scenario}</div>
            {stream.started && <div className={styles.line}>› running, max {stream.maxTicks} ticks…</div>}
            {stream.ended && (
              <>
                <div className={styles.line}>› ended: {stream.endReason} after {stream.lastTick} ticks</div>
                {stream.test && stream.test.message && <div className={styles.lineErr}>› {stream.test.message}</div>}
                {stream.error && <div className={styles.lineErr}>› {stream.error}</div>}
                <div className={`${styles.verdict} ${verdictClass}`}>{verdict === 'PASSED' ? '✓ PASSED' : verdict === 'FAILED' ? '✗ FAILED' : verdict}</div>
              </>
            )}
          </>
        )}
        {stream.console.length > 0 && (
          <div className={styles.consoleBlock}>
            <div className={styles.consoleHead}>console</div>
            {stream.console.map((l, i) => <div key={i} className={styles.cline}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

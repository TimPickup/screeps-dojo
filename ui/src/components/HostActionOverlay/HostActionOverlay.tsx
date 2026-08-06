import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useHostAction, clearHostAction, decidePhase, ACTION_TITLE, ACTION_FALLBACK } from '../../state/hostAction';
import styles from './HostActionOverlay.module.css';

const POLL_MS = 1000;

// Covers everything, including the Settings panel it was usually launched from,
// because the server is about to disappear and no screen underneath is usable
// until it returns. The connection dropping is the EXPECTED middle of this, not
// an error — only the deadline or an explicit failure ends it badly.
export function HostActionOverlay() {
  const { action, id, startedAt } = useHostAction();
  const [failure, setFailure] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!action) { setFailure(null); setLog([]); return; }

    let live = true;
    const poll = async () => {
      // The log is best-effort: while the container is down this simply fails,
      // and the last lines we did get stay on screen.
      api.hostAgentLog(14).then((r) => { if (live) setLog(r.lines); }).catch(() => {});

      let status = null;
      let unreachable = false;
      try { status = await api.hostAgent(); } catch { unreachable = true; }
      if (!live) return;

      const verdict = decidePhase({
        action, id, elapsedMs: Date.now() - startedAt, unreachable,
        busy: status ? status.busy : false,
        lastResult: status ? status.lastResult : null
      });
      if (verdict.phase === 'done') clearHostAction();
      else if (verdict.phase === 'failed') setFailure(verdict.detail);
    };

    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [action, id, startedAt]);

  if (!action) return null;

  const title = ACTION_TITLE[action] || 'Working';
  const fallback = ACTION_FALLBACK[action] || 'npm run ui';

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {failure === null ? (
          <>
            <h2 className={styles.title}>{title}… Please wait!</h2>
            <div className={styles.dots} aria-label="working">
              <span /><span /><span /><span />
            </div>
            <p className={styles.sub}>
              The dojo server is being replaced, so this page will lose its connection for a
              moment and reconnect on its own.
            </p>
          </>
        ) : (
          <>
            <h2 className={`${styles.title} ${styles.titleBad}`}>{title} failed</h2>
            <p className={styles.subBad}>{failure}</p>
            <div className={styles.help}>
              <div>Run this on the host to finish it by hand:</div>
              <code className={styles.cmd}>{fallback}</code>
              <div className={styles.helpDim}>
                Still stuck? <code>docker compose logs ui</code> shows why the server would not
                start, and <code>.dojo-host/agent.log</code> has the full output of what ran.
              </div>
            </div>
            <button className={styles.dismiss} onClick={clearHostAction}>Dismiss</button>
          </>
        )}

        {log.length > 0 && <pre className={styles.log}>{log.join('\n')}</pre>}
      </div>
    </div>
  );
}

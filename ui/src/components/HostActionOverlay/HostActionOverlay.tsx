import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import {
  useHostAction, clearHostAction, decidePhase, describeProgress,
  ACTION_TITLE, ACTION_FALLBACK, ACTION_DURATION
} from '../../state/hostAction';
import { rememberSettingsForReload } from '../../state/settingsOverlay';
import styles from './HostActionOverlay.module.css';

const POLL_MS = 1000;

// Covers everything, including the Settings panel it was usually launched from,
// because the server is about to disappear and no screen underneath is usable
// until it returns. The connection dropping is the EXPECTED middle of this, not
// an error — only the deadline or an explicit failure ends it badly.
//
// Success ends in a full page RELOAD rather than just hiding this. The code the
// browser is running has been replaced underneath it: without a reload the
// version in the header, the update banner and everything Settings had already
// read all still describe the build that was there before.
export function HostActionOverlay() {
  const { action, id, startedAt } = useHostAction();
  const [failure, setFailure] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  // Raw output is reassurance, not reading material — available, not in the way.
  const [showLog, setShowLog] = useState(false);

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
        pending: status ? Boolean(status.pending && status.pending.id === id) : false,
        lastResult: status ? status.lastResult : null
      });
      if (verdict.phase === 'done') {
        live = false;
        setReloading(true);
        rememberSettingsForReload();
        // A beat so "done" is seen rather than flashing past on the way out.
        window.setTimeout(() => window.location.reload(), 900);
      } else if (verdict.phase === 'failed') {
        setFailure(verdict.detail);
      }
    };

    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [action, id, startedAt]);

  if (!action) return null;

  const title = ACTION_TITLE[action] || 'Working';
  const fallback = ACTION_FALLBACK[action] || 'npm run ui';
  const duration = ACTION_DURATION[action];

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {reloading ? (
          <>
            <h2 className={`${styles.title} ${styles.titleOk}`}>Done — reloading…</h2>
            <p className={styles.sub}>Picking up the new version.</p>
          </>
        ) : failure === null ? (
          <>
            <h2 className={styles.title}>{title}… Please wait!</h2>
            {/* The first thing to read, because the honest answer to "is this
                broken?" is nearly always "no, it is just slow". */}
            {duration && (
              <p className={styles.duration}>
                This can take <b>{duration}</b>, depending on the update and your machine.
              </p>
            )}
            <div className={styles.dots} aria-label="working">
              <span /><span /><span /><span />
            </div>
            <p className={styles.phase}>{describeProgress(log, 'Working…')}</p>
            <p className={styles.sub}>
              Please don&rsquo;t navigate away or close this tab. The server restarts partway
              through, so the page loses its connection for a moment and comes back on its own.
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

        {log.length > 0 && !reloading && (
          <div className={styles.details}>
            <button className={styles.toggle} onClick={() => setShowLog((v) => !v)}>
              {showLog ? 'Hide details' : 'Show details'}
            </button>
            {showLog && <pre className={styles.log}>{log.join(String.fromCharCode(10))}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}

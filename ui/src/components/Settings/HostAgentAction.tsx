import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { HostAgentStatus } from '../../api/types';
import styles from './HostAgentAction.module.css';

interface Props {
  action: string;
  label: string;
  // Shown when no agent is listening — the command that does the same thing.
  // Omit it where the page already shows that command, so it is not said twice.
  fallback?: string;
}

const POLL_MS = 4000;

// One button for one host action, with the honest fallback built in: with no
// agent running there is no button, only the command that does the same thing.
// The GUI runs inside the container and can neither recreate itself nor rebuild
// its image, so this is a request, not a call.
export function HostAgentAction({ action, fallback, label }: Props) {
  const [status, setStatus] = useState<HostAgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    const poll = () => {
      api.hostAgent()
        .then((s) => { if (live) { setStatus(s); if (!s.pending && !s.busy) setAsked(false); } })
        .catch(() => { if (live) setStatus(null); });
    };
    poll();
    timer.current = window.setInterval(poll, POLL_MS);
    return () => { live = false; if (timer.current) window.clearInterval(timer.current); };
  }, []);

  const offered = status?.running && status.actions.includes(action);
  // `recreate` restarts the very server this page is talking to, so the page
  // will drop its connection for a few seconds. Say so before it happens.
  const interrupts = action === 'recreate' || action === 'restart' || action === 'update';

  if (!offered) {
    if (!fallback) return null;
    return (
      <div className={styles.hint}>
        Run <code>{fallback}</code> on the host. (Start <code>npm run host-agent</code> once and this
        becomes a button.)
      </div>
    );
  }

  const run = async () => {
    setError(null);
    setAsked(true);
    try { await api.hostAgentRequest(action); }
    catch (e) { setAsked(false); setError((e as Error).message); }
  };

  const working = asked || status.busy || Boolean(status.pending);
  const last = status.lastResult && status.lastResult.action === action ? status.lastResult : null;

  return (
    <div className={styles.row}>
      <button className={styles.btn} disabled={working} onClick={run}>
        {working ? 'working…' : label}
      </button>
      {interrupts && !working && <span className={styles.hint}>the GUI will reconnect on its own</span>}
      {error && <span className={styles.err}>{error}</span>}
      {!working && last && (
        <span className={last.ok ? styles.ok : styles.err}>
          {last.ok ? '✓ done' : '✗ ' + (last.message || 'failed')}
        </span>
      )}
    </div>
  );
}

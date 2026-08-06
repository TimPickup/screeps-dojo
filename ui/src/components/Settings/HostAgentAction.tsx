import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { HostAgentStatus } from '../../api/types';
import { startHostAction } from '../../state/hostAction';
import styles from './HostAgentAction.module.css';

interface Props {
  action: string;
  label: string;
  // Shown when no agent is listening — the command that does the same thing.
  // Omit it where the page already shows that command, so it is not said twice.
  fallback?: string;
  // Whether there is anything to do. The button stays visible either way: a
  // control that appears and disappears is harder to find than one that is
  // simply greyed out, and its state doubles as the answer to "do I need to?".
  enabled?: boolean;
  disabledReason?: string;
  note?: string;
}

const POLL_MS = 5000;

// One button for one host action, with the honest fallback built in: with no
// agent running there is no button, only the command that does the same thing.
// The GUI runs inside the container and can neither recreate itself nor rebuild
// its image, so this is a request, not a call.
//
// Progress and failure are NOT shown here. The action takes the server away, so
// they belong to HostActionOverlay, which covers the whole app — a panel that
// is about to stop being able to talk to anything is the wrong place to watch
// from.
export function HostAgentAction({ action, label, fallback, enabled = true, disabledReason, note }: Props) {
  const [status, setStatus] = useState<HostAgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    const poll = () => {
      api.hostAgent()
        .then((s) => { if (live) setStatus(s); })
        .catch(() => { if (live) setStatus(null); });
    };
    poll();
    timer.current = window.setInterval(poll, POLL_MS);
    return () => { live = false; if (timer.current) window.clearInterval(timer.current); };
  }, []);

  const offered = status?.running && status.actions.includes(action);

  if (!offered) {
    if (!fallback) return null;
    // No agent answering. `npm run ui` normally starts one, so this is either
    // --no-agent, a stopped agent, or a machine where spawning it failed —
    // in every case the command is still the answer.
    return (
      <div className={styles.hint}>
        Run <code>{fallback}</code> on the host, or start the helper that does it for you:{' '}
        <code>npm run host-agent</code>.
      </div>
    );
  }

  const run = async () => {
    setError(null);
    try {
      const { id } = await api.hostAgentRequest(action);
      startHostAction(action, id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const busy = Boolean(status.busy || status.pending);

  return (
    <div className={styles.row}>
      <button className={styles.btn} disabled={busy || !enabled} onClick={run}>
        {busy ? 'working…' : label}
      </button>
      {!busy && note && <span className={styles.hint}>{note}</span>}
      {!busy && !enabled && disabledReason && <span className={styles.hint}>{disabledReason}</span>}
      {error && <span className={styles.err}>{error}</span>}
    </div>
  );
}

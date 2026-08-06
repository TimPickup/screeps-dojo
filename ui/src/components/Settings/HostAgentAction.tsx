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
  const [tail, setTail] = useState<string[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    const poll = () => {
      api.hostAgent()
        .then((s) => {
          if (!live) return;
          setStatus(s);
          if (!s.pending && !s.busy) setAsked(false);
        })
        .catch(() => { if (live) setStatus(null); });
    };
    poll();
    timer.current = window.setInterval(poll, POLL_MS);
    return () => { live = false; if (timer.current) window.clearInterval(timer.current); };
  }, []);

  // Tail the agent's log only while something is actually running — polling a
  // file every few seconds for a button nobody pressed is pure noise.
  const busyNow = Boolean(status && (status.busy || status.pending)) || asked;
  useEffect(() => {
    if (!busyNow) { setTail([]); return; }
    let live = true;
    const pull = () => { api.hostAgentLog(12).then((r) => { if (live) setTail(r.lines); }).catch(() => {}); };
    pull();
    const id = window.setInterval(pull, 1500);
    return () => { live = false; window.clearInterval(id); };
  }, [busyNow]);

  const offered = status?.running && status.actions.includes(action);
  // `recreate` restarts the very server this page is talking to, so the page
  // will drop its connection for a few seconds. Say so before it happens.
  const interrupts = action === 'recreate' || action === 'restart' || action === 'update';

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
    setAsked(true);
    try { await api.hostAgentRequest(action); }
    catch (e) { setAsked(false); setError((e as Error).message); }
  };

  const working = asked || status.busy || Boolean(status.pending);
  const last = status.lastResult && status.lastResult.action === action ? status.lastResult : null;

  return (
    <>
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
      {/* An update rebuilds the image for minutes. The agent streams that
          output to its log, so show it rather than a spinner and a promise. */}
      {working && tail.length > 0 && (
        <pre className={styles.log}>{tail.join('\n')}</pre>
      )}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ScenarioTree } from '../api/types';

const EMPTY: ScenarioTree = { folders: [], scenarios: [] };

export interface ScenarioTreeState {
  tree: ScenarioTree;
  loading: boolean;
  error: string | null;
  /** Force an immediate re-read. Mutations already push an update, so this is
   *  only for recovering from an error. */
  reload: () => void;
}

/**
 * Keeps the scenario list in step with the disk, with no refresh button.
 *
 * The server holds ONE poller for the whole process and only runs it while
 * something is subscribed (src/server/scenarioWatch.js), so the cost of being
 * live is a directory walk every few seconds — and only while this list is on
 * screen. Two things close the subscription: unmounting (you opened a
 * scenario) and the tab going to the background, which is what stops a dojo
 * left open in a pinned tab from touching the disk all day.
 *
 * `enabled` is the caller's own gate — the list waits for the health check
 * before claiming the workspace is empty.
 */
export function useScenarioTree(enabled = true): ScenarioTreeState {
  const [tree, setTree] = useState<ScenarioTree>(EMPTY);
  // Starts true: the first paint happens before anything has been read, and an
  // empty list at that point means "not asked yet", not "none".
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [nonce, setNonce] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }

    // Hidden tab: read once so the list is current the moment it is shown
    // again, but hold no stream open.
    if (!visible) {
      let cancelled = false;
      api.scenarioTree()
        .then((t) => { if (!cancelled) { setTree(t); setError(null); } })
        .catch((e: Error) => { if (!cancelled) setError(String(e.message || e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }

    const source = new EventSource(api.scenarioTreeStreamUrl());
    sourceRef.current = source;
    source.addEventListener('tree', (ev) => {
      try {
        setTree(JSON.parse((ev as MessageEvent).data) as ScenarioTree);
        setError(null);
      } catch { /* a malformed frame is not worth blanking the list for */ }
      setLoading(false);
    });
    source.addEventListener('error', (ev) => {
      // EventSource reconnects by itself, so a transient drop must not paint
      // an error over a list that is merely a few seconds stale. Only a named
      // 'error' event from the server (which carries data) is a real failure.
      const data = (ev as MessageEvent).data;
      if (!data) return;
      try { setError(String(JSON.parse(data).error)); } catch { /* ignore */ }
      setLoading(false);
    });
    return () => { source.close(); sourceRef.current = null; };
  }, [enabled, visible, nonce]);

  return { tree, loading, error, reload };
}

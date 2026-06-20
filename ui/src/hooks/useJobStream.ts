import { useEffect, useRef, useState } from 'react';
import type { LiveFrame, JobEvent, StageLayout, TestResult } from '../api/types';
import { api } from '../api/client';

export interface JobStreamState {
  connected: boolean;
  started: boolean;
  scenario: string | null;
  maxTicks: number;
  lastTick: number;
  lastFrame: LiveFrame | null;
  layout: StageLayout | null;
  botUserId: string | null;
  console: string[];
  ended: boolean;
  endReason: string | null;
  recordingPath: string | null;
  test: TestResult | null;
  error: string | null;
}

const INITIAL: JobStreamState = {
  connected: false, started: false, scenario: null, maxTicks: 0,
  lastTick: 0, lastFrame: null, layout: null, botUserId: null, console: [], ended: false,
  endReason: null, recordingPath: null, test: null, error: null
};

// Subscribes to a job's SSE stream. Closes the EventSource on the terminal
// event (end/gone/fatal) so the browser does NOT auto-reconnect to a finished
// job. Live-run frame rate is ~1/tick (~1s), so direct state updates are fine;
// heavy playback animation is a separate concern (replay viewer).
export function useJobStream(jobId: string | null): JobStreamState {
  const [state, setState] = useState<JobStreamState>(INITIAL);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) { setState(INITIAL); return; }
    setState({ ...INITIAL, connected: false });
    const es = new EventSource(api.streamUrl(jobId));
    esRef.current = es;

    const apply = (e: MessageEvent, fn: (s: JobStreamState, ev: JobEvent) => JobStreamState) => {
      let data: JobEvent;
      try { data = JSON.parse(e.data); } catch { return; }
      setState((s) => fn(s, data));
    };
    const close = () => { es.close(); };

    es.onopen = () => setState((s) => ({ ...s, connected: true }));
    es.addEventListener('start', (e) => apply(e as MessageEvent, (s, ev) =>
      ev.type === 'start' ? { ...s, started: true, scenario: ev.scenario, maxTicks: ev.maxTicks, botUserId: ev.botUserId } : s));
    es.addEventListener('terrain', () => { /* superseded by 'layout'; svg embeds terrain */ });
    es.addEventListener('layout', (e) => apply(e as MessageEvent, (s, ev) =>
      ev.type === 'layout' ? { ...s, layout: ev.layout } : s));
    es.addEventListener('tick', (e) => apply(e as MessageEvent, (s, ev) =>
      ev.type === 'tick' ? { ...s, lastTick: ev.tick, maxTicks: ev.maxTicks } : s));
    es.addEventListener('frame', (e) => apply(e as MessageEvent, (s, ev) =>
      ev.type === 'frame' ? { ...s, lastFrame: { gameTime: ev.gameTime, objects: ev.objects, console: ev.console, svg: ev.svg } } : s));
    es.addEventListener('console', (e) => apply(e as MessageEvent, (s, ev) =>
      ev.type === 'console' ? { ...s, console: s.console.concat(ev.lines) } : s));
    es.addEventListener('end', (e) => { apply(e as MessageEvent, (s, ev) =>
      ev.type === 'end' ? { ...s, ended: true, endReason: ev.endReason, lastTick: ev.ticks, recordingPath: ev.recordingPath, test: ev.test, error: (ev as { error?: string }).error || (ev.endReason === 'error' ? 'run failed' : null) } : s); close(); });
    es.addEventListener('fatal', (e) => { apply(e as MessageEvent, (s, ev) =>
      ev.type === 'fatal' ? { ...s, ended: true, error: ev.error } : s); close(); });
    es.addEventListener('gone', () => { setState((s) => ({ ...s, ended: true, error: 'job not found' })); close(); });
    es.onerror = () => { /* EventSource auto-retries; if the job ended we already closed */ };

    return () => { es.close(); esRef.current = null; };
  }, [jobId]);

  return state;
}

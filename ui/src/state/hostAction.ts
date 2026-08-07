import { useSyncExternalStore } from 'react';

// A host action takes the server away underneath the page — recreate and
// restart both stop the container this UI is talking to. That has to be a
// whole-app state, not something a button can own: whichever screen you are on
// needs to say "wait", and stay saying it while every fetch fails.

export interface HostActionState {
  action: string | null;
  id: string | null;
  startedAt: number;
}

let current: HostActionState = { action: null, id: null, startedAt: 0 };
const listeners = new Set<() => void>();

export function startHostAction(action: string, id: string, now = Date.now()): void {
  current = { action, id, startedAt: now };
  listeners.forEach((l) => l());
}

export function clearHostAction(): void {
  current = { action: null, id: null, startedAt: 0 };
  listeners.forEach((l) => l());
}

export function useHostAction(): HostActionState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current
  );
}

// What to say, and what to suggest, when one does not come back. Keyed by
// action so the advice is the command that action would have run.
export const ACTION_TITLE: Record<string, string> = {
  restart: 'Restarting server',
  recreate: 'Restarting server',
  update: 'Updating dojo'
};

// How long before we stop claiming it is still coming. An update pulls,
// rebuilds the image and restarts; a restart is seconds.
export const DEADLINE_MS: Record<string, number> = {
  restart: 90000, recreate: 120000, update: 15 * 60 * 1000
};

export interface PhaseInput {
  action: string;
  id: string | null;
  elapsedMs: number;
  // The server being unreachable is the EXPECTED middle of a restart, not a
  // failure — it only becomes one once the deadline passes.
  unreachable: boolean;
  busy?: boolean;
  // Whether OUR request is still sitting in the channel waiting to be picked up.
  pending?: boolean;
  lastResult?: { id: string; ok: boolean; message: string | null } | null;
}

// How long to allow between a request being written and the agent taking it.
// The agent polls once a second, so this is generous; it exists only so a
// momentarily slow read is not mistaken for a lost request.
export const PICKUP_GRACE_MS = 10000;

export type Phase =
  | { phase: 'working' }
  | { phase: 'done' }
  | { phase: 'failed'; detail: string };

// Pure so the decision that tells someone their update died can be tested
// without a DOM (the UI suite has no jsdom).
export function decidePhase(input: PhaseInput): Phase {
  const deadline = DEADLINE_MS[input.action] || 120000;
  const overdue = input.elapsedMs > deadline;

  if (input.unreachable) {
    return overdue
      ? { phase: 'failed', detail: 'The server has not come back.' }
      : { phase: 'working' };
  }
  // Only OUR result counts: the agent keeps the previous action's result until
  // it finishes this one, and reading that would end the wait far too early.
  const last = input.lastResult;
  if (last && last.id === input.id) {
    return last.ok ? { phase: 'done' } : { phase: 'failed', detail: last.message || 'The action failed.' };
  }
  // Neither queued nor running, and no result of ours: the request was dropped.
  // That happens when the agent looked alive (its heartbeat had not yet aged
  // out) but had actually gone, so it never saw the request and a later one
  // discarded it as stale. Waiting out the full deadline for that is just a
  // long way round to the same answer.
  if (!input.pending && !input.busy && input.elapsedMs > PICKUP_GRACE_MS) {
    return {
      phase: 'failed',
      detail: 'The host agent did not pick this up — it had most likely stopped. Start it again and retry.'
    };
  }
  if (overdue) {
    return {
      phase: 'failed',
      detail: input.busy ? 'Still running after a long time.' : 'The host agent never picked this up.'
    };
  }
  return { phase: 'working' };
}

// Said before the wait starts and again while it runs. An update rebuilds the
// container image, which is minutes of apparently nothing — without a number up
// front, slow is indistinguishable from broken.
export const ACTION_DURATION: Record<string, string> = {
  restart: 'up to a minute',
  recreate: 'a minute or two',
  update: '10-15 minutes'
};

// What to put in front of someone instead of raw build output. The scripts
// already announce their phases ("[dojo-update] step 2 of 3: …"); this picks the
// most recent one out of the log rather than inventing a second source of truth.
//
// Falls back to the agent's own heartbeat line, so a long silence still reads as
// progress rather than as nothing happening.
export function describeProgress(lines: string[], fallback: string): string {
  // agent.log is append-only and shared by every action, so the tail still
  // holds whatever the LAST one printed. Without this the phase line happily
  // reported "what changed: …/releases" from a previous update while a fresh
  // restart was only just beginning. The agent stamps "running: <summary>" when
  // it picks an action up, so that is where this action's output starts.
  let from = 0;
  let summary = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const started = /\s{2}running: (.+)$/.exec(lines[i]);
    if (started) { from = i + 1; summary = started[1].trim(); break; }
  }
  const mine = lines.slice(from);

  for (let i = mine.length - 1; i >= 0; i--) {
    const line = mine[i];
    const marker = line.indexOf('[dojo-update] ');
    if (marker !== -1) {
      const text = line.slice(marker + '[dojo-update] '.length).trim();
      // Indented continuations are asides, not the phase itself.
      if (text && !line.slice(marker).startsWith('[dojo-update]   ')) return text;
    }
    if (line.includes('…still working')) {
      const heartbeat = line.trim().replace(/^…?\s*/, '');
      return (summary ? capitalise(summary) : fallback) + ' — ' + heartbeat;
    }
  }
  // Restart and recreate print no phases of their own, so the agent's own
  // one-line summary of what it is doing beats a generic "Working…".
  return summary ? capitalise(summary) : fallback;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const ACTION_FALLBACK: Record<string, string> = {
  restart: 'docker compose restart ui',
  recreate: 'npm run ui',
  update: 'npm run update'
};

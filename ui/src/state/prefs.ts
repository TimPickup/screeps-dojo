import { useSyncExternalStore } from 'react';

// Tiny localStorage-backed preferences store. Phase 5's Settings overlay edits
// these; Run/Replays read showUserVisuals + defaultReplaySpeed.
export interface Prefs {
  showUserVisuals: boolean;
  defaultReplaySpeed: number;
}

// Playback speeds, shared by the Settings default and the replay control so the
// two can never offer different sets. 128x is the top end the animation loop
// stays smooth at (it advances by dt * speed, so nothing else has to change).
export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128];

const KEY = 'dojo.prefs';
const DEFAULTS: Prefs = { showUserVisuals: true, defaultReplaySpeed: 1 };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULTS;
}

let current = read();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs { return current; }
export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current
  );
}

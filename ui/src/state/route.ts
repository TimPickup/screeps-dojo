import { useSyncExternalStore } from 'react';

// Where you are in the app, held in the URL hash so back, forward and reload
// all work. Hash rather than real paths because the built app is served with
// relative asset URLs (vite base:'./') from whatever directory it happens to
// sit in — a deep real path like /scenario/Benches/rampart would send the
// browser looking for ./assets next to it and find nothing.

export const TABS = ['Run', 'Test', 'Replays', 'Edit'] as const;
export type Tab = typeof TABS[number];

export type Route =
  // `folder` is a folder the list should open and scroll to, so coming back
  // from a scenario lands you where you left rather than at the top.
  | { view: 'list'; folder: string | null }
  | { view: 'scenario'; scenario: string; tab: Tab };

const LIST: Route = { view: 'list', folder: null };

// Scenario paths are 'Folder/sub/name', and each part is encoded separately so
// the slashes stay structural and spaces or '#' in a name survive the trip.
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodePath(segments: string[]): string {
  return segments.map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).join('/');
}

function tabFrom(segment: string): Tab | null {
  return TABS.find((t) => t.toLowerCase() === segment.toLowerCase()) || null;
}

export function parseHash(hash: string): Route {
  const segments = hash.replace(/^#/, '').split('/').filter(Boolean);
  const [kind, ...rest] = segments;
  if (kind === 'folder' && rest.length) return { view: 'list', folder: decodePath(rest) };
  if (kind === 'scenario' && rest.length) {
    // The tab is always written last, so the segments before it are the path.
    // A hand-typed '#/scenario/Benches/rampart' with no tab still opens, on Run
    // — but only when the last segment isn't itself a tab name.
    const tab = rest.length > 1 ? tabFrom(rest[rest.length - 1]) : null;
    const path = tab ? rest.slice(0, -1) : rest;
    if (path.length) return { view: 'scenario', scenario: decodePath(path), tab: tab || 'Run' };
  }
  return LIST;
}

export function formatRoute(route: Route): string {
  if (route.view === 'list') return route.folder ? '#/folder/' + encodePath(route.folder) : '#/';
  return '#/scenario/' + encodePath(route.scenario) + '/' + route.tab.toLowerCase();
}

const hasWindow = typeof window !== 'undefined';

// Parsed once per change and cached: useSyncExternalStore compares snapshots by
// identity, so re-parsing on every read would re-render forever.
let current: Route = hasWindow ? parseHash(window.location.hash) : LIST;
const listeners = new Set<() => void>();

function sync() {
  current = parseHash(window.location.hash);
  listeners.forEach((l) => l());
}

if (hasWindow) window.addEventListener('hashchange', sync);

export function getRoute(): Route { return current; }

// `replace` for a move that shouldn't be a place you can go back to — switching
// tabs within a scenario would otherwise bury the list under a pile of entries.
export function navigate(route: Route, opts?: { replace?: boolean }): void {
  if (!hasWindow) return;
  const next = formatRoute(route);
  if (next === (window.location.hash || '#/')) return;
  if (opts?.replace) {
    // replaceState fires no hashchange, so the store has to be told by hand.
    window.history.replaceState(null, '', next);
    sync();
  } else {
    window.location.hash = next;
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
    () => LIST
  );
}

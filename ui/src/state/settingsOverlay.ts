import { useSyncExternalStore } from 'react';

// The Settings overlay is owned by App, but things deep in the tree need to
// open it — the scenario's own settings form has to offer "register a bot"
// without threading a callback through the workspace and the edit tab. Same
// tiny store shape as state/prefs.ts rather than a second pattern.

export type SettingsSection = 'bots' | 'servers' | null;

let openAt: SettingsSection | 'closed' = 'closed';
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }

// `section` scrolls that part into view once the overlay is up, so a deep link
// lands on the thing the user was asking for rather than the top of the panel.
export function openSettings(section: SettingsSection = null): void {
  openAt = section;
  emit();
}

export function closeSettings(): void {
  openAt = 'closed';
  emit();
}

export function useSettingsOverlay(): { open: boolean; section: SettingsSection } {
  const state = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => openAt
  );
  return { open: state !== 'closed', section: state === 'closed' ? null : state };
}

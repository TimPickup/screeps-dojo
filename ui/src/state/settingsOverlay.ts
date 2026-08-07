import { useSyncExternalStore } from 'react';

// The Settings overlay is owned by App, but things deep in the tree need to
// open it — the scenario's own settings form has to offer "register a bot"
// without threading a callback through the workspace and the edit tab. Same
// tiny store shape as state/prefs.ts rather than a second pattern.

export type SettingsSection = 'bots' | 'servers' | null;

// A host action ends in a page reload, so "was Settings open?" has to outlive
// the document — otherwise applying a mount change from Settings dumps you back
// on the welcome screen with no idea whether it worked.
const RESUME_KEY = 'dojo.settings.resume';

function readResume(): SettingsSection | 'closed' {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (raw === null) return 'closed';
    sessionStorage.removeItem(RESUME_KEY);
    return raw === '' ? null : (raw as SettingsSection);
  } catch { return 'closed'; }
}

let openAt: SettingsSection | 'closed' = readResume();
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

// Called just before a reload: remember the panel so it comes back with fresh
// values rather than the ones it was holding before the server changed.
export function rememberSettingsForReload(): void {
  try {
    if (openAt === 'closed') sessionStorage.removeItem(RESUME_KEY);
    else sessionStorage.setItem(RESUME_KEY, openAt ?? '');
  } catch { /* private mode; the reload still happens */ }
}

export function useSettingsOverlay(): { open: boolean; section: SettingsSection } {
  const state = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => openAt
  );
  return { open: state !== 'closed', section: state === 'closed' ? null : state };
}

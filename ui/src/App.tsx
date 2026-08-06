import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import type { Scenario } from './api/types';
import { ScenarioList } from './components/ScenarioList/ScenarioList';
import { ScenarioWorkspace } from './components/ScenarioWorkspace/ScenarioWorkspace';
import { Settings } from './components/Settings/Settings';
import { openSettings, closeSettings, useSettingsOverlay } from './state/settingsOverlay';
import { HostActionOverlay } from './components/HostActionOverlay/HostActionOverlay';
import { Bootstrap } from './components/Bootstrap/Bootstrap';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import logo from './assets/logo.png';
import styles from './App.module.css';

export function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [startTab, setStartTab] = useState<'Run' | 'Edit'>('Run');
  // Owned by a tiny store rather than local state: the scenario settings form
  // opens this too, and would otherwise need a callback threaded through the
  // workspace and the edit tab to reach it.
  const settings = useSettingsOverlay();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [version, setVersion] = useState<{ current: string; latest: string | null; updateAvailable: boolean; repoUrl: string } | null>(null);

  // Starts true: the very first paint happens before the health check has even
  // resolved, and an empty list at that point means "not asked yet", not "none".
  const [scenariosLoading, setScenariosLoading] = useState(true);
  // Only the newest load may write state, so a slow earlier response cannot
  // overwrite a newer one.
  const latestLoad = useRef(0);

  const refresh = useCallback(() => {
    const id = ++latestLoad.current;
    setScenariosLoading(true);
    return api.scenarios()
      .then((list) => { if (id === latestLoad.current) { setScenarios(list); setError(null); } })
      .catch((e: Error) => { if (id === latestLoad.current) setError(String(e.message || e)); })
      .finally(() => { if (id === latestLoad.current) setScenariosLoading(false); });
  }, []);

  useEffect(() => {
    api.health()
      .then((h) => { setReady(h.ready); if (h.ready) refresh(); else setScenariosLoading(false); })
      .catch(() => { setReady(true); setScenariosLoading(false); });
    api.version().then(setVersion).catch(() => {});
  }, [refresh]);

  if (ready === false) {
    return (
      <div className={styles.app}>
        <header className={styles.header}><span className={styles.brand}><img className={styles.logo} src={logo} alt="" /> Screeps Dojo</span></header>
        <main className={styles.main}><Bootstrap onReady={() => { setReady(true); refresh(); }} /></main>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.brand}><img className={styles.logo} src={logo} alt="" /> Screeps Dojo</span>
        {version && <span className={styles.version} title={version.updateAvailable ? 'Update available: v' + version.latest : 'Up to date'}>v{version.current}{version.updateAvailable ? ' •' : ''}</span>}
        {selected && (
          <button className={styles.back} onClick={() => setSelected(null)} title="Back to scenarios">← {selected}</button>
        )}
        <span className={styles.spacer} />
        <button className={styles.cog} onClick={() => openSettings()} title="Settings">⚙</button>
      </header>

      <main className={styles.main}>
        {error && <div className={styles.error}>{error}</div>}
        <ErrorBoundary key={selected || 'list'}>
          {selected === null ? (
            <ScenarioList
              scenarios={scenarios}
              loading={scenariosLoading}
              version={version}
              onSelect={(name) => { setStartTab('Run'); setSelected(name); }}
              onCreated={(name) => { refresh(); setStartTab('Edit'); setSelected(name); }}
              onRefresh={refresh}
            />
          ) : (
            <ScenarioWorkspace scenario={selected} initialTab={startTab} />
          )}
        </ErrorBoundary>
      </main>

      {settings.open && <Settings section={settings.section} onClose={closeSettings} />}
      {/* Last, and above everything: it covers the Settings panel it is usually
          launched from, because the server both are talking to is going away. */}
      <HostActionOverlay />
    </div>
  );
}

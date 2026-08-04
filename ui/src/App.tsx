import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import type { Scenario } from './api/types';
import { ScenarioList } from './components/ScenarioList/ScenarioList';
import { ScenarioWorkspace } from './components/ScenarioWorkspace/ScenarioWorkspace';
import { Settings } from './components/Settings/Settings';
import { Bootstrap } from './components/Bootstrap/Bootstrap';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import logo from './assets/logo.png';
import styles from './App.module.css';

export function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [startTab, setStartTab] = useState<'Run' | 'Edit'>('Run');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
        <button className={styles.cog} onClick={() => setSettingsOpen(true)} title="Settings">⚙</button>
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

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

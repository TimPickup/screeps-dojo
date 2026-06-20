import { useEffect, useState } from 'react';
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

  const refresh = () => api.scenarios().then(setScenarios).catch((e) => setError(String(e.message || e)));
  useEffect(() => {
    api.health().then((h) => { setReady(h.ready); if (h.ready) refresh(); }).catch(() => setReady(true));
    api.version().then(setVersion).catch(() => {});
  }, []);

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

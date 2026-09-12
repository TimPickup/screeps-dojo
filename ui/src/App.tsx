import { useEffect, useState } from 'react';
import { api } from './api/client';
import { ScenarioList } from './components/ScenarioList/ScenarioList';
import { ScenarioWorkspace } from './components/ScenarioWorkspace/ScenarioWorkspace';
import { Settings } from './components/Settings/Settings';
import { openSettings, closeSettings, useSettingsOverlay } from './state/settingsOverlay';
import { HostActionOverlay } from './components/HostActionOverlay/HostActionOverlay';
import { Bootstrap } from './components/Bootstrap/Bootstrap';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import logo from './assets/logo.png';
import styles from './App.module.css';

// A scenario is identified by its path under scenarios/ ('Benches/rampart'),
// and the header shows that whole path as breadcrumbs: which folders you are
// in, then the scenario. Each folder crumb goes back to the list with that
// folder opened, which is the one thing you always want next.
function crumbsOf(path: string): { label: string; path: string }[] {
  const parts = path.split('/');
  return parts.map((label, i) => ({ label, path: parts.slice(0, i + 1).join('/') }));
}

export function App() {
  const [selected, setSelected] = useState<string | null>(null);
  // A folder the list should open and scroll to when we go back — set by
  // clicking a breadcrumb. Cleared once the list has consumed it.
  const [reveal, setReveal] = useState<string | null>(null);
  const [startTab, setStartTab] = useState<'Run' | 'Edit'>('Run');
  // Owned by a tiny store rather than local state: the scenario settings form
  // opens this too, and would otherwise need a callback threaded through the
  // workspace and the edit tab to reach it.
  const settings = useSettingsOverlay();
  const [ready, setReady] = useState<boolean | null>(null);
  const [version, setVersion] = useState<{ current: string; latest: string | null; updateAvailable: boolean; repoUrl: string } | null>(null);

  useEffect(() => {
    api.health()
      .then((h) => setReady(h.ready))
      .catch(() => setReady(true));
    api.version().then(setVersion).catch(() => {});
  }, []);

  const home = (revealFolder?: string) => {
    setReveal(revealFolder || null);
    setSelected(null);
  };

  // The logo is the way back to the start in every app that has one, so it is
  // a button here too rather than decoration next to the ← that already does it.
  const brand = (
    <button className={styles.brand} onClick={() => home()} title="Back to scenarios">
      <img className={styles.logo} src={logo} alt="" /> Screeps Dojo
    </button>
  );

  if (ready === false) {
    return (
      <div className={styles.app}>
        <header className={styles.header}>{brand}</header>
        <main className={styles.main}><Bootstrap onReady={() => setReady(true)} /></main>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        {brand}
        {version && <span className={styles.version} title={version.updateAvailable ? 'Update available: v' + version.latest : 'Up to date'}>v{version.current}{version.updateAvailable ? ' •' : ''}</span>}
        {selected && (
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <button className={styles.back} onClick={() => home()} title="Back to scenarios">←</button>
            {/* The root is always shown, so a scenario at the top level still
                reads as a trail rather than as a bare name. */}
            <button className={styles.crumb} onClick={() => home()} title="Back to scenarios">Scenarios</button>
            {crumbsOf(selected).map((crumb, i, all) => (
              <span key={crumb.path} className={styles.crumbWrap}>
                <span className={styles.crumbSep} aria-hidden="true">/</span>
                {/* The last crumb is the scenario you are already in, so it is
                    a label; the ones before it are the folders holding it. */}
                {i === all.length - 1 ? (
                  <span className={styles.crumbCurrent} aria-current="page">{crumb.label}</span>
                ) : (
                  <button
                    className={styles.crumb}
                    onClick={() => home(crumb.path)}
                    title={'Back to ' + crumb.path}
                  >{crumb.label}</button>
                )}
              </span>
            ))}
          </nav>
        )}
        <span className={styles.spacer} />
        <button className={styles.cog} onClick={() => openSettings()} title="Settings">⚙</button>
      </header>

      <main className={styles.main}>
        <ErrorBoundary key={selected || 'list'}>
          {selected === null ? (
            <ScenarioList
              enabled={ready === true}
              version={version}
              reveal={reveal}
              onRevealed={() => setReveal(null)}
              onSelect={(path) => { setStartTab('Run'); setSelected(path); }}
              onCreated={(path) => { setStartTab('Edit'); setSelected(path); }}
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

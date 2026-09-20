import { useEffect, useState } from 'react';
import { RunTab } from '../tabs/RunTab/RunTab';
import { TestTab } from '../tabs/TestTab/TestTab';
import { ReplaysTab } from '../tabs/ReplaysTab/ReplaysTab';
import { EditTab } from '../tabs/EditTab/EditTab';
import { TABS } from '../../state/route';
import { guardedNavigate } from '../../state/navigationGuard';
import type { Tab } from '../../state/route';
import styles from './ScenarioWorkspace.module.css';

// Which tab you are on lives in the URL (App owns the route), so a reload or a
// shared link comes back to the same tab.
export function ScenarioWorkspace({ scenario, tab, onTab }: { scenario: string; tab: Tab; onTab: (tab: Tab) => void }) {
  const [openFile, setOpenFile] = useState<string | undefined>(undefined);

  // The cog is a one-shot jump, not a mode: clear the request once EditTab has
  // consumed it (child effects run first) so clicking it again re-opens the
  // file even if the user has since selected another one.
  useEffect(() => { if (openFile) setOpenFile(undefined); }, [openFile]);

  return (
    <div className={styles.workspace}>
      <nav className={styles.tabs}>
        {TABS.map((t) => (
          <button key={t} className={t === tab ? styles.active : styles.tab}
            onClick={() => guardedNavigate(() => onTab(t))}>{t}</button>
        ))}
        <button
          className={styles.cog}
          title="Scenario settings — edit settings.json (bot and server profile overrides for this scenario)"
          onClick={() => guardedNavigate(() => { onTab('Edit'); setOpenFile('settings.json'); })}
        >⚙</button>
      </nav>
      <div className={styles.content}>
        {tab === 'Run' && <RunTab scenario={scenario} />}
        {tab === 'Test' && <TestTab scenario={scenario} />}
        {tab === 'Replays' && <ReplaysTab scenario={scenario} />}
        {tab === 'Edit' && <EditTab scenario={scenario} initialFile={openFile} />}
      </div>
    </div>
  );
}

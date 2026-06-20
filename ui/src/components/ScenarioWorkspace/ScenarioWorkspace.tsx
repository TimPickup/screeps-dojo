import { useState } from 'react';
import { RunTab } from '../tabs/RunTab/RunTab';
import { TestTab } from '../tabs/TestTab/TestTab';
import { ReplaysTab } from '../tabs/ReplaysTab/ReplaysTab';
import { EditTab } from '../tabs/EditTab/EditTab';
import styles from './ScenarioWorkspace.module.css';

const TABS = ['Run', 'Test', 'Replays', 'Edit'] as const;
type Tab = typeof TABS[number];

export function ScenarioWorkspace({ scenario, initialTab }: { scenario: string; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab || 'Run');
  return (
    <div className={styles.workspace}>
      <nav className={styles.tabs}>
        {TABS.map((t) => (
          <button key={t} className={t === tab ? styles.active : styles.tab} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      <div className={styles.content}>
        {tab === 'Run' && <RunTab scenario={scenario} />}
        {tab === 'Test' && <TestTab scenario={scenario} />}
        {tab === 'Replays' && <ReplaysTab scenario={scenario} />}
        {tab === 'Edit' && <EditTab scenario={scenario} />}
      </div>
    </div>
  );
}

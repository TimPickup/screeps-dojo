import { useEffect, useRef, useState } from 'react';
import type { Scenario } from '../../api/types';
import { api } from '../../api/client';
import { useJobStream } from '../../hooks/useJobStream';
import logo from '../../assets/logo.png';
import styles from './ScenarioList.module.css';

interface VersionInfo { current: string; latest: string | null; updateAvailable: boolean; repoUrl: string; }
interface Props {
  scenarios: Scenario[];
  version?: VersionInfo | null;
  onSelect: (name: string) => void;
  onCreated: (name: string) => void;
  onRefresh: () => void;
}

// Landing view: scenario selector on the left, welcome / Test-All on the right.
export function ScenarioList({ scenarios, version, onSelect, onCreated, onRefresh }: Props) {
  const createScenario = async () => {
    const name = (window.prompt('New scenario name (letters, numbers, - or _):') || '').trim();
    if (!name) return;
    try { const r = await api.createScenario(name); onCreated(r.name); }
    catch (e) { window.alert('Could not create scenario: ' + (e as Error).message); }
  };
  const [testAll, setTestAll] = useState<{ running: boolean; results: Record<string, string> }>({ running: false, results: {} });
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const queueRef = useRef<string[]>([]);
  const processedRef = useRef<string | null>(null);
  const stream = useJobStream(activeJob);

  // drive the Test-All queue: when a job ends, record its result and start next
  useEffect(() => {
    if (!activeJob || !stream.ended || processedRef.current === activeJob) return;
    processedRef.current = activeJob;
    const name = stream.scenario || queueRef.current[0] || '';
    const verdict = stream.error ? 'ERROR' : stream.test ? (stream.test.passed ? 'PASS' : 'FAIL') : (stream.endReason || '?');
    setTestAll((t) => ({ ...t, results: { ...t.results, [name]: verdict } }));
    const rest = queueRef.current.slice(1);
    queueRef.current = rest;
    if (rest.length) { api.test(rest[0]).then((r) => setActiveJob(r.jobId)); }
    else { setActiveJob(null); setTestAll((t) => ({ ...t, running: false })); }
  }, [activeJob, stream.ended, stream.scenario, stream.error, stream.test, stream.endReason]);

  const runTestAll = async () => {
    if (!scenarios.length) return;
    const names = scenarios.map((s) => s.name);
    setTestAll({ running: true, results: {} });
    queueRef.current = names;
    processedRef.current = null;
    const r = await api.test(names[0]);
    setActiveJob(r.jobId);
  };

  return (
    <div className={styles.wrap}>
      <aside className={styles.list}>
        <div className={styles.listHead}>
          <span>Scenarios</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <button className={styles.testAll} onClick={createScenario}>+ New</button>
            <button className={styles.testAll} disabled={testAll.running || !scenarios.length} onClick={runTestAll}>▶▶ Test All</button>
          </span>
        </div>
        {scenarios.length === 0 && <div className={styles.empty}>No scenarios. Copy one from <code>examples/</code> into <code>scenarios/</code>.</div>}
        {scenarios.map((s) => (
          <button key={s.name} className={styles.row} onClick={() => onSelect(s.name)}>
            <span className={styles.dot} />
            <span className={styles.name}>{s.name}</span>
            {testAll.results[s.name] && (
              <span className={testAll.results[s.name] === 'PASS' ? styles.pass : styles.fail}>{testAll.results[s.name]}</span>
            )}
          </button>
        ))}
        <button className={styles.refresh} onClick={onRefresh}>↻ refresh</button>
      </aside>
      <section className={styles.welcome}>
        {testAll.running ? (
          <div className={styles.welcomeInner}>
            <h2>Running all scenarios…</h2>
            <p className={styles.dim}>{stream.scenario}: tick {stream.lastTick}/{stream.maxTicks}</p>
            <table className={styles.results}>
              <tbody>
                {Object.entries(testAll.results).map(([n, v]) => (
                  <tr key={n}><td>{n}</td><td className={v === 'PASS' ? styles.pass : styles.fail}>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.welcomeInner}>
            <img className={styles.welcomeLogo} src={logo} alt="Screeps Dojo" />
            <h2>Welcome to the Dojo</h2>
            {version?.updateAvailable && (
              <div className={styles.update}>
                ⬆ A new version (<b>v{version.latest}</b>) is available — you have v{version.current}.{' '}
                <a href={version.repoUrl} target="_blank" rel="noreferrer">View on GitHub →</a>
              </div>
            )}
            <p className={styles.dim}>Pick a scenario on the left to run it live, test it, watch replays, or edit its files.</p>
            <p className={styles.dim}>The CLI still works too: <code>npm test</code>, <code>npm run render</code>.</p>
          </div>
        )}
      </section>
    </div>
  );
}

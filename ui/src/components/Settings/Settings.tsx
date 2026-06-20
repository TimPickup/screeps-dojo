import { useEffect, useState } from 'react';
import { usePrefs, setPrefs } from '../../state/prefs';
import { api } from '../../api/client';
import styles from './Settings.module.css';

const SERVER_FIELDS = ['DOJO_SCREEPS_TOKEN', 'DOJO_SCREEPS_HOSTNAME', 'DOJO_SCREEPS_SHARD', 'DOJO_SCREEPS_PORT', 'DOJO_SCREEPS_PATH', 'DOJO_SCREEPS_PROTOCOL'];

export function Settings({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs();
  const [env, setEnv] = useState<Record<string, string>>({});
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [verify, setVerify] = useState<{ bot?: string; server?: string }>({});
  const [restartNote, setRestartNote] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.getEnv().then((r) => { setEnv(r.values); setOrig(r.values); }).catch(() => {}); }, []);

  const dirty = JSON.stringify(env) !== JSON.stringify(orig);
  const set = (k: string, v: string) => { setEnv((e) => ({ ...e, [k]: v })); setSaved(false); };

  const tryClose = () => {
    if (dirty && !window.confirm('Discard unsaved environment changes?')) return;
    onClose();
  };

  const save = async () => {
    const changed: Record<string, string> = {};
    for (const k of Object.keys(env)) if (env[k] !== orig[k]) changed[k] = env[k];
    const r = await api.putEnv(changed);
    setOrig(env); setSaved(true);
    if (r.restartRequired) setRestartNote(true);
  };

  const doVerifyBot = async () => { const r = await api.verifyBot(); setVerify((v) => ({ ...v, bot: r.ok ? `✓ ${r.jsModuleCount} .js modules` : '✗ ' + (r.error || 'no modules') })); };
  const doVerifyServer = async () => {
    const r = await api.verifyServer();
    setVerify((v) => ({ ...v, server: r.ok ? (r.active ? '✓ token valid, window active' : '✓ token valid (rate-limited)') : '✗ ' + (r.error || 'invalid') }));
  };

  return (
    <div className={styles.overlay} onClick={tryClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span>Settings {dirty && <span className={styles.dirty}>● unsaved</span>}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className={styles.save} disabled={!dirty} onClick={save}>Save</button>
            <button className={styles.close} onClick={tryClose}>✕</button>
          </span>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Preferences</div>
          <label className={styles.row}>
            <input type="checkbox" checked={prefs.showUserVisuals} onChange={(e) => setPrefs({ showUserVisuals: e.target.checked })} />
            Show user visuals (creep say bubbles)
          </label>
          <label className={styles.row}>
            Default replay speed
            <select value={prefs.defaultReplaySpeed} onChange={(e) => setPrefs({ defaultReplaySpeed: Number(e.target.value) })}>
              {[0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Bot</div>
          <div className={styles.field}>
            <span>DOJO_BOT_PATH</span>
            <input value={env.DOJO_BOT_PATH || ''} onChange={(e) => set('DOJO_BOT_PATH', e.target.value)} />
          </div>
          <div className={styles.actions}>
            <button onClick={doVerifyBot}>Verify mount</button>
            <span className={styles.vresult}>{verify.bot}</span>
          </div>
          <div className={styles.warn}>changing the bot path needs a container restart — see note below.</div>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Live server (room import)</div>
          {SERVER_FIELDS.map((k) => (
            <div className={styles.field} key={k}>
              <span>{k.replace('DOJO_SCREEPS_', '')}</span>
              <input value={env[k] || ''} placeholder={k === 'DOJO_SCREEPS_TOKEN' ? '(unchanged)' : ''} onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
          <div className={styles.actions}>
            <button onClick={doVerifyServer}>Verify connection</button>
            <span className={styles.vresult}>{verify.server}</span>
          </div>
        </div>

        {saved && <div className={styles.note}>Saved. Token/server changes apply immediately.</div>}
        {restartNote && <div className={styles.warnBox}>Bot path changed. Re-run <code>npm run ui</code> (or <code>docker compose up -d ui</code>) on the host to re-mount the new path.</div>}
      </div>
    </div>
  );
}

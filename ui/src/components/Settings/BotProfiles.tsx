import { useEffect, useState } from 'react';
import type { BotProfilesResponse } from '../../api/types';
import { api } from '../../api/client';
import {
  listBotProfiles, defaultBotProfileName, botStatusLabel, setBotProfile, renameBotProfile,
  deleteBotProfile, setDefaultBotProfile, migrateLegacy, validateProfileName, normalizeProfileName,
  usesLegacyBotKeys
} from './profileEnv';
import type { EnvPatch } from './profileEnv';
import styles from './Settings.module.css';

interface Props {
  values: Record<string, string>;
  onPatch: (patch: EnvPatch) => void;
  // Bumped by Settings after a save, so mount status is re-probed exactly when
  // it can have changed rather than on every keystroke.
  refreshKey: number;
}

// Registered bot codebases. Each is bind-mounted read-only at /bots/<name>, and
// because a bind mount is fixed when the container is created, only a PATH
// change needs `npm run ui` — picking a different default is free. That
// distinction is why status lives per row instead of in one blanket warning.
export function BotProfiles({ values, onPatch, refreshKey }: Props) {
  const [remote, setRemote] = useState<BotProfilesResponse | null>(null);
  const [verified, setVerified] = useState<Record<string, string>>({});
  const [addName, setAddName] = useState('');
  const [addPath, setAddPath] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => { api.bots().then(setRemote).catch(() => setRemote(null)); }, [refreshKey]);

  const rows = listBotProfiles(values);
  const chosenDefault = defaultBotProfileName(values);
  const statusFor = (name: string) => remote?.profiles.find((p) => p.name === name);

  const add = () => {
    const name = normalizeProfileName(addName);
    const error = validateProfileName(name, rows.map((r) => r.name));
    if (error) { setAddError(error); return; }
    onPatch(setBotProfile(values, name, addPath.trim()));
    setAddName(''); setAddPath(''); setAddError(null);
  };

  const rename = (from: string) => {
    const typed = window.prompt('Rename bot profile "' + from + '" to:', from);
    if (typed === null) return;
    const to = normalizeProfileName(typed);
    if (to === from) return;
    const error = validateProfileName(to, rows.map((r) => r.name));
    if (error) { window.alert(error); return; }
    onPatch(renameBotProfile(values, from, to));
  };

  const remove = (name: string) => {
    // Scenarios pin a bot by name, so a delete can break a scenario elsewhere.
    if (!window.confirm('Remove bot profile "' + name + '"? Scenarios that name it will stop running.')) return;
    onPatch(deleteBotProfile(values, name));
    setVerified((v) => { const next = { ...v }; delete next[name]; return next; });
  };

  const verify = async (name: string) => {
    setVerified((v) => ({ ...v, [name]: '…' }));
    const r = await api.verifyBot(name);
    setVerified((v) => ({
      ...v,
      [name]: r.ok ? '✓ ' + r.jsModuleCount + ' .js at ' + r.mount : '✗ ' + (r.error || 'no modules')
    }));
  };

  // Scoped to the bot key: the server settings have their own banner, and a
  // host path is never a secret, so nothing here can need re-entering.
  const convert = () => onPatch(migrateLegacy(values, 'bot'));

  return (
    <div className={styles.section}>
      <div className={styles.label}>Bot profiles</div>

      {/* The local env is fresher than /api/bots, so the banner clears the
          moment the conversion is applied rather than after the next save. */}
      {usesLegacyBotKeys(values) && (
        <div className={styles.legacyBox}>
          <div><code>DOJO_BOT_PATH</code> is the old single-path form. Converting it makes it the profile named <code>default</code>, which changes nothing about what runs.</div>
          <button className={styles.linkBtn} onClick={convert}>Convert to profiles</button>
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.colDefault} title="Which profile runs when a scenario does not name one">Default</th>
            <th>Name</th>
            <th>Host path</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = statusFor(row.name);
            const label = botStatusLabel(status, row.hostPath);
            return (
              <tr key={row.name}>
                <td className={styles.colDefault}>
                  <input
                    type="radio"
                    name="defaultBotProfile"
                    checked={chosenDefault === row.name}
                    onChange={() => onPatch(setDefaultBotProfile(values, row.name))}
                  />
                </td>
                <td className={styles.pname}>
                  {row.name}
                  {row.legacy && <span className={styles.tag} title="declared with the legacy DOJO_BOT_PATH">legacy</span>}
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    value={row.hostPath}
                    placeholder="C:/path/to/your/screeps/scripts"
                    onChange={(e) => onPatch(setBotProfile(values, row.name, e.target.value))}
                  />
                </td>
                <td className={label.tone === 'ok' ? styles.ok : styles.warnText}>
                  {label.text}
                  {verified[row.name] && <div className={styles.vresult}>{verified[row.name]}</div>}
                </td>
                <td className={styles.rowActions}>
                  {/* Verify reads the mount, so it answers for what is saved in
                      .env — not for an edit still sitting in this panel. */}
                  <button onClick={() => verify(row.name)} disabled={!status?.mounted}>Verify</button>
                  <button onClick={() => rename(row.name)}>Rename</button>
                  <button className={styles.danger} onClick={() => remove(row.name)}>Remove</button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={5} className={styles.empty}>No bot profiles yet — add the folder holding your flat <code>.js</code> modules.</td></tr>
          )}
        </tbody>
      </table>

      <div className={styles.addRow}>
        <input className={styles.addName} value={addName} placeholder="name" onChange={(e) => { setAddName(e.target.value); setAddError(null); }} />
        <input className={styles.cellInput} value={addPath} placeholder="host path" onChange={(e) => setAddPath(e.target.value)} />
        <button onClick={add}>+ Add profile</button>
      </div>
      {addError && <div className={styles.err}>{addError}</div>}
      <div className={styles.hint}>A new or changed host path becomes a mount only when the container is recreated: save, then run <code>npm run ui</code> once. Choosing a different default takes effect immediately.</div>
    </div>
  );
}

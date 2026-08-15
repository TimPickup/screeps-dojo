import { useEffect, useState } from 'react';
import type { ScreepsProfile, ScreepsProfilesResponse } from '../../api/types';
import { api } from '../../api/client';
import {
  listScreepsProfiles, defaultScreepsProfileName, screepsOwnValue,
  setScreepsProfile, deleteScreepsProfile, setDefaultScreepsProfile,
  validateProfileName, normalizeProfileName
} from './profileEnv';
import type { EnvPatch, ScreepsKey } from './profileEnv';
import styles from './Settings.module.css';

interface Props {
  values: Record<string, string>;
  onPatch: (patch: EnvPatch) => void;
  refreshKey: number;
  // Renaming edits the saved file directly, so it cannot run over the top of
  // unsaved edits; the panel tells us whether there are any.
  dirty: boolean;
  onExternalChange: () => void;
}

// Where the server is. These apply whichever way you authenticate. Labelled in
// words rather than as env keys: the field IS the setting, and mixing
// SHOUTED_KEYS with "Token" read like two different forms.
const CONNECTION_KEYS: ScreepsKey[] = ['HOSTNAME', 'PORT', 'PROTOCOL', 'PATH', 'SHARD'];

const FIELD_LABEL: Partial<Record<ScreepsKey, string>> = {
  HOSTNAME: 'Hostname', PORT: 'Port', PROTOCOL: 'Protocol', PATH: 'Path',
  SHARD: 'Shard', USERNAME: 'Username', EMAIL: 'Email', TOKEN: 'Token', PASSWORD: 'Password'
};

// A new profile is pointed at the public server, because a profile with no keys
// at all does not exist as far as the runner is concerned — you would add one,
// press Verify, and be told it was not registered.
const NEW_PROFILE_DEFAULTS: Partial<Record<ScreepsKey, string>> = {
  HOSTNAME: 'screeps.com', PORT: '443', PROTOCOL: 'https', PATH: '/', SHARD: 'shard0'
};

// Screeps connection settings for the room importer. Every profile STANDS
// ALONE — nothing is inherited from another profile, so what a row shows is
// what it will connect with.
export function ServerProfiles({ values, onPatch, refreshKey, dirty, onExternalChange }: Props) {
  const [remote, setRemote] = useState<ScreepsProfilesResponse | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, string>>({});
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => { api.servers().then(setRemote).catch(() => setRemote(null)); }, [refreshKey]);

  const rows = listScreepsProfiles(values);
  const chosenDefault = defaultScreepsProfileName(values);
  const savedFor = (name: string) => remote?.profiles.find((p) => p.name === name);
  const names = rows.map((r) => r.name);

  const add = () => {
    const name = normalizeProfileName(addName);
    const error = validateProfileName(name, names);
    if (error) { setAddError(error); return; }
    onPatch(setScreepsProfile(values, name, NEW_PROFILE_DEFAULTS));
    setAddName(''); setAddError(null); setOpen(name);
  };

  const rename = async (from: string) => {
    if (dirty) {
      window.alert('Save your changes first — renaming edits the saved file directly, so it cannot run over the top of unsaved edits.');
      return;
    }
    const typed = window.prompt('Rename server profile "' + from + '" to:', from);
    if (typed === null) return;
    const to = normalizeProfileName(typed);
    if (to === from) return;
    const error = validateProfileName(to, names);
    if (error) { window.alert(error); return; }
    try {
      // Server-side, so the token comes with it.
      await api.renameProfile('screeps', from, to);
      if (open === from) setOpen(to);
      onExternalChange();
    } catch (e) {
      window.alert('Rename failed: ' + (e as Error).message);
    }
  };

  const remove = (name: string) => {
    if (!window.confirm('Remove server profile "' + name + '"? Scenarios that name it will stop importing.')) return;
    onPatch(deleteScreepsProfile(values, name));
    if (open === name) setOpen(null);
  };

  const verify = async (name: string) => {
    if (dirty) { setVerified((v) => ({ ...v, [name]: '⚠ save first — this checks the saved settings' })); return; }
    setVerified((v) => ({ ...v, [name]: '…' }));
    const r = await api.verifyServer(name);
    setVerified((v) => ({
      ...v,
      [name]: r.ok
        ? (r.authMode === 'password' ? '✓ login valid (password)' : (r.active ? '✓ token valid, window active' : '✓ token valid (rate-limited)'))
        : '✗ ' + (r.error || 'invalid')
    }));
  };

  const editKey = (name: string, key: ScreepsKey, value: string) => {
    onPatch(setScreepsProfile(values, name, { [key]: value } as Partial<Record<ScreepsKey, string>>));
  };

  const commitSecret = (name: string, key: ScreepsKey) => {
    const draft = secretDraft[name + '.' + key];
    if (draft === undefined) return;
    setSecretDraft((d) => { const next = { ...d }; delete next[name + '.' + key]; return next; });
    if (!draft) return;   // blank means "leave it alone" — Clear is the way to wipe one
    editKey(name, key, draft);
  };

  const secretField = (name: string, key: ScreepsKey, label: string) => {
    const draftKey = name + '.' + key;
    const isSet = Boolean(screepsOwnValue(values, name, key));
    return (
      <label className={styles.field} key={key}>
        <span>{label}</span>
        {/* The mask is never shown as if it were the value: blank means
            unchanged, Clear means wipe. */}
        <input
          type="password"
          value={secretDraft[draftKey] ?? ''}
          placeholder={isSet ? 'set — leave blank to keep' : 'not set'}
          onChange={(e) => setSecretDraft((d) => ({ ...d, [draftKey]: e.target.value }))}
          onBlur={() => commitSecret(name, key)}
        />
        {isSet && <button className={styles.clear} onClick={() => editKey(name, key, '')}>Clear</button>}
      </label>
    );
  };

  const plainField = (name: string, key: ScreepsKey) => (
    <label className={styles.field} key={key}>
      <span>{FIELD_LABEL[key] || key}</span>
      <input value={screepsOwnValue(values, name, key) ?? ''} onChange={(e) => editKey(name, key, e.target.value)} />
    </label>
  );

  return (
    <div className={styles.section}>
      <div className={styles.label}>Screeps server profiles</div>

      <table className={styles.table}>
        {/* Fixed widths: without them the expanded panel's inputs widen their
            column and shove the row buttons off to the right as it opens. */}
        {/* The actions column is sized in px because its contents are four
            fixed-width buttons; hostname takes whatever is left. */}
        <colgroup>
          <col style={{ width: '52px' }} />
          <col style={{ width: '110px' }} />
          <col />
          <col style={{ width: '90px' }} />
          <col style={{ width: '76px' }} />
          <col style={{ width: '272px' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={styles.colDefault} title="Which profile is used when a scenario does not name one">Default</th>
            <th>Name</th>
            <th>Hostname</th>
            <th>Shard</th>
            <th>Auth</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open === row.name;
            const toggle = () => setOpen(expanded ? null : row.name);
            return [
              <tr key={row.name}>
                <td className={styles.colDefault}>
                  <input
                    type="radio"
                    name="defaultScreepsProfile"
                    checked={chosenDefault === row.name}
                    onChange={() => onPatch(setDefaultScreepsProfile(values, row.name))}
                  />
                </td>
                <td className={styles.pname}>
                  <button className={styles.expand} onClick={toggle}>{expanded ? '▾' : '▸'}</button>
                  {row.name}
                  {row.legacy && <span className={styles.tag} title="declared with the legacy DOJO_SCREEPS_* keys">legacy</span>}
                </td>
                <td>{row.own.HOSTNAME || 'screeps.com'}</td>
                <td>{row.own.SHARD || 'shard0'}</td>
                <td>{authLabel(row.own)}</td>
                <td className={styles.rowActions}>
                  {/* The arrow alone was not an obvious way in, so the same
                      action gets a word as well. */}
                  <button onClick={toggle}>{expanded ? 'Close' : 'Edit'}</button>
                  <button onClick={() => verify(row.name)}>Verify</button>
                  <button onClick={() => rename(row.name)}>Rename</button>
                  <button className={styles.danger} onClick={() => remove(row.name)}>Remove</button>
                </td>
              </tr>,
              verified[row.name] ? (
                <tr key={row.name + ':verify'}><td /><td colSpan={5} className={styles.vresult}>{verified[row.name]}</td></tr>
              ) : null,
              expanded ? (
                <tr key={row.name + ':keys'}>
                  <td />
                  <td colSpan={5} className={styles.expandCell}>
                    <div className={styles.subLabel}>Where the server is</div>
                    <div className={styles.keyGrid}>{CONNECTION_KEYS.map((key) => plainField(row.name, key))}</div>
                    <div className={styles.hint}>
                      Defaults are <code>screeps.com</code> / <code>443</code> / <code>https</code> / <code>/</code>.
                      A private server is usually <code>localhost</code> / <code>21025</code> / <code>http</code>.
                      Nothing is inherited from another profile.
                    </div>

                    <div className={styles.subLabel}>How to sign in — one or the other</div>
                    <div className={styles.keyGrid}>
                      {secretField(row.name, 'TOKEN', FIELD_LABEL.TOKEN as string)}
                      <div />
                      {plainField(row.name, 'USERNAME')}
                      {secretField(row.name, 'PASSWORD', FIELD_LABEL.PASSWORD as string)}
                    </div>
                    <div className={styles.hint}>
                      Use a <b>token</b> for screeps.com. Use <b>username + password</b> only for a private
                      server whose token is accepted over REST but rejected by the WebSocket (e.g.
                      screepsmod-auth). Setting both just wastes one. Either way the address fields above
                      still apply. Server settings take effect immediately — no restart.
                    </div>
                  </td>
                </tr>
              ) : null
            ];
          })}
          {rows.length === 0 && (
            <tr><td colSpan={6} className={styles.empty}>No server profiles yet — add one to import rooms from a live server.</td></tr>
          )}
        </tbody>
      </table>

      <div className={styles.addRow}>
        <input className={styles.addName} value={addName} placeholder="name (e.g. season)" onChange={(e) => { setAddName(e.target.value); setAddError(null); }} />
        <button onClick={add}>+ Add profile</button>
      </div>
      {addError && <div className={styles.err}>{addError}</div>}
      <div className={styles.hint}>A new profile starts pointed at screeps.com — give it a token, then Save and Verify.</div>
    </div>
  );
}

// Only ever "is one set" — the browser is never sent the secret itself.
function authLabel(own: Partial<Record<ScreepsKey, string>>): string {
  const token = Boolean(own.TOKEN);
  const password = Boolean(own.PASSWORD);
  if (token && password) return '⚠ both';
  if (token) return '✓ token';
  if (password) return '✓ password';
  return '⚠ none';
}

// Kept as a named export so the type stays exercised where profiles are listed.
export type { ScreepsProfile };

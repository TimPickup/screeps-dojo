import { useEffect, useState } from 'react';
import type { ScreepsProfile, ScreepsProfilesResponse } from '../../api/types';
import { api } from '../../api/client';
import {
  SCREEPS_KEYS, listScreepsProfiles, defaultScreepsProfileName, screepsOwnValue, isSecretKey,
  setScreepsProfile, renameScreepsProfile, deleteScreepsProfile, setDefaultScreepsProfile,
  migrateLegacy, validateProfileName, normalizeProfileName, usesLegacyScreepsKeys
} from './profileEnv';
import type { EnvPatch, ScreepsKey } from './profileEnv';
import styles from './Settings.module.css';

interface Props {
  values: Record<string, string>;
  onPatch: (patch: EnvPatch) => void;
  refreshKey: number;
}

// Screeps connection settings for the room importer. Every profile OVERLAYS the
// one named "default", so a profile that only changes the shard owns exactly one
// key — the expanded row shows an inherited value as a placeholder so it is
// obvious which keys the profile is actually claiming.
export function ServerProfiles({ values, onPatch, refreshKey }: Props) {
  const [remote, setRemote] = useState<ScreepsProfilesResponse | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, string>>({});
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [reentry, setReentry] = useState<string[]>([]);

  useEffect(() => { api.servers().then(setRemote).catch(() => setRemote(null)); }, [refreshKey]);

  const rows = listScreepsProfiles(values);
  const chosenDefault = defaultScreepsProfileName(values);
  const mergedFor = (name: string) => remote?.profiles.find((p) => p.name === name);
  const names = rows.map((r) => r.name);

  const add = () => {
    const name = normalizeProfileName(addName);
    const error = validateProfileName(name, names);
    if (error) { setAddError(error); return; }
    // A profile has to own at least one key to exist at all; SHARD is the key
    // most overlays are created for, and an empty one still declares the row.
    onPatch(setScreepsProfile(values, name, { SHARD: '' }));
    setAddName(''); setAddError(null); setOpen(name);
  };

  const rename = (from: string) => {
    const typed = window.prompt('Rename server profile "' + from + '" to:', from);
    if (typed === null) return;
    const to = normalizeProfileName(typed);
    if (to === from) return;
    const error = validateProfileName(to, names);
    if (error) { window.alert(error); return; }
    const patch = renameScreepsProfile(values, from, to);
    // The browser only ever held a mask of these, so the rename cannot carry
    // them — say so before it happens rather than after.
    if (patch.needsReentry.length && !window.confirm(
      'Renaming loses ' + patch.needsReentry.map(shortKey).join(', ') + ' — the browser never sees the real value. Re-enter it afterwards?'
    )) return;
    onPatch(patch);
    setReentry(patch.needsReentry);
    if (open === from) setOpen(to);
  };

  const remove = (name: string) => {
    if (!window.confirm('Remove server profile "' + name + '"? Scenarios that name it will stop importing.')) return;
    onPatch(deleteScreepsProfile(values, name));
    if (open === name) setOpen(null);
  };

  const verify = async (name: string) => {
    setVerified((v) => ({ ...v, [name]: '…' }));
    const r = await api.verifyServer(name);
    setVerified((v) => ({
      ...v,
      [name]: r.ok ? (r.active ? '✓ token valid, window active' : '✓ token valid (rate-limited)') : '✗ ' + (r.error || 'invalid')
    }));
  };

  const convert = () => {
    const patch = migrateLegacy(values, 'screeps');
    onPatch(patch);
    setReentry(patch.needsReentry);
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

  return (
    <div className={styles.section}>
      <div className={styles.label}>Screeps server profiles</div>

      {usesLegacyScreepsKeys(values) && (
        <div className={styles.legacyBox}>
          <div>The unsuffixed <code>DOJO_SCREEPS_*</code> keys are the old form. Converting them makes them the profile named <code>default</code>, which every other profile overlays.</div>
          <button className={styles.linkBtn} onClick={convert}>Convert to profiles</button>
        </div>
      )}
      {reentry.length > 0 && (
        <div className={styles.err}>
          {reentry.map(shortKey).join(' and ')} could not be moved — the browser only ever receives a masked copy. Re-enter {reentry.length > 1 ? 'them' : 'it'} on the <code>default</code> row, then convert again.
        </div>
      )}

      <table className={styles.table}>
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
            const merged = mergedFor(row.name);
            const expanded = open === row.name;
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
                  <button className={styles.expand} onClick={() => setOpen(expanded ? null : row.name)}>{expanded ? '▾' : '▸'}</button>
                  {row.name}
                  {row.legacy && <span className={styles.tag} title="declared with the legacy DOJO_SCREEPS_* keys">legacy</span>}
                </td>
                {/* Merged values, so a one-key overlay still shows where it
                    would actually connect; italics mark what it inherits. */}
                <td className={row.own.HOSTNAME ? undefined : styles.inherited}>{merged?.hostname || '—'}</td>
                <td className={row.own.SHARD ? undefined : styles.inherited}>{merged?.shard || '—'}</td>
                <td>{authLabel(merged)}</td>
                <td className={styles.rowActions}>
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
                  <td colSpan={5} className={styles.keyGrid}>
                    {SCREEPS_KEYS.map((key) => {
                      const own = screepsOwnValue(values, row.name, key);
                      const inherited = row.name === 'default' ? '' : inheritedHint(key, mergedFor('default'));
                      if (isSecretKey(key)) {
                        const draftKey = row.name + '.' + key;
                        const isSet = Boolean(own);
                        return (
                          <label className={styles.field} key={key}>
                            <span>{key}</span>
                            {/* The mask is never shown as if it were the value:
                                blank means unchanged, Clear means wipe. */}
                            <input
                              type="password"
                              value={secretDraft[draftKey] ?? ''}
                              placeholder={isSet ? 'set — leave blank to keep' : (inherited ? 'inherited' : 'not set')}
                              onChange={(e) => setSecretDraft((d) => ({ ...d, [draftKey]: e.target.value }))}
                              onBlur={() => commitSecret(row.name, key)}
                            />
                            {isSet && <button className={styles.clear} onClick={() => editKey(row.name, key, '')}>Clear</button>}
                          </label>
                        );
                      }
                      return (
                        <label className={styles.field} key={key}>
                          <span>{key}</span>
                          <input
                            value={own ?? ''}
                            placeholder={inherited ? 'inherited: ' + inherited : ''}
                            onChange={(e) => editKey(row.name, key, e.target.value)}
                          />
                        </label>
                      );
                    })}
                    <div className={styles.hint}>Leave a field empty to inherit it from the <code>default</code> profile. Server settings apply immediately — no restart.</div>
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
    </div>
  );
}

function shortKey(envKey: string): string {
  const tail = envKey.split('_').pop() || envKey;
  return tail;
}

// Only ever "is one set" — /api/servers never carries the secret itself.
function authLabel(merged: ScreepsProfile | undefined): string {
  if (!merged) return '—';
  if (merged.hasToken) return '✓ token';
  if (merged.hasPassword) return '✓ password';
  return '⚠ none';
}

// What the profile would fall back to for this key, shown as a placeholder so an
// overlay reads as "inherits screeps.com" rather than as an empty field.
function inheritedHint(key: ScreepsKey, fallback: ScreepsProfile | undefined): string {
  if (!fallback) return '';
  if (key === 'HOSTNAME') return fallback.hostname;
  if (key === 'SHARD') return fallback.shard;
  if (key === 'PORT') return fallback.port;
  if (key === 'PROTOCOL') return fallback.protocol;
  if (key === 'PATH') return fallback.path;
  if (key === 'TOKEN') return fallback.hasToken ? 'set' : '';
  if (key === 'PASSWORD') return fallback.hasPassword ? 'set' : '';
  return '';
}

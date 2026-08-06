import { useEffect, useRef, useState } from 'react';
import { usePrefs, setPrefs, REPLAY_SPEEDS } from '../../state/prefs';
import type { SettingsSection } from '../../state/settingsOverlay';
import { api } from '../../api/client';
import { BotProfiles } from './BotProfiles';
import { ServerProfiles } from './ServerProfiles';
import { HostAgentAction } from './HostAgentAction';
import type { EnvPatch } from './profileEnv';
import { botKeysChanged } from './profileEnv';
import { useHostAction } from '../../state/hostAction';
import styles from './Settings.module.css';

export function Settings({ onClose, section }: { onClose: () => void; section?: SettingsSection }) {
  const prefs = usePrefs();
  const [env, setEnv] = useState<Record<string, string>>({});
  const [orig, setOrig] = useState<Record<string, string>>({});
  // Keys to DELETE on save. Blanking them instead would leave a nameless profile
  // in the list, since a bare KEY= still declares one.
  const [removed, setRemoved] = useState<string[]>([]);
  const [restartNote, setRestartNote] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const botsRef = useRef<HTMLDivElement>(null);
  const serversRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.getEnv().then((r) => { setEnv(r.values); setOrig(r.values); }).catch(() => {}); }, []);

  // Opened from a deep link ("Add or edit bots…"), land on the section that was
  // asked for rather than the top of a panel the user then has to scan.
  useEffect(() => {
    const target = section === 'bots' ? botsRef.current : section === 'servers' ? serversRef.current : null;
    if (target) target.scrollIntoView({ block: 'start' });
  }, [section]);

  const dirty = JSON.stringify(env) !== JSON.stringify(orig) || removed.length > 0;
  // Only mount-relevant edits should arm the Apply button; a server-profile
  // change cannot need a container recreate.
  const botDirty = botKeysChanged(orig, env) || removed.some((k) => k.startsWith('DOJO_BOT'));

  // A host action changes what is mounted, so re-probe when one finishes rather
  // than leaving the button lit against a status read before the recreate.
  const hostAction = useHostAction();
  const hostActionRef = useRef<string | null>(null);
  useEffect(() => {
    if (hostAction.action) { hostActionRef.current = hostAction.action; return; }
    if (!hostActionRef.current) return;
    hostActionRef.current = null;
    setRefreshKey((k) => k + 1);
  }, [hostAction.action]);

  // The profile editors are pure renderers: they hand back an env patch and this
  // is the only place that decides what the panel is holding.
  // After the server itself changes .env (a rename), the panel has to re-read
  // rather than keep its own copy, which no longer matches the file.
  const reload = () => {
    api.getEnv().then((r) => { setEnv(r.values); setOrig(r.values); setRemoved([]); }).catch(() => {});
    setRefreshKey((k) => k + 1);
  };

  const applyPatch = (patch: EnvPatch) => {
    setEnv((e) => {
      const next = { ...e, ...patch.values };
      for (const k of patch.remove) delete next[k];
      return next;
    });
    // A key written again after being removed must not still be queued for
    // deletion — the removal would win on the server and undo the edit.
    setRemoved((r) => {
      const next = r.filter((k) => !(k in patch.values));
      for (const k of patch.remove) if (next.indexOf(k) === -1) next.push(k);
      return next;
    });
    setSaved(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); }
      if (e.key === 'Escape') tryClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tryClose = () => {
    if (dirty && !window.confirm('Discard unsaved environment changes?')) return;
    onClose();
  };

  const save = async () => {
    const changed: Record<string, string> = {};
    for (const k of Object.keys(env)) if (env[k] !== orig[k]) changed[k] = env[k];
    const r = await api.putEnv(changed, removed);
    setRemoved([]);
    setSaved(true);
    // Re-read rather than trusting what was sent: the server masks secrets, and
    // a mask is what the inputs must show back.
    const fresh = await api.getEnv().catch(() => ({ values: env, secrets: [] }));
    setEnv(fresh.values); setOrig(fresh.values);
    setRestartNote(r.restartRequired);
    setRefreshKey((k) => k + 1);
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
              {REPLAY_SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
        </div>

        <div ref={botsRef}>
          <BotProfiles values={env} onPatch={applyPatch} refreshKey={refreshKey} dirty={dirty} botDirty={botDirty} onExternalChange={reload} />
        </div>
        <div ref={serversRef}>
          <ServerProfiles values={env} onPatch={applyPatch} refreshKey={refreshKey} dirty={dirty} onExternalChange={reload} />
        </div>

        {saved && <div className={styles.note}>Saved. Default and server changes apply immediately.</div>}
        {/* Only a MOUNT change needs the container recreated, and the server
            tells us when that happened — re-pointing the default is free, and
            warning about it every time would train people to ignore this. */}
        {restartNote && (
          <div className={styles.warnBox}>
            A bot profile's host path changed — it is not mounted until the container is re-created.
            <HostAgentAction action="recreate" label="Apply now" fallback="npm run ui" />
          </div>
        )}
      </div>
    </div>
  );
}

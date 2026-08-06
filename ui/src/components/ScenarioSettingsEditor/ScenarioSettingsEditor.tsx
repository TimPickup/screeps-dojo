import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { openSettings } from '../../state/settingsOverlay';
import type { BotProfile, ScreepsProfile } from '../../api/types';
import {
  canonicalName, optionsFor, parseDoc, serializeDoc, validateForm,
  type SettingsForm,
} from './settingsDoc';
import styles from './ScenarioSettingsEditor.module.css';

interface Props {
  scenario: string;
  value: string;
  onChange: (next: string) => void;
}

interface Registry {
  bots: BotProfile[];
  botDefault: string;
  servers: ScreepsProfile[];
  serverDefault: string;
}

function names(profiles: Array<{ name: string }>): string[] {
  return profiles.map((profile) => profile.name);
}

const BOT_SNIPPET = `const { allBotModules } = require('../../src/botModules');

module.exports = {
  modules: allBotModules(),
  ...
};`;

const SIDE_SNIPPET = `const { allBotModules, botDir } = require('../../src/botModules');

world.addEnemyBot({ modules: allBotModules(null, botDir('enemy')) });`;

export function ScenarioSettingsEditor({ scenario, value, onChange }: Props) {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Edits live here, not in the serialized text: serializeDoc drops a row whose
  // side name is still empty, so a round-trip through the file would delete the
  // row the moment someone added it.
  const [draft, setDraft] = useState<SettingsForm | null>(null);
  const emittedRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.bots(), api.servers()])
      .then(([bots, servers]) => {
        if (!live) return;
        setRegistry({ bots: bots.profiles, botDefault: bots.default, servers: servers.profiles, serverDefault: servers.default });
      })
      .catch((e) => { if (live) setRegistryError((e as Error).message); });
    return () => { live = false; };
  }, []);

  // Warnings describe the file as the server last read it, so they are fetched
  // per scenario and go stale (harmlessly) once the form starts editing.
  useEffect(() => {
    let live = true;
    api.scenarioSettings(scenario).then((r) => { if (live) setWarnings(r.warnings || []); }).catch(() => {});
    return () => { live = false; };
  }, [scenario]);

  useEffect(() => {
    if (value === emittedRef.current) return;
    setDraft(parseDoc(value).form);
  }, [value]);

  const parsed = parseDoc(value);
  const form = parsed.error ? null : (draft || parsed.form);

  const update = (next: SettingsForm) => {
    setDraft(next);
    const text = serializeDoc(next, parsed.extras);
    emittedRef.current = text;
    onChange(text);
  };

  if (!form) {
    return (
      <div className={styles.wrap}>
        <div className={styles.parseError}>settings.json cannot be shown as a form: {parsed.error}</div>
        <div className={styles.warn}>Switch to the JSON view to repair it — your text is untouched.</div>
      </div>
    );
  }

  // An unreachable registry leaves the lists empty, which optionsFor turns into
  // "only what the file already says" — the stored names stay visible and
  // selected instead of the form blanking them.
  const botNames = registry ? names(registry.bots) : [];
  const serverNames = registry ? names(registry.servers) : [];
  const problems = validateForm(form, botNames, serverNames);

  const setSides = (sides: SettingsForm['sides']) => update({ ...form, sides });
  const editSide = (index: number, patch: Partial<SettingsForm['sides'][number]>) =>
    setSides(form.sides.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const inheritLabel = (fallback: string) => (fallback ? '(inherit: ' + fallback + ')' : '(inherit)');
  // The stored name is shown in the registry's spelling: a <select> matches its
  // options by exact string, so a hand-written "Speedrun" would otherwise show
  // as nothing selected even though the runner accepts it.
  const picker = (stored: string, known: string[], emptyLabel: string, bad: boolean, onPick: (next: string) => void) => {
    const selected = canonicalName(known, stored);
    return (
      <select className={bad ? styles.badSelect : styles.select} value={selected} onChange={(e) => onPick(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {optionsFor(known, selected).map((name) => (
          <option key={name} value={name}>{known.includes(name) ? name : name + ' — not registered'}</option>
        ))}
      </select>
    );
  };

  const registerLink = (
    <div className={styles.hint}>
      Only registered codebases can be chosen here.{' '}
      <button className={styles.link} onClick={() => openSettings('bots')}>Add or edit bots…</button>
    </div>
  );

  const botNote = (name: string) => {
    const profile = registry?.bots.find((b) => b.name.toLowerCase() === name.trim().toLowerCase());
    if (!profile) return null;
    // Registered in .env but never bind-mounted: the container only picks up a
    // mount when it is (re)created, so the fix is a host-side command.
    if (!profile.mounted) {
      return <div className={styles.warn}>{profile.name} is registered but not mounted — apply it from Settings, then this scenario can use it.</div>;
    }
    if (profile.error) return <div className={styles.bad}>{profile.name}: {profile.error}</div>;
    return null;
  };

  return (
    <div className={styles.wrap}>
      {registryError && (
        <div className={styles.warn}>Could not load the profile lists ({registryError}) — showing what the file already says.</div>
      )}
      {warnings.map((w, i) => <div key={i} className={styles.warn}>⚠ {w}</div>)}

      <div className={styles.section}>
        <div className={styles.label}>My bot</div>
        <div className={styles.field}>
          <span>main</span>
          {picker(form.bot, botNames, inheritLabel(registry?.botDefault || ''), Boolean(problems.bot), (bot) => update({ ...form, bot }))}
        </div>
        {problems.bot && <div className={styles.bad}>{problems.bot}</div>}
        {botNote(form.bot || registry?.botDefault || '')}
        {/* Which codebase this is only matters if the scenario actually pulls it
            in, and that is one line most people copy rather than remember. */}
        <div className={styles.hint}>
          The codebase this scenario&rsquo;s own bot runs. It is what{' '}
          <code>allBotModules()</code> returns:
          <pre className={styles.code}>{BOT_SNIPPET}</pre>
        </div>
        {registerLink}
      </div>

      <div className={styles.section}>
        <div className={styles.label}>Other bots</div>
        {form.sides.length === 0 && <div className={styles.hint}>No other bots &mdash; only this scenario&rsquo;s own bot runs.</div>}
        {form.sides.map((row, index) => (
          <div key={index}>
            <div className={styles.field}>
              <input
                className={problems.sides[index].side ? styles.badInput : styles.input}
                value={row.side}
                placeholder="side name"
                onChange={(e) => editSide(index, { side: e.target.value })}
              />
              {picker(row.profile, botNames, '(choose a bot)', Boolean(problems.sides[index].profile), (profile) => editSide(index, { profile }))}
              <button className={styles.remove} title="Remove this side" onClick={() => setSides(form.sides.filter((_, i) => i !== index))}>✕</button>
            </div>
            {problems.sides[index].side && <div className={styles.bad}>{problems.sides[index].side}</div>}
            {problems.sides[index].profile && <div className={styles.bad}>{problems.sides[index].profile}</div>}
            {botNote(row.profile)}
          </div>
        ))}
        <button className={styles.add} onClick={() => setSides(form.sides.concat([{ side: '', profile: '' }]))}>+ Add another bot</button>
        {form.sides.length > 0 && (
          <div className={styles.hint}>
            Give each one a name, then load it in <code>setup()</code>:
            <pre className={styles.code}>{SIDE_SNIPPET}</pre>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.label}>Import server profile</div>
        <div className={styles.field}>
          <span>server</span>
          {picker(form.server, serverNames, inheritLabel(registry?.serverDefault || ''), Boolean(problems.server), (server) => update({ ...form, server }))}
        </div>
        {problems.server && <div className={styles.bad}>{problems.server}</div>}
        <div className={styles.hint}>
          Which live server <b>Import a room</b> pulls from for this scenario.{' '}
          <button className={styles.link} onClick={() => openSettings('servers')}>Manage servers…</button>
        </div>
      </div>
    </div>
  );
}

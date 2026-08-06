import { describe, it, expect } from 'vitest';
import type { BotProfile } from '../../../api/types';
import {
  botProfileKey, screepsProfileKey, screepsLegacyKey, parseBotKey, parseScreepsKey,
  listBotProfiles, listScreepsProfiles, screepsOwnValue,
  setBotProfile, deleteBotProfile, setDefaultBotProfile, defaultBotProfileName,
  setScreepsProfile, deleteScreepsProfile, setDefaultScreepsProfile, defaultScreepsProfileName,
  validateProfileName, isMasked, botStatusLabel, botKeysChanged
} from '../profileEnv';

// Applying a patch the way Settings does, so the tests can assert on the
// resulting env rather than on the patch shape alone.
function apply(values: Record<string, string>, patch: { values: Record<string, string>; remove: string[] }) {
  const next = { ...values, ...patch.values };
  for (const k of patch.remove) delete next[k];
  return next;
}

describe('key naming', () => {
  it('builds the uppercase env key for a profile', () => {
    expect(botProfileKey('main')).toBe('DOJO_BOT_PROFILE_MAIN_PATH');
    expect(botProfileKey('My_Bot')).toBe('DOJO_BOT_PROFILE_MY_BOT_PATH');
    expect(screepsProfileKey('season', 'SHARD')).toBe('DOJO_SCREEPS_PROFILE_SEASON_SHARD');
    expect(screepsLegacyKey('TOKEN')).toBe('DOJO_SCREEPS_TOKEN');
  });

  // The key is matched at the END of the variable name, which is the only reason
  // a profile name is allowed to contain underscores.
  it('parses a profile name that contains underscores', () => {
    expect(parseBotKey('DOJO_BOT_PROFILE_MY_BOT_PATH')).toEqual({ name: 'my_bot' });
    expect(parseScreepsKey('DOJO_SCREEPS_PROFILE_MY_SEASON_SHARD')).toEqual({ name: 'my_season', key: 'SHARD' });
  });

  it('rejects anything that is not a profile key', () => {
    expect(parseBotKey('DOJO_BOT_PATH')).toBeNull();
    expect(parseBotKey('DOJO_BOT_PROFILE_PATH')).toBeNull();     // no name left over
    expect(parseScreepsKey('DOJO_SCREEPS_TOKEN')).toBeNull();
    expect(parseScreepsKey('DOJO_SCREEPS_PROFILE_MAIN_NOPE')).toBeNull();
  });

  // PASSWORD ends in ...WORD, not in any other key, but the guard matters the
  // other way round: a shorter key must never win over the longer one.
  it('does not let a shorter key shadow a longer one', () => {
    expect(parseScreepsKey('DOJO_SCREEPS_PROFILE_MAIN_PASSWORD')).toEqual({ name: 'main', key: 'PASSWORD' });
    expect(parseScreepsKey('DOJO_SCREEPS_PROFILE_MAIN_HOSTNAME')).toEqual({ name: 'main', key: 'HOSTNAME' });
  });
});

describe('listBotProfiles', () => {
  it('lists profiles with the default first, then alphabetically', () => {
    const values = {
      DOJO_BOT_PROFILE_SPEEDRUN_PATH: 'C:/speedrun',
      DOJO_BOT_PROFILE_DEFAULT_PATH: 'C:/default',
      DOJO_BOT_PROFILE_ALT_PATH: 'C:/alt',
      DOJO_DEFAULT_BOT_PROFILE: 'speedrun'
    };
    expect(listBotProfiles(values).map((p) => p.name)).toEqual(['speedrun', 'alt', 'default']);
  });

  it('maps the legacy path onto the profile named default', () => {
    const rows = listBotProfiles({ DOJO_BOT_PATH: 'C:/legacy' });
    expect(rows).toEqual([{ name: 'default', hostPath: 'C:/legacy', legacy: true }]);
  });

  // A profile-form key outranks its legacy twin on the server, so the row has to
  // show the value that would actually be used.
  it('lets the profile key win over the legacy one', () => {
    const rows = listBotProfiles({ DOJO_BOT_PATH: 'C:/legacy', DOJO_BOT_PROFILE_DEFAULT_PATH: 'C:/new' });
    expect(rows).toEqual([{ name: 'default', hostPath: 'C:/new', legacy: false }]);
  });

  // Otherwise the row vanishes the moment the user selects the path to retype it.
  it('keeps a row whose path has been blanked mid-edit', () => {
    expect(listBotProfiles({ DOJO_BOT_PROFILE_MAIN_PATH: '' }).map((p) => p.name)).toEqual(['main']);
  });

  it('ignores names that could never be a mount directory', () => {
    expect(listBotProfiles({ 'DOJO_BOT_PROFILE__MAIN_PATH': 'C:/x' })).toEqual([]);
  });
});

describe('bot profile edits', () => {
  it('writes the host path for a profile', () => {
    const patch = setBotProfile({}, 'main', 'C:/bots/main');
    expect(patch.values).toEqual({ DOJO_BOT_PROFILE_MAIN_PATH: 'C:/bots/main' });
    expect(patch.remove).toEqual([]);
  });

  // Two variables for one setting, with the profile silently winning, is worse
  // than migrating the row as it is edited.
  it('takes the legacy key with it when a legacy row is edited', () => {
    const values = { DOJO_BOT_PATH: 'C:/legacy' };
    const patch = setBotProfile(values, 'default', 'C:/new');
    expect(patch.values).toEqual({ DOJO_BOT_PROFILE_DEFAULT_PATH: 'C:/new' });
    expect(patch.remove).toEqual(['DOJO_BOT_PATH']);
    expect(apply(values, patch)).toEqual({ DOJO_BOT_PROFILE_DEFAULT_PATH: 'C:/new' });
  });


  // Renaming the profile that was the implicit default has to leave a pointer
  // behind, or the rename would quietly switch which codebase runs.



  it('deletes a profile', () => {
    const values = { DOJO_BOT_PROFILE_MAIN_PATH: 'C:/main', DOJO_BOT_PROFILE_ALT_PATH: 'C:/alt' };
    expect(apply(values, deleteBotProfile(values, 'alt'))).toEqual({ DOJO_BOT_PROFILE_MAIN_PATH: 'C:/main' });
  });

  it('deletes both forms of the default profile', () => {
    const values = { DOJO_BOT_PATH: 'C:/legacy', DOJO_BOT_PROFILE_DEFAULT_PATH: 'C:/new' };
    expect(apply(values, deleteBotProfile(values, 'default'))).toEqual({});
  });

  // A pointer at a deleted profile is a hard error on the next run — resolveDir
  // never silently falls back to another codebase.
  it('clears the default pointer when the profile it names is deleted', () => {
    const values = { DOJO_BOT_PROFILE_ALT_PATH: 'C:/alt', DOJO_DEFAULT_BOT_PROFILE: 'alt' };
    expect(apply(values, deleteBotProfile(values, 'alt'))).toEqual({});
  });

  it('leaves the default pointer alone when another profile is deleted', () => {
    const values = {
      DOJO_BOT_PROFILE_ALT_PATH: 'C:/alt', DOJO_BOT_PROFILE_MAIN_PATH: 'C:/main', DOJO_DEFAULT_BOT_PROFILE: 'main'
    };
    expect(apply(values, deleteBotProfile(values, 'alt')))
      .toEqual({ DOJO_BOT_PROFILE_MAIN_PATH: 'C:/main', DOJO_DEFAULT_BOT_PROFILE: 'main' });
  });

  it('points the default at another profile', () => {
    expect(setDefaultBotProfile({}, 'speedrun').values).toEqual({ DOJO_DEFAULT_BOT_PROFILE: 'speedrun' });
  });

  // An absent pointer already means "default", so writing it would only add a
  // line to .env that restates the fallback.
  it('removes the pointer rather than writing "default" into it', () => {
    const values = { DOJO_DEFAULT_BOT_PROFILE: 'speedrun' };
    const patch = setDefaultBotProfile(values, 'default');
    expect(patch.values).toEqual({});
    expect(patch.remove).toEqual(['DOJO_DEFAULT_BOT_PROFILE']);
    expect(defaultBotProfileName(apply(values, patch))).toBe('default');
  });
});

describe('listScreepsProfiles', () => {
  it('collects the keys each profile owns, default first', () => {
    const values = {
      DOJO_SCREEPS_PROFILE_DEFAULT_HOSTNAME: 'screeps.com',
      DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN: '••••abcd',
      DOJO_SCREEPS_PROFILE_SEASON_SHARD: 'season'
    };
    expect(listScreepsProfiles(values)).toEqual([
      { name: 'default', own: { HOSTNAME: 'screeps.com', TOKEN: '••••abcd' }, legacy: false },
      { name: 'season', own: { SHARD: 'season' }, legacy: false }
    ]);
  });

  it('maps the legacy keys onto the default profile and marks it legacy', () => {
    const rows = listScreepsProfiles({ DOJO_SCREEPS_SHARD: 'shard3', DOJO_SCREEPS_TOKEN: '••••abcd' });
    expect(rows).toEqual([{ name: 'default', own: { SHARD: 'shard3', TOKEN: '••••abcd' }, legacy: true }]);
  });

  it('lets a profile key override its legacy twin', () => {
    const rows = listScreepsProfiles({ DOJO_SCREEPS_SHARD: 'shard0', DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard3' });
    expect(rows[0].own.SHARD).toBe('shard3');
  });

  it('sorts the chosen default to the top', () => {
    const values = {
      DOJO_SCREEPS_PROFILE_DEFAULT_HOSTNAME: 'screeps.com',
      DOJO_SCREEPS_PROFILE_SEASON_SHARD: 'season',
      DOJO_SCREEPS_PROFILE_LOCAL_PORT: '21025',
      DOJO_DEFAULT_SCREEPS_PROFILE: 'season'
    };
    expect(listScreepsProfiles(values).map((p) => p.name)).toEqual(['season', 'default', 'local']);
  });
});

describe('screepsOwnValue', () => {
  it('returns only what the profile states for itself', () => {
    const values = { DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard0', DOJO_SCREEPS_PROFILE_SEASON_SHARD: 'season' };
    expect(screepsOwnValue(values, 'season', 'SHARD')).toBe('season');
    expect(screepsOwnValue(values, 'season', 'HOSTNAME')).toBeUndefined();
  });

  it('reads the default profile out of the legacy keys too', () => {
    expect(screepsOwnValue({ DOJO_SCREEPS_SHARD: 'shard3' }, 'default', 'SHARD')).toBe('shard3');
    expect(screepsOwnValue({ DOJO_SCREEPS_SHARD: 'shard3' }, 'season', 'SHARD')).toBeUndefined();
  });
});

describe('screeps profile edits', () => {
  it('writes several keys at once', () => {
    const patch = setScreepsProfile({}, 'local', { HOSTNAME: 'localhost', PORT: '21025', PROTOCOL: 'http' });
    expect(patch.values).toEqual({
      DOJO_SCREEPS_PROFILE_LOCAL_HOSTNAME: 'localhost',
      DOJO_SCREEPS_PROFILE_LOCAL_PORT: '21025',
      DOJO_SCREEPS_PROFILE_LOCAL_PROTOCOL: 'http'
    });
  });

  // The browser only ever sees a mask, so sending one back would overwrite the
  // real secret with bullet characters.
  it('never writes a masked secret back', () => {
    const patch = setScreepsProfile({}, 'default', { TOKEN: '••••abcd', SHARD: 'shard3' });
    expect(patch.values).toEqual({ DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard3' });
  });

  // Blanking a key un-owns it: the server skips empty variables, so the profile
  // goes back to inheriting the value from "default".
  it('keeps an empty value, which reads as "inherit"', () => {
    expect(setScreepsProfile({}, 'season', { SHARD: '' }).values)
      .toEqual({ DOJO_SCREEPS_PROFILE_SEASON_SHARD: '' });
  });

  it('takes the legacy twin with it when a legacy key is edited', () => {
    const values = { DOJO_SCREEPS_SHARD: 'shard0' };
    expect(apply(values, setScreepsProfile(values, 'default', { SHARD: 'shard3' })))
      .toEqual({ DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard3' });
  });


  // Leaving the old key behind would resurrect the old profile, so the masked
  // secret is dropped — and the caller is told exactly what to retype.


  it('deletes every key a profile owns', () => {
    const values = {
      DOJO_SCREEPS_PROFILE_LOCAL_HOSTNAME: 'localhost',
      DOJO_SCREEPS_PROFILE_LOCAL_PORT: '21025',
      DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard0'
    };
    expect(apply(values, deleteScreepsProfile(values, 'local'))).toEqual({ DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard0' });
  });

  it('deletes the legacy keys along with the default profile', () => {
    const values = { DOJO_SCREEPS_TOKEN: '••••abcd', DOJO_SCREEPS_SHARD: 'shard0', DOJO_UI_PORT: '8787' };
    expect(apply(values, deleteScreepsProfile(values, 'default'))).toEqual({ DOJO_UI_PORT: '8787' });
  });

  it('clears the default pointer when the profile it names is deleted', () => {
    const values = { DOJO_SCREEPS_PROFILE_SEASON_SHARD: 'season', DOJO_DEFAULT_SCREEPS_PROFILE: 'season' };
    expect(apply(values, deleteScreepsProfile(values, 'season'))).toEqual({});
  });

  it('points the default at another profile, and drops the pointer for "default"', () => {
    expect(setDefaultScreepsProfile({}, 'season').values).toEqual({ DOJO_DEFAULT_SCREEPS_PROFILE: 'season' });
    const values = { DOJO_DEFAULT_SCREEPS_PROFILE: 'season' };
    expect(apply(values, setDefaultScreepsProfile(values, 'default'))).toEqual({});
  });
});

describe('validateProfileName', () => {
  it('accepts a usable name', () => {
    expect(validateProfileName('main', [])).toBeNull();
    expect(validateProfileName('my_bot2', ['other'])).toBeNull();
    expect(validateProfileName('  Main  ', [])).toBeNull();   // normalised before checking
  });

  it('rejects an empty name', () => {
    expect(validateProfileName('', [])).toMatch(/Name a profile/);
    expect(validateProfileName('   ', [])).toMatch(/Name a profile/);
  });

  // The name becomes a directory under /bots AND part of an env key, so
  // anything outside the regex is unusable as one or the other.
  it('rejects characters that cannot be a mount directory', () => {
    expect(validateProfileName('my bot', [])).toMatch(/lowercase letters/);
    // A hyphen is the trap: it looks fine and produces DOJO_..._MY-BOT_PATH,
    // a line .env's parser skips entirely, silently losing the value.
    expect(validateProfileName('my-bot', [])).toMatch(/No hyphen/);
    expect(validateProfileName('_main', [])).toMatch(/lowercase letters/);
    expect(validateProfileName('main/../etc', [])).toMatch(/lowercase letters/);
  });

  it('rejects a duplicate, however it was typed', () => {
    expect(validateProfileName('main', ['main'])).toMatch(/already exists/);
    expect(validateProfileName('MAIN', ['main'])).toMatch(/already exists/);
  });
});

describe('isMasked', () => {
  it('spots the mask /api/env sends in place of a secret', () => {
    expect(isMasked('••••abcd')).toBe(true);
    expect(isMasked('••••')).toBe(true);
    expect(isMasked('real-token')).toBe(false);
    expect(isMasked('')).toBe(false);
    expect(isMasked(undefined)).toBe(false);
  });
});

describe('botStatusLabel', () => {
  const status = (over: Partial<BotProfile> = {}): BotProfile => ({
    name: 'main', hostPath: 'C:/bots/main', legacy: false, dir: '/bots/main',
    mounted: true, jsModuleCount: 37, error: null, ...over
  });

  it('confirms a live mount with its module count', () => {
    expect(botStatusLabel(status(), 'C:/bots/main')).toEqual({ text: '✓ mounted · 37 .js', tone: 'ok' });
  });

  it('warns about a mount that holds no modules', () => {
    expect(botStatusLabel(status({ jsModuleCount: 0, error: 'mounted but holds no .js modules' }), 'C:/bots/main'))
      .toEqual({ text: '⚠ mounted but holds no .js modules', tone: 'warn' });
  });

  // A bind mount is fixed when the container is created, so a registered profile
  // is not usable until the container is recreated, which the Apply button
  // right below the table asks the host agent to do.
  it('points at Apply when the profile is registered but not mounted', () => {
    const label = botStatusLabel(status({ mounted: false, jsModuleCount: 0, error: 'not mounted — run npm run ui' }), 'C:/bots/main');
    expect(label).toEqual({ text: '⚠ registered — not mounted yet, Apply below', tone: 'warn' });
  });

  it('shows a real filesystem error instead of the generic line', () => {
    expect(botStatusLabel(status({ mounted: false, jsModuleCount: 0, error: 'EACCES: permission denied' }), 'C:/bots/main').text)
      .toBe('⚠ EACCES: permission denied');
  });

  // The mount carries the path it was created with, so an edited path is not
  // live yet however healthy the existing mount looks.
  it('flags a path that has been changed since the mount was made', () => {
    expect(botStatusLabel(status(), 'C:/bots/other'))
      .toEqual({ text: '⚠ path changed — Save, then Apply below', tone: 'warn' });
  });

  it('flags a row the server has never seen', () => {
    expect(botStatusLabel(undefined, 'C:/bots/new').tone).toBe('warn');
    expect(botStatusLabel(undefined, 'C:/bots/new').text).toMatch(/not registered yet/);
  });
});

describe('botKeysChanged', () => {
  // Why the Apply button exists at all: only a MOUNT needs a container
  // recreate. Arming it for anything else taught people it meant nothing.
  it('sees a bot path edit', () => {
    expect(botKeysChanged({ DOJO_BOT_PROFILE_MAIN_PATH: 'C:/a' }, { DOJO_BOT_PROFILE_MAIN_PATH: 'C:/b' })).toBe(true);
    expect(botKeysChanged({}, { DOJO_BOT_PROFILE_NEW_PATH: 'C:/n' })).toBe(true);
    expect(botKeysChanged({ DOJO_BOT_PATH: 'C:/legacy' }, {})).toBe(true);
  });

  it('ignores everything a mount does not depend on', () => {
    expect(botKeysChanged(
      { DOJO_DEFAULT_SCREEPS_PROFILE: 'shard0', DOJO_SCREEPS_PROFILE_SHARD0_TOKEN: 'a' },
      { DOJO_DEFAULT_SCREEPS_PROFILE: 'season', DOJO_SCREEPS_PROFILE_SHARD0_TOKEN: 'b' }
    )).toBe(false);
    // which bot is the default is a name lookup, not a mount
    expect(botKeysChanged({ DOJO_DEFAULT_BOT_PROFILE: 'main' }, { DOJO_DEFAULT_BOT_PROFILE: 'alt' })).toBe(false);
  });

  it('sees nothing in an untouched env', () => {
    const values = { DOJO_BOT_PROFILE_MAIN_PATH: 'C:/a', DOJO_UI_PORT: '8787' };
    expect(botKeysChanged(values, { ...values })).toBe(false);
  });
});

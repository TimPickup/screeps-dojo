import { describe, it, expect } from 'vitest';
import {
  canonicalName, emptyForm, hasProblems, optionsFor, parseDoc, serializeDoc, toggleMod, validateForm,
  type SettingsForm,
} from '../settingsDoc';

function reparse(form: SettingsForm, extras: Record<string, unknown> = {}) {
  return parseDoc(serializeDoc(form, extras));
}

describe('parseDoc', () => {
  it('treats an absent or blank file as inherit-everything', () => {
    for (const text of ['', '   \n\t', '{}']) {
      const parsed = parseDoc(text);
      expect(parsed.error).toBeNull();
      expect(parsed.form).toEqual(emptyForm());
      expect(parsed.extras).toEqual({});
    }
  });

  it('folds the bot shorthand and bots.main into one field', () => {
    expect(parseDoc('{"bot":"speedrun"}').form).toEqual({ bot: 'speedrun', sides: [], server: '', mods: [] });
    expect(parseDoc('{"bots":{"main":"speedrun"}}').form).toEqual({ bot: 'speedrun', sides: [], server: '', mods: [] });
  });

  it('reads sides and the server profile', () => {
    const parsed = parseDoc('{"bot":"speedrun","bots":{"enemy":"default","ally":"speedrun"},"server":"season"}');
    expect(parsed.error).toBeNull();
    expect(parsed.form).toEqual({
      bot: 'speedrun',
      sides: [{ side: 'enemy', profile: 'default' }, { side: 'ally', profile: 'speedrun' }],
      server: 'season', mods: [],
    });
  });

  // src/scenarioSettings.js validate() throws here, so the form must refuse the
  // document rather than pick a winner behind the user's back.
  it('rejects declaring both bot and bots.main', () => {
    const parsed = parseDoc('{"bot":"speedrun","bots":{"main":"default"}}');
    expect(parsed.form).toBeNull();
    expect(parsed.error).toBe('declare either "bot" or "bots.main", not both');
  });

  it('reports invalid JSON without pretending to have a form', () => {
    const parsed = parseDoc('{"bot": ');
    expect(parsed.form).toBeNull();
    expect(parsed.error).toMatch(/^invalid JSON — /);
  });

  it('rejects shapes the runner would reject', () => {
    expect(parseDoc('[]').error).toBe('expected a JSON object');
    expect(parseDoc('"speedrun"').error).toBe('expected a JSON object');
    expect(parseDoc('null').error).toBe('expected a JSON object');
    expect(parseDoc('{"bots":[]}').error).toBe('"bots" must be an object of side -> profile name');
    expect(parseDoc('{"bots":{"enemy":""}}').error).toBe('"bots.enemy" must be a non-empty profile name');
    expect(parseDoc('{"bots":{"enemy":3}}').error).toBe('"bots.enemy" must be a non-empty profile name');
    expect(parseDoc('{"bot":""}').error).toBe('"bot" must be a non-empty profile name');
    expect(parseDoc('{"server":false}').error).toBe('"server" must be a non-empty profile name');
  });

  // A malformed side name is fixable in the form, so it parses and is left to
  // validateForm — unlike a structural error, which hides the form entirely.
  it('accepts a side name the runner would refuse so the form can show it', () => {
    const parsed = parseDoc('{"bots":{"Enemy Two":"default"}}');
    expect(parsed.error).toBeNull();
    expect(parsed.form?.sides).toEqual([{ side: 'Enemy Two', profile: 'default' }]);
  });

  it('reads the mod list, lowercased and deduplicated', () => {
    expect(parseDoc('{"mods":["season5"]}').form?.mods).toEqual(['season5']);
    expect(parseDoc('{"mods":["Season5"," SEASON5 "]}').form?.mods).toEqual(['season5']);
    expect(parseDoc('{"mods":[]}').form?.mods).toEqual([]);
  });

  // The runner refuses to start on an unknown mod, so the form has to keep it
  // on screen — dropping it silently would leave a file nobody could repair
  // from the form that wrote it.
  it('keeps an unavailable mod in the form so it can be removed', () => {
    const parsed = parseDoc('{"mods":["season4"]}');
    expect(parsed.error).toBeNull();
    expect(parsed.form?.mods).toEqual(['season4']);
  });

  it('rejects mod shapes the runner would reject', () => {
    expect(parseDoc('{"mods":"season5"}').error).toBe('"mods" must be an array of mod IDs');
    expect(parseDoc('{"mods":[""]}').error).toBe('"mods" entries must be non-empty mod IDs');
    expect(parseDoc('{"mods":[5]}').error).toBe('"mods" entries must be non-empty mod IDs');
  });

  it('collects unknown top-level keys as extras', () => {
    const parsed = parseDoc('{"bot":"speedrun","note":"why this scenario differs","ticks":10}');
    expect(parsed.extras).toEqual({ note: 'why this scenario differs', ticks: 10 });
    expect(parsed.form).toEqual({ bot: 'speedrun', sides: [], server: '', mods: [] });
  });
});

describe('serializeDoc', () => {
  it('matches the runner: tab indent, trailing newline, bot shorthand', () => {
    const text = serializeDoc({ bot: 'speedrun', sides: [{ side: 'enemy', profile: 'default' }], server: 'season', mods: [] });
    expect(text).toBe('{\n\t"bot": "speedrun",\n\t"bots": {\n\t\t"enemy": "default"\n\t},\n\t"server": "season"\n}\n');
  });

  it('omits every empty key rather than writing blanks', () => {
    expect(serializeDoc(emptyForm())).toBe('{}\n');
    expect(serializeDoc({ bot: '  ', sides: [], server: '', mods: [] })).toBe('{}\n');
    expect(serializeDoc({ bot: '', sides: [], server: 'season', mods: [] })).toBe('{\n\t"server": "season"\n}\n');
  });

  it('skips half-typed rows and a main row so the file stays loadable', () => {
    const form: SettingsForm = {
      bot: 'speedrun',
      sides: [{ side: '', profile: 'default' }, { side: 'enemy', profile: '' }, { side: 'main', profile: 'default' }],
      server: '', mods: [],
    };
    expect(serializeDoc(form)).toBe('{\n\t"bot": "speedrun"\n}\n');
  });

  it('preserves unknown keys through a round-trip', () => {
    const source = '{"bot":"speedrun","note":"keep me","server":"season"}';
    const parsed = parseDoc(source);
    const written = serializeDoc(parsed.form as SettingsForm, parsed.extras);
    expect(written).toBe('{\n\t"bot": "speedrun",\n\t"server": "season",\n\t"note": "keep me"\n}\n');
    expect(parseDoc(written).extras).toEqual({ note: 'keep me' });
  });

  it('is stable: writing what was read changes nothing the second time', () => {
    const sources = [
      '',
      '{}',
      '{"bot":"speedrun"}',
      '{ "bots": { "main": "speedrun", "enemy": "default" }, "server": "season" }',
      '{"note":{"nested":true},"bot":"speedrun"}',
    ];
    for (const source of sources) {
      const first = parseDoc(source);
      const once = serializeDoc(first.form as SettingsForm, first.extras);
      const second = parseDoc(once);
      expect(second.error).toBeNull();
      expect(serializeDoc(second.form as SettingsForm, second.extras)).toBe(once);
    }
  });

  it('writes the mod list, and omits it once the last mod is unticked', () => {
    expect(serializeDoc({ ...emptyForm(), mods: ['season5'] }))
      .toBe('{\n\t"mods": [\n\t\t"season5"\n\t]\n}\n');
    expect(serializeDoc({ ...emptyForm(), mods: [] })).toBe('{}\n');
  });

  it('round-trips a modded scenario unchanged', () => {
    const source = '{"bot":"speedrun","mods":["season5"]}';
    const first = parseDoc(source);
    const once = serializeDoc(first.form as SettingsForm, first.extras);
    const second = parseDoc(once);
    expect(second.form?.mods).toEqual(['season5']);
    expect(serializeDoc(second.form as SettingsForm, second.extras)).toBe(once);
  });

  it('moves bots.main into the shorthand it read', () => {
    const parsed = reparse(parseDoc('{"bots":{"main":"speedrun","enemy":"default"}}').form as SettingsForm);
    expect(parsed.form).toEqual({ bot: 'speedrun', sides: [{ side: 'enemy', profile: 'default' }], server: '', mods: [] });
  });
});

describe('validateForm', () => {
  const bots = ['default', 'speedrun'];
  const servers = ['default', 'season'];

  it('passes a form built from registered names', () => {
    const problems = validateForm({ bot: 'speedrun', sides: [{ side: 'enemy', profile: 'default' }], server: 'season', mods: [] }, bots, servers);
    expect(hasProblems(problems)).toBe(false);
  });

  it('flags names that are not registered, on the right field', () => {
    const problems = validateForm({ bot: 'ghost', sides: [{ side: 'enemy', profile: 'phantom' }], server: 'nowhere', mods: [] }, bots, servers);
    expect(problems.bot).toBe('"ghost" is not a registered bot profile');
    expect(problems.server).toBe('"nowhere" is not a registered server profile');
    expect(problems.sides[0].profile).toBe('"phantom" is not a registered bot profile');
    expect(problems.sides[0].side).toBeNull();
  });

  it('accepts any casing, since the runner lowercases what it reads', () => {
    const problems = validateForm({ bot: 'SpeedRun', sides: [], server: 'SEASON', mods: [] }, bots, servers);
    expect(hasProblems(problems)).toBe(false);
  });

  it('says nothing about names when the registry never loaded', () => {
    const problems = validateForm({ bot: 'ghost', sides: [], server: 'nowhere', mods: [] }, [], []);
    expect(problems.bot).toBeNull();
    expect(problems.server).toBeNull();
  });

  it('flags duplicate side names on every offending row', () => {
    const problems = validateForm({
      bot: '',
      sides: [{ side: 'enemy', profile: 'default' }, { side: 'Enemy', profile: 'default' }, { side: 'ally', profile: 'default' }],
      server: '', mods: [],
    }, bots, servers);
    expect(problems.sides[0].side).toBe('duplicate side "enemy"');
    expect(problems.sides[1].side).toBe('invalid side name "Enemy" — lowercase letters, digits, _ and - only');
    expect(problems.sides[2].side).toBeNull();
  });

  it('sends the main side back to the Bot field', () => {
    const problems = validateForm({ bot: '', sides: [{ side: 'main', profile: 'default' }], server: '', mods: [] }, bots, servers);
    expect(problems.sides[0].side).toBe('the main side belongs in the Bot field');
  });

  it('flags a row that is still half-typed', () => {
    const problems = validateForm({ bot: '', sides: [{ side: '', profile: '' }], server: '', mods: [] }, bots, servers);
    expect(problems.sides[0].side).toBe('side name is required');
    expect(problems.sides[0].profile).toBe('choose a bot profile');
  });

  it('flags a mod the catalog does not offer', () => {
    const problems = validateForm({ ...emptyForm(), mods: ['season4'] }, bots, servers, ['season5']);
    expect(problems.mods).toBe('"season4" is not an available mod — the run will refuse to start');
    expect(hasProblems(problems)).toBe(true);
  });

  it('says nothing about mods when the catalog never loaded', () => {
    expect(validateForm({ ...emptyForm(), mods: ['season4'] }, bots, servers, []).mods).toBeNull();
  });

  it('accepts an available mod', () => {
    const problems = validateForm({ ...emptyForm(), mods: ['season5'] }, bots, servers, ['season5']);
    expect(hasProblems(problems)).toBe(false);
  });

  it('accepts side names the runner accepts', () => {
    const sides = ['a', 'enemy', 'enemy-2', 'enemy_two', '2nd'].map((side) => ({ side, profile: 'default' }));
    expect(validateForm({ bot: '', sides, server: '', mods: [] }, bots, servers).sides.every((row) => row.side === null)).toBe(true);
  });
});

describe('optionsFor', () => {
  it('leaves a registered selection alone', () => {
    expect(optionsFor(['default', 'speedrun'], 'speedrun')).toEqual(['default', 'speedrun']);
    expect(optionsFor(['default', 'speedrun'], 'SpeedRun')).toEqual(['default', 'speedrun']);
    expect(optionsFor(['default'], '')).toEqual(['default']);
  });

  it('keeps an unregistered stored name selectable', () => {
    expect(optionsFor(['default'], 'ghost')).toEqual(['default', 'ghost']);
  });
});

describe('canonicalName', () => {
  it('returns the registry spelling of a stored name', () => {
    // the runner lowercases what it reads, so "SpeedRun" IS "speedrun" — but a
    // <select> matches by exact string and would show nothing selected
    expect(canonicalName(['default', 'speedrun'], 'SpeedRun')).toBe('speedrun');
  });

  it('leaves an unregistered or empty name alone', () => {
    expect(canonicalName(['default'], 'ghost')).toBe('ghost');
    expect(canonicalName(['default'], '  ')).toBe('');
  });
});

describe('toggleMod', () => {
  const catalog = ['season5', 'zzz'];

  it('ticks and unticks', () => {
    expect(toggleMod([], 'season5', true, catalog)).toEqual(['season5']);
    expect(toggleMod(['season5'], 'season5', false, catalog)).toEqual([]);
  });

  it('never duplicates an already-ticked mod', () => {
    expect(toggleMod(['season5'], 'season5', true, catalog)).toEqual(['season5']);
  });

  // Catalog order, not click order: otherwise ticking the same two mods in a
  // different order would rewrite the file for no reason.
  it('keeps the catalog order regardless of click order', () => {
    expect(toggleMod(['zzz'], 'season5', true, catalog)).toEqual(['season5', 'zzz']);
  });
});

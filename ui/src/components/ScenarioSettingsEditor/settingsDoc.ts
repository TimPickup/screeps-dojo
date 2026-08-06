// The scenario settings.json document, modelled apart from the component so
// every decision is testable without a DOM. src/scenarioSettings.js is the
// authority on what the runner accepts: parseDoc must reject what its
// validate() rejects, and serializeDoc must emit what it accepts — otherwise
// the editor could write a file that then kills the run it was meant to
// configure. Its test suite asserts the shape emitted here still loads.

export const MAIN_SIDE = 'main';
export const KNOWN_KEYS = ['bot', 'bots', 'server'];
export const SIDE_RE = /^[a-z0-9][a-z0-9_-]*$/;

export interface SettingsSide {
  side: string;
  profile: string;
}

// Empty string means "inherit": the runner falls back to the default profile
// when the key is absent, and serializeDoc omits empty keys entirely.
export interface SettingsForm {
  bot: string;
  sides: SettingsSide[];
  server: string;
}

export interface ParsedDoc {
  form: SettingsForm | null;
  extras: Record<string, unknown>;
  error: string | null;
}

// Per-field, aligned with the form: sides[i] describes the row at that index.
export interface FormProblems {
  bot: string | null;
  server: string | null;
  sides: Array<{ side: string | null; profile: string | null }>;
}

export function emptyForm(): SettingsForm {
  return { bot: '', sides: [], server: '' };
}

function fail(extras: Record<string, unknown>, error: string): ParsedDoc {
  return { form: null, extras, error };
}

// A structural problem (bad JSON, wrong types, both "bot" and "bots.main")
// yields a null form so the caller can refuse to swap the raw text for a form
// that cannot represent it. Problems the form *can* show — an unregistered
// profile name, a malformed side name — parse fine and are left to
// validateForm, so they stay visible and fixable instead of vanishing.
export function parseDoc(text: string): ParsedDoc {
  if (!text.trim()) return { form: emptyForm(), extras: {}, error: null };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail({}, 'invalid JSON — ' + String((e as Error).message || e));
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail({}, 'expected a JSON object');

  const source = raw as Record<string, unknown>;
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(source)) if (!KNOWN_KEYS.includes(key)) extras[key] = source[key];

  const form = emptyForm();
  if (source.bots !== undefined) {
    if (!source.bots || typeof source.bots !== 'object' || Array.isArray(source.bots)) {
      return fail(extras, '"bots" must be an object of side -> profile name');
    }
    const bots = source.bots as Record<string, unknown>;
    for (const side of Object.keys(bots)) {
      const profile = bots[side];
      if (typeof profile !== 'string' || !profile) return fail(extras, '"bots.' + side + '" must be a non-empty profile name');
      if (side === MAIN_SIDE) form.bot = profile;
      else form.sides.push({ side, profile });
    }
  }
  if (source.bot !== undefined) {
    if (typeof source.bot !== 'string' || !source.bot) return fail(extras, '"bot" must be a non-empty profile name');
    if (form.bot) return fail(extras, 'declare either "bot" or "bots.' + MAIN_SIDE + '", not both');
    form.bot = source.bot;
  }
  if (source.server !== undefined) {
    if (typeof source.server !== 'string' || !source.server) return fail(extras, '"server" must be a non-empty profile name');
    form.server = source.server;
  }
  return { form, extras, error: null };
}

export function serializeDoc(form: SettingsForm, extras: Record<string, unknown> = {}): string {
  const out: Record<string, unknown> = {};
  const bot = form.bot.trim();
  if (bot) out.bot = bot;

  const bots: Record<string, string> = {};
  for (const row of form.sides) {
    const side = row.side.trim();
    const profile = row.profile.trim();
    // A half-typed row, or one that duplicates the main side, is never written:
    // the file on disk stays loadable while the row itself stays on screen
    // (flagged by validateForm) for the user to finish or delete.
    if (!side || !profile || side === MAIN_SIDE) continue;
    bots[side] = profile;
  }
  if (Object.keys(bots).length) out.bots = bots;

  const server = form.server.trim();
  if (server) out.server = server;

  // Unknown keys ride along at the end: the runner only warns about them, so
  // dropping a hand-written key on the first form save would be theft.
  for (const key of Object.keys(extras)) if (!(key in out)) out[key] = extras[key];

  return JSON.stringify(out, null, '\t') + '\n';
}

// Case-insensitive because the runner lowercases every profile name it reads,
// so "Speedrun" in the file is the registered "speedrun" and must not go red.
function matches(known: string[], value: string): boolean {
  return known.some((name) => name.toLowerCase() === value.toLowerCase());
}

function unknownProfile(value: string, known: string[], what: string): string | null {
  const name = value.trim();
  // An empty registry means the profile list never loaded, not that every name
  // is wrong — say nothing rather than paint the whole form red.
  if (!name || !known.length) return null;
  return matches(known, name) ? null : '"' + name + '" is not a registered ' + what + ' profile';
}

export function validateForm(form: SettingsForm, knownBots: string[], knownServers: string[]): FormProblems {
  const counts = new Map<string, number>();
  for (const row of form.sides) {
    const side = row.side.trim().toLowerCase();
    if (side) counts.set(side, (counts.get(side) || 0) + 1);
  }

  const sides = form.sides.map((row) => {
    const side = row.side.trim();
    let sideProblem: string | null = null;
    if (!side) sideProblem = 'side name is required';
    else if (side === MAIN_SIDE) sideProblem = 'the ' + MAIN_SIDE + ' side belongs in the Bot field';
    else if (!SIDE_RE.test(side)) sideProblem = 'invalid side name "' + side + '" — lowercase letters, digits, _ and - only';
    else if ((counts.get(side.toLowerCase()) || 0) > 1) sideProblem = 'duplicate side "' + side + '"';

    const profile = row.profile.trim();
    const profileProblem = profile ? unknownProfile(profile, knownBots, 'bot') : 'choose a bot profile';
    return { side: sideProblem, profile: profileProblem };
  });

  return {
    bot: unknownProfile(form.bot, knownBots, 'bot'),
    server: unknownProfile(form.server, knownServers, 'server'),
    sides
  };
}

export function hasProblems(problems: FormProblems): boolean {
  return Boolean(problems.bot || problems.server
    || problems.sides.some((row) => row.side || row.profile));
}

// A name stored in the file but missing from the registry must stay selectable,
// or simply opening the editor would rewrite the file to inherit instead.
export function optionsFor(known: string[], selected: string): string[] {
  const name = selected.trim();
  if (!name || matches(known, name)) return known;
  return known.concat([name]);
}

// The registry's spelling of a stored name. The runner lowercases what it reads,
// so a hand-written "Speedrun" IS the registered "speedrun" — but a <select>
// matches its options by exact string, and would otherwise show nothing selected.
export function canonicalName(known: string[], selected: string): string {
  const name = selected.trim();
  if (!name) return '';
  return known.find((candidate) => candidate.toLowerCase() === name.toLowerCase()) || name;
}

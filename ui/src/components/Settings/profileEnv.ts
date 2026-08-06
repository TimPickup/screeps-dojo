import type { BotProfile } from '../../api/types';

// Env-key math for bot and screeps profiles, mirroring src/botProfiles.js and
// src/screepsProfiles.js. The browser only ever holds a flat env map, so every
// naming rule the server parses by has to exist here too — the two must be kept
// in step, and this module is where that duplication is contained (and tested).
//
// Every editing function is pure: env map in, a { values, remove } patch out for
// api.putEnv. The components stay dumb renderers so the rules can be tested
// without a DOM (the UI test setup has no jsdom).

export const BOT_PREFIX = 'DOJO_BOT_PROFILE_';
export const BOT_LEGACY_PATH_KEY = 'DOJO_BOT_PATH';
export const BOT_DEFAULT_KEY = 'DOJO_DEFAULT_BOT_PROFILE';

export const SCREEPS_PREFIX = 'DOJO_SCREEPS_PROFILE_';
export const SCREEPS_DEFAULT_KEY = 'DOJO_DEFAULT_SCREEPS_PROFILE';
// Longest-first, exactly as the server orders them: the key is matched at the
// END of the variable name so a profile name may contain underscores, and
// PASSWORD must not be shadowed by a shorter key that is a suffix of it.
export const SCREEPS_KEYS = ['PROTOCOL', 'HOSTNAME', 'USERNAME', 'PASSWORD', 'TOKEN', 'SHARD', 'EMAIL', 'PORT', 'PATH'] as const;
export type ScreepsKey = typeof SCREEPS_KEYS[number];
export const SCREEPS_SECRET_KEYS: ScreepsKey[] = ['TOKEN', 'PASSWORD'];

export const DEFAULT_PROFILE = 'default';
export const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

// A patch for api.putEnv. `needsReentry` names env keys the browser could not
// carry across because it only ever saw them masked — the user has to type them
// in again, and pretending otherwise would silently destroy a secret.
export interface EnvPatch {
  values: Record<string, string>;
  remove: string[];
  needsReentry: string[];
}

export interface BotProfileRow {
  name: string;
  hostPath: string;
  legacy: boolean;
}

export interface ScreepsProfileRow {
  name: string;
  own: Partial<Record<ScreepsKey, string>>;
  legacy: boolean;
}

function emptyPatch(): EnvPatch { return { values: {}, remove: [], needsReentry: [] }; }

export function isSecretKey(key: ScreepsKey): boolean { return SCREEPS_SECRET_KEYS.includes(key); }

// /api/env masks secrets with • before they reach the browser, so a value that
// carries one is a display artefact and must never be written back anywhere.
export function isMasked(value: string | undefined): boolean {
  return typeof value === 'string' && value.indexOf('•') !== -1;
}

export function normalizeProfileName(name: string): string { return String(name || '').trim().toLowerCase(); }

export function botProfileKey(name: string): string {
  return BOT_PREFIX + normalizeProfileName(name).toUpperCase() + '_PATH';
}

export function screepsProfileKey(name: string, key: ScreepsKey): string {
  return SCREEPS_PREFIX + normalizeProfileName(name).toUpperCase() + '_' + key;
}

export function screepsLegacyKey(key: ScreepsKey): string { return 'DOJO_SCREEPS_' + key; }

// 'DOJO_BOT_PROFILE_MY_BOT_PATH' -> { name: 'my_bot' }
export function parseBotKey(envKey: string): { name: string } | null {
  if (envKey.indexOf(BOT_PREFIX) !== 0) return null;
  const rest = envKey.slice(BOT_PREFIX.length);
  if (rest.length <= '_PATH'.length || !rest.endsWith('_PATH')) return null;
  return { name: rest.slice(0, -'_PATH'.length).toLowerCase() };
}

// 'DOJO_SCREEPS_PROFILE_MY_SEASON_SHARD' -> { name: 'my_season', key: 'SHARD' }
export function parseScreepsKey(envKey: string): { name: string; key: ScreepsKey } | null {
  if (envKey.indexOf(SCREEPS_PREFIX) !== 0) return null;
  const rest = envKey.slice(SCREEPS_PREFIX.length);
  for (const key of SCREEPS_KEYS) {
    const suffix = '_' + key;
    if (rest.length > suffix.length && rest.endsWith(suffix)) {
      return { name: rest.slice(0, -suffix.length).toLowerCase(), key };
    }
  }
  return null;
}

export function defaultBotProfileName(values: Record<string, string>): string {
  return normalizeProfileName(values[BOT_DEFAULT_KEY] || '') || DEFAULT_PROFILE;
}

export function defaultScreepsProfileName(values: Record<string, string>): string {
  return normalizeProfileName(values[SCREEPS_DEFAULT_KEY] || '') || DEFAULT_PROFILE;
}

// Default first, then alphabetical — the same order /api/bots and /api/servers
// hand back, so a locally added row slots in where the server would put it.
function sortNames(names: string[], preferred: string): string[] {
  return names.slice().sort((a, b) => {
    if (a === preferred) return -1;
    if (b === preferred) return 1;
    return a < b ? -1 : 1;
  });
}

// Rows come from the env map alone, and a key that is PRESENT counts even when
// its value is empty: a profile the user just added, or whose path they have
// blanked to retype it, must keep its row. The server ignores an empty value, so
// nothing is claimed by the row until it holds something; only Remove (which
// deletes the key) makes a row disappear.
export function listBotProfiles(values: Record<string, string>): BotProfileRow[] {
  const byName: Record<string, BotProfileRow> = {};
  if (BOT_LEGACY_PATH_KEY in values) {
    byName[DEFAULT_PROFILE] = { name: DEFAULT_PROFILE, hostPath: values[BOT_LEGACY_PATH_KEY], legacy: true };
  }
  for (const envKey of Object.keys(values)) {
    const parsed = parseBotKey(envKey);
    if (!parsed || !NAME_RE.test(parsed.name)) continue;
    byName[parsed.name] = { name: parsed.name, hostPath: values[envKey], legacy: false };
  }
  return sortNames(Object.keys(byName), defaultBotProfileName(values)).map((n) => byName[n]);
}

export function listScreepsProfiles(values: Record<string, string>): ScreepsProfileRow[] {
  const byName: Record<string, ScreepsProfileRow> = {};
  for (const key of SCREEPS_KEYS) {
    const legacyKey = screepsLegacyKey(key);
    if (!(legacyKey in values)) continue;
    if (!byName[DEFAULT_PROFILE]) byName[DEFAULT_PROFILE] = { name: DEFAULT_PROFILE, own: {}, legacy: true };
    byName[DEFAULT_PROFILE].own[key] = values[legacyKey];
    byName[DEFAULT_PROFILE].legacy = true;
  }
  for (const envKey of Object.keys(values)) {
    const parsed = parseScreepsKey(envKey);
    if (!parsed || !NAME_RE.test(parsed.name)) continue;
    if (!byName[parsed.name]) byName[parsed.name] = { name: parsed.name, own: {}, legacy: false };
    byName[parsed.name].own[parsed.key] = values[envKey];
  }
  return sortNames(Object.keys(byName), defaultScreepsProfileName(values)).map((n) => byName[n]);
}

// The value a profile states for itself — what belongs in the input. Undefined
// means the profile does not own the key, so it inherits it from "default".
export function screepsOwnValue(values: Record<string, string>, name: string, key: ScreepsKey): string | undefined {
  const own = values[screepsProfileKey(name, key)];
  if (own !== undefined) return own;
  if (normalizeProfileName(name) === DEFAULT_PROFILE) return values[screepsLegacyKey(key)];
  return undefined;
}

// Writing a profile-form key next to its legacy twin would leave two variables
// for one setting with the profile silently winning, so an edit to a legacy row
// takes the legacy key with it. Paths and hostnames are not secrets; a masked
// secret is handled separately by the caller.
function dropLegacyBotKey(values: Record<string, string>, name: string, patch: EnvPatch): void {
  if (normalizeProfileName(name) === DEFAULT_PROFILE && BOT_LEGACY_PATH_KEY in values) {
    patch.remove.push(BOT_LEGACY_PATH_KEY);
  }
}

export function setBotProfile(values: Record<string, string>, name: string, hostPath: string): EnvPatch {
  const patch = emptyPatch();
  patch.values[botProfileKey(name)] = hostPath;
  dropLegacyBotKey(values, name, patch);
  return patch;
}

export function renameBotProfile(values: Record<string, string>, from: string, to: string): EnvPatch {
  const patch = emptyPatch();
  const fromName = normalizeProfileName(from);
  const toName = normalizeProfileName(to);
  if (fromName === toName) return patch;
  const row = listBotProfiles(values).find((p) => p.name === fromName);
  if (!row) return patch;
  patch.values[botProfileKey(toName)] = row.hostPath;
  patch.remove.push(row.legacy ? BOT_LEGACY_PATH_KEY : botProfileKey(fromName));
  if (defaultBotProfileName(values) === fromName) repointDefaultBot(values, toName, patch);
  return patch;
}

export function deleteBotProfile(values: Record<string, string>, name: string): EnvPatch {
  const patch = emptyPatch();
  const wanted = normalizeProfileName(name);
  const key = botProfileKey(wanted);
  if (key in values) patch.remove.push(key);
  if (wanted === DEFAULT_PROFILE && BOT_LEGACY_PATH_KEY in values) patch.remove.push(BOT_LEGACY_PATH_KEY);
  // A pointer at a profile that no longer exists is a hard error on the next
  // run (resolveDir never falls through), so it goes with the profile.
  if (defaultBotProfileName(values) === wanted && BOT_DEFAULT_KEY in values) patch.remove.push(BOT_DEFAULT_KEY);
  return patch;
}

// "default" is already the fallback when no pointer is set, so selecting it
// DELETES the key rather than writing a line that restates the default.
function repointDefaultBot(values: Record<string, string>, name: string, patch: EnvPatch): void {
  const wanted = normalizeProfileName(name);
  if (wanted === DEFAULT_PROFILE) {
    if (BOT_DEFAULT_KEY in values) patch.remove.push(BOT_DEFAULT_KEY);
    return;
  }
  patch.values[BOT_DEFAULT_KEY] = wanted;
}

export function setDefaultBotProfile(values: Record<string, string>, name: string): EnvPatch {
  const patch = emptyPatch();
  repointDefaultBot(values, name, patch);
  return patch;
}

// An empty value un-owns the key: the server skips empty variables, so the
// profile falls back to inheriting it from "default" (and "default" itself falls
// back to the built-in screeps.com settings).
export function setScreepsProfile(
  values: Record<string, string>,
  name: string,
  edits: Partial<Record<ScreepsKey, string>>
): EnvPatch {
  const patch = emptyPatch();
  const wanted = normalizeProfileName(name);
  for (const key of Object.keys(edits) as ScreepsKey[]) {
    const value = edits[key];
    if (value === undefined) continue;
    // The browser holds masks, not secrets; a mask coming back means "untouched".
    if (isMasked(value)) continue;
    patch.values[screepsProfileKey(wanted, key)] = value;
    if (wanted === DEFAULT_PROFILE && screepsLegacyKey(key) in values) patch.remove.push(screepsLegacyKey(key));
  }
  return patch;
}

export function renameScreepsProfile(values: Record<string, string>, from: string, to: string): EnvPatch {
  const patch = emptyPatch();
  const fromName = normalizeProfileName(from);
  const toName = normalizeProfileName(to);
  if (fromName === toName) return patch;
  const row = listScreepsProfiles(values).find((p) => p.name === fromName);
  if (!row) return patch;
  for (const key of Object.keys(row.own) as ScreepsKey[]) {
    const value = row.own[key] as string;
    // A masked secret cannot travel with the profile, and leaving its old key
    // behind would resurrect the old profile — so it is dropped and reported.
    if (isMasked(value)) patch.needsReentry.push(screepsProfileKey(toName, key));
    else patch.values[screepsProfileKey(toName, key)] = value;
    if (screepsProfileKey(fromName, key) in values) patch.remove.push(screepsProfileKey(fromName, key));
    if (fromName === DEFAULT_PROFILE && screepsLegacyKey(key) in values) patch.remove.push(screepsLegacyKey(key));
  }
  if (defaultScreepsProfileName(values) === fromName) repointDefaultScreeps(values, toName, patch);
  return patch;
}

export function deleteScreepsProfile(values: Record<string, string>, name: string): EnvPatch {
  const patch = emptyPatch();
  const wanted = normalizeProfileName(name);
  for (const key of SCREEPS_KEYS) {
    const envKey = screepsProfileKey(wanted, key);
    if (envKey in values) patch.remove.push(envKey);
    if (wanted === DEFAULT_PROFILE && screepsLegacyKey(key) in values) patch.remove.push(screepsLegacyKey(key));
  }
  if (defaultScreepsProfileName(values) === wanted && SCREEPS_DEFAULT_KEY in values) patch.remove.push(SCREEPS_DEFAULT_KEY);
  return patch;
}

function repointDefaultScreeps(values: Record<string, string>, name: string, patch: EnvPatch): void {
  const wanted = normalizeProfileName(name);
  // Symmetric with the bot selector: "default" is the absence of a pointer.
  if (wanted === DEFAULT_PROFILE) {
    if (SCREEPS_DEFAULT_KEY in values) patch.remove.push(SCREEPS_DEFAULT_KEY);
    return;
  }
  patch.values[SCREEPS_DEFAULT_KEY] = wanted;
}

export function setDefaultScreepsProfile(values: Record<string, string>, name: string): EnvPatch {
  const patch = emptyPatch();
  repointDefaultScreeps(values, name, patch);
  return patch;
}

export function validateProfileName(name: string, existing: string[]): string | null {
  const wanted = normalizeProfileName(name);
  if (!wanted) return 'Name a profile first.';
  if (!NAME_RE.test(wanted)) return 'Use lowercase letters, digits, - or _, starting with a letter or digit.';
  if (existing.map(normalizeProfileName).includes(wanted)) return 'A profile called "' + wanted + '" already exists.';
  return null;
}

export interface StatusLabel { text: string; tone: 'ok' | 'warn' }

// Per-row truth about a bot profile. A bind mount is fixed when the container is
// created, so "registered" and "usable" are different states and only the row
// itself knows which it is in — a blanket "restart needed" warning on every save
// would just train people to ignore it.
export function botStatusLabel(status: BotProfile | undefined, hostPath: string): StatusLabel {
  if (!status) return { text: '⚠ not registered yet — Save, then Apply below', tone: 'warn' };
  // The mount carries the path it was created with; a newer path in .env is not
  // live until the container is recreated.
  if (status.hostPath !== hostPath) return { text: '⚠ path changed — Save, then Apply below', tone: 'warn' };
  if (!status.mounted) {
    const detail = status.error && status.error.indexOf('not mounted') === -1 ? status.error : 'registered — not mounted yet, Apply below';
    return { text: '⚠ ' + detail, tone: 'warn' };
  }
  if (status.jsModuleCount === 0) return { text: '⚠ ' + (status.error || 'mounted but holds no .js modules'), tone: 'warn' };
  return { text: '✓ mounted · ' + status.jsModuleCount + ' .js', tone: 'ok' };
}

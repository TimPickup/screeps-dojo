'use strict';

// Screeps server profiles: named connection settings for the room importer.
//
//   DOJO_SCREEPS_PROFILE_<NAME>_<KEY>   e.g. ..._SEASON_SHARD=season
//   DOJO_DEFAULT_SCREEPS_PROFILE        which profile to use when none is named
//   DOJO_SCREEPS_<KEY>                  legacy; maps to the profile named "default"
//
// A profile OVERLAYS the default profile, so one that only changes the shard
// needs a single key. resolve() returns the flat DOJO_SCREEPS_* shape that
// src/import/screepsClient.js createClient() already consumes, so nothing
// downstream has to learn about profiles.
const PREFIX = 'DOJO_SCREEPS_PROFILE_';
// Longest-first: matching the key at the END of the variable name is what lets a
// profile name contain underscores, and PASSWORD must not be shadowed by a
// shorter key that happens to be a suffix of it.
const KEYS = ['PROTOCOL', 'HOSTNAME', 'USERNAME', 'PASSWORD', 'TOKEN', 'SHARD', 'EMAIL', 'PORT', 'PATH'];
const SECRET_KEYS = ['TOKEN', 'PASSWORD'];
const DEFAULT_PROFILE = 'default';
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

function legacyKeyFor(key) { return 'DOJO_SCREEPS_' + key; }
function envKeyFor(name, key) { return PREFIX + String(name).toUpperCase() + '_' + key; }

// 'DOJO_SCREEPS_PROFILE_MY_SEASON_SHARD' -> { name: 'my_season', key: 'SHARD' }
function parseKey(envKey) {
	if (envKey.lastIndexOf(PREFIX, 0) !== 0) return null;
	const rest = envKey.slice(PREFIX.length);
	for (const key of KEYS) {
		const suffix = '_' + key;
		if (rest.length > suffix.length && rest.slice(-suffix.length) === suffix) {
			return { name: rest.slice(0, -suffix.length).toLowerCase(), key: key };
		}
	}
	return null;
}

// { name -> { KEY: value } } holding only what each profile states itself.
function parseProfiles(env) {
	env = env || process.env;
	const byName = {};
	for (const key of KEYS) {
		const legacy = env[legacyKeyFor(key)];
		if (legacy === undefined || legacy === '') continue;
		if (!byName[DEFAULT_PROFILE]) byName[DEFAULT_PROFILE] = {};
		byName[DEFAULT_PROFILE][key] = legacy;
	}
	for (const envKey of Object.keys(env)) {
		const parsed = parseKey(envKey);
		if (!parsed || env[envKey] === undefined || env[envKey] === '') continue;
		if (!NAME_RE.test(parsed.name)) continue;
		if (!byName[parsed.name]) byName[parsed.name] = {};
		byName[parsed.name][parsed.key] = env[envKey];
	}
	return byName;
}

function defaultProfileName(env) {
	env = env || process.env;
	const declared = (env.DOJO_DEFAULT_SCREEPS_PROFILE || '').trim().toLowerCase();
	return declared || DEFAULT_PROFILE;
}

function usesLegacyKeys(env) {
	env = env || process.env;
	for (const key of KEYS) { if (env[legacyKeyFor(key)]) return true; }
	return false;
}

// Never returns secrets — this is what the browser is allowed to see.
function listProfiles(env) {
	const byName = parseProfiles(env);
	const preferred = defaultProfileName(env);
	const names = Object.keys(byName).sort(function (a, b) {
		if (a === preferred) return -1;
		if (b === preferred) return 1;
		return a < b ? -1 : 1;
	});
	return names.map(function (name) {
		const merged = mergeWithDefault(byName, name);
		return {
			name: name,
			hostname: merged.HOSTNAME || 'screeps.com',
			shard: merged.SHARD || 'shard0',
			port: merged.PORT || '443',
			protocol: merged.PROTOCOL || 'https',
			path: merged.PATH || '/',
			hasToken: Boolean(merged.TOKEN),
			hasPassword: Boolean(merged.PASSWORD),
			// a profile that only exists as an overlay of the default still lists,
			// but the UI should show which keys it actually owns
			ownKeys: Object.keys(byName[name]).sort()
		};
	});
}

function mergeWithDefault(byName, name) {
	const base = byName[DEFAULT_PROFILE] || {};
	if (name === DEFAULT_PROFILE) return Object.assign({}, base);
	return Object.assign({}, base, byName[name] || {});
}

function known(name, env) {
	return Object.prototype.hasOwnProperty.call(parseProfiles(env), String(name).toLowerCase());
}

// Flattens a profile back into the DOJO_SCREEPS_* shape createClient() expects,
// preserving every unrelated variable in `env` (the client also reads nothing
// else, but callers pass whole environments and should get them back intact).
function resolve(name, env, sourceLabel) {
	env = env || process.env;
	const wanted = String(name || '').toLowerCase() || defaultProfileName(env);
	const where = sourceLabel ? sourceLabel + ': ' : '';
	const byName = parseProfiles(env);
	if (!Object.prototype.hasOwnProperty.call(byName, wanted)) {
		const registered = Object.keys(byName).sort();
		// The default profile is allowed to be absent — a checkout with no .env
		// has no server settings at all, and createClient() reports that itself.
		if (wanted === DEFAULT_PROFILE) return Object.assign({}, env);
		throw new Error(where + 'unknown screeps profile "' + wanted + '"'
			+ (registered.length ? ' (registered: ' + registered.join(', ') + ')' : ' (none registered)'));
	}
	const merged = mergeWithDefault(byName, wanted);
	const out = Object.assign({}, env);
	for (const key of KEYS) {
		if (merged[key] !== undefined) out[legacyKeyFor(key)] = merged[key];
		else delete out[legacyKeyFor(key)];
	}
	return out;
}

module.exports = {
	PREFIX: PREFIX,
	KEYS: KEYS,
	SECRET_KEYS: SECRET_KEYS,
	DEFAULT_PROFILE: DEFAULT_PROFILE,
	NAME_RE: NAME_RE,
	legacyKeyFor: legacyKeyFor,
	envKeyFor: envKeyFor,
	parseKey: parseKey,
	parseProfiles: parseProfiles,
	listProfiles: listProfiles,
	defaultProfileName: defaultProfileName,
	usesLegacyKeys: usesLegacyKeys,
	known: known,
	resolve: resolve
};

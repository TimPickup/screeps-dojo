'use strict';

// Screeps server profiles: named connection settings for the room importer.
//
//   DOJO_SCREEPS_PROFILE_<NAME>_<KEY>   e.g. ..._SEASON_SHARD=season
//   DOJO_DEFAULT_SCREEPS_PROFILE        which profile to use when none is named
//   DOJO_SCREEPS_<KEY>                  legacy; maps to the profile named "default"
//
// Every profile STANDS ALONE. An earlier version had them overlay the profile
// named "default", which read well on paper and badly in practice: a profile
// showing "screeps.com" you never typed, connecting with a token belonging to a
// different server, and no way to tell by looking which values were really its
// own. Unset keys fall back to the built-in defaults below and nowhere else.
//
// resolve() returns the flat DOJO_SCREEPS_* shape that
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
		const own = ownKeysOf(byName, name);
		return {
			name: name,
			hostname: own.HOSTNAME || 'screeps.com',
			shard: own.SHARD || 'shard0',
			port: own.PORT || '443',
			protocol: own.PROTOCOL || 'https',
			path: own.PATH || '/',
			hasToken: Boolean(own.TOKEN),
			hasPassword: Boolean(own.PASSWORD),
			ownKeys: Object.keys(own).sort()
		};
	});
}

// A profile's own keys, and only those.
function ownKeysOf(byName, name) {
	return Object.assign({}, byName[name] || {});
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
	const own = ownKeysOf(byName, wanted);
	const out = Object.assign({}, env);
	for (const key of KEYS) {
		if (own[key] !== undefined && own[key] !== '') out[legacyKeyFor(key)] = own[key];
		else delete out[legacyKeyFor(key)];   // createClient supplies the built-in default
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

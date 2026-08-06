'use strict';

// Bot profiles: named codebases, each bind-mounted read-only at /bots/<name>.
//
// A bind mount is fixed when the container is created, so the container can only
// ever read paths that were mounted at that moment. Registering every codebase
// up front and selecting between them BY NAME is what makes switching — globally
// or per scenario — free: no recreate, because the mount already exists.
//
//   DOJO_BOT_PROFILE_<NAME>_PATH   host path for profile <name>
//   DOJO_DEFAULT_BOT_PROFILE       which profile runs when nothing names one
//   DOJO_BOT_PATH                  legacy; maps to the profile named "default"
//
// Parsing is pure (env in, plain objects out). Only status() touches the
// filesystem, and only the Settings screen asks for it.
const fs = require('fs');
const path = require('path');

const PREFIX = 'DOJO_BOT_PROFILE_';
// The trailing key comes from a closed set, so matching it at the END of the
// variable name leaves the profile itself free to contain underscores:
// DOJO_BOT_PROFILE_MY_BOT_PATH is profile "my_bot", not "my".
const KEYS = ['PATH'];
const LEGACY_PATH_KEY = 'DOJO_BOT_PATH';
const DEFAULT_PROFILE = 'default';
// No hyphen: the name becomes part of an env key, and .env keys are
// [A-Z0-9_] only — a hyphenated name would produce a line the parser
// skips entirely, silently losing whatever it held.
const NAME_RE = /^[a-z0-9][a-z0-9_]*$/;

function botsDir(env) { return (env && env.DOJO_BOTS_DIR) || '/bots'; }

// 'DOJO_BOT_PROFILE_MY_BOT_PATH' -> { name: 'my_bot', key: 'PATH' }
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

// { name -> { name, hostPath, legacy } }, in declaration-independent (sorted)
// order with the default profile first so the UI never has to re-sort.
function parseProfiles(env) {
	env = env || process.env;
	const byName = {};
	if (env[LEGACY_PATH_KEY]) {
		byName[DEFAULT_PROFILE] = { name: DEFAULT_PROFILE, hostPath: env[LEGACY_PATH_KEY], legacy: true };
	}
	for (const envKey of Object.keys(env)) {
		const parsed = parseKey(envKey);
		if (!parsed || !env[envKey]) continue;
		if (!NAME_RE.test(parsed.name)) continue;   // unusable as a mount path; ignore rather than crash
		byName[parsed.name] = { name: parsed.name, hostPath: env[envKey], legacy: false };
	}
	return byName;
}

function listProfiles(env) {
	const byName = parseProfiles(env);
	const names = Object.keys(byName).sort();
	const preferred = defaultProfileName(env);
	names.sort(function (a, b) {
		if (a === preferred) return -1;
		if (b === preferred) return 1;
		return a < b ? -1 : 1;
	});
	return names.map(function (name) { return byName[name]; });
}

function defaultProfileName(env) {
	env = env || process.env;
	const declared = (env.DOJO_DEFAULT_BOT_PROFILE || '').trim().toLowerCase();
	return declared || DEFAULT_PROFILE;
}

function usesLegacyKeys(env) {
	env = env || process.env;
	return Boolean(env[LEGACY_PATH_KEY]);
}

// Container directory for a profile. Pure string math — it says nothing about
// whether the mount actually exists (see assertMounted).
function dirFor(name, env) {
	return path.posix.join(botsDir(env), String(name).toLowerCase());
}

function known(name, env) {
	return Object.prototype.hasOwnProperty.call(parseProfiles(env), String(name).toLowerCase());
}

// Resolves an EXPLICITLY requested profile. A name that is unknown or not
// mounted is an error here, never a silent fall-through to the default — a run
// that quietly used the wrong codebase would be far worse than one that stopped.
function resolveDir(name, env, sourceLabel) {
	env = env || process.env;
	const wanted = String(name || '').toLowerCase();
	const where = sourceLabel ? sourceLabel + ': ' : '';
	if (!NAME_RE.test(wanted)) {
		throw new Error(where + 'invalid bot profile name "' + name + '"');
	}
	if (!known(wanted, env)) {
		const registered = Object.keys(parseProfiles(env)).sort();
		throw new Error(where + 'unknown bot profile "' + wanted + '"'
			+ (registered.length ? ' (registered: ' + registered.join(', ') + ')' : ' (none registered)'));
	}
	const dir = dirFor(wanted, env);
	if (!isReadableDir(dir)) {
		throw new Error(where + 'bot profile "' + wanted + '" is registered but not mounted at '
			+ dir + ' — apply it from Settings, or run npm run ui');
	}
	return dir;
}

// The directory used when nothing names a profile.
//
// DOJO_BOT_DIR wins outright: it is the non-Docker escape hatch, set by CI (to
// the workspace) and by anyone running outside a container — where no /bots
// mounts exist, so honouring a profile pointer could only fail. Nothing sets it
// inside the container, which is why the pointer governs there.
function implicitDir(env) {
	env = env || process.env;
	if (env.DOJO_BOT_DIR) return env.DOJO_BOT_DIR;
	const explicitDefault = (env.DOJO_DEFAULT_BOT_PROFILE || '').trim();
	if (explicitDefault) return resolveDir(explicitDefault, env, 'DOJO_DEFAULT_BOT_PROFILE');
	return dirFor(DEFAULT_PROFILE, env);
}

function isReadableDir(dir) {
	try { return fs.statSync(dir).isDirectory(); } catch (e) { return false; }
}

// Mount status for one profile. This is the only filesystem access in the
// module: one readdir, and callers are expected to cache it (the scenario dirs
// and /bots are Docker bind mounts, where syscalls cost milliseconds).
function status(profile, env) {
	const dir = dirFor(profile.name, env);
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (e) {
		return {
			name: profile.name, hostPath: profile.hostPath, legacy: profile.legacy,
			dir: dir, mounted: false, jsModuleCount: 0,
			error: e && e.code === 'ENOENT'
				? 'not mounted — apply it from Settings, or run npm run ui'
				: String((e && e.message) || e)
		};
	}
	let jsModuleCount = 0;
	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith('.js')) jsModuleCount += 1;
	}
	return {
		name: profile.name, hostPath: profile.hostPath, legacy: profile.legacy,
		dir: dir, mounted: true, jsModuleCount: jsModuleCount,
		error: jsModuleCount === 0 ? 'mounted but holds no .js modules' : null
	};
}

module.exports = {
	PREFIX: PREFIX,
	KEYS: KEYS,
	LEGACY_PATH_KEY: LEGACY_PATH_KEY,
	DEFAULT_PROFILE: DEFAULT_PROFILE,
	NAME_RE: NAME_RE,
	envKeyFor: function (name) { return PREFIX + String(name).toUpperCase() + '_PATH'; },
	parseKey: parseKey,
	parseProfiles: parseProfiles,
	listProfiles: listProfiles,
	defaultProfileName: defaultProfileName,
	usesLegacyKeys: usesLegacyKeys,
	botsDir: botsDir,
	dirFor: dirFor,
	known: known,
	resolveDir: resolveDir,
	implicitDir: implicitDir,
	status: status
};

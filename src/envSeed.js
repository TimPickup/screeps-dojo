'use strict';

// One-time seeding of the Screeps server profiles, run at server boot.
//
// There is deliberately no profile called "default". A name that means "the
// fallback" tells you nothing about which server it is, and it made the list
// read as one real entry plus some overrides. Instead the shards you might
// actually import from are all there from the start, prefilled except for the
// credentials, which are the only part we cannot guess.
//
// SEEDED ONCE, and flagged. Deleting or renaming these afterwards is a decision,
// not something to be undone the next time the server starts — so the flag is
// what gates it, never "are the profiles missing".
const fs = require('fs');
const screepsProfiles = require('./screepsProfiles');
const { envPath } = require('./envConfig');
const { parse, merge, remove } = require('./server/envFile');

const SEEDED_KEY = 'DOJO_SCREEPS_PROFILES_SEEDED';

// The public server, plus a template for a private/custom shard. Auth is left
// out on purpose: a token is per-account and belongs to the person, not to us.
const SEED_PROFILES = [
	{ name: 'shard0', keys: { HOSTNAME: 'screeps.com', PORT: '443', PROTOCOL: 'https', PATH: '/', SHARD: 'shard0' } },
	{ name: 'shard1', keys: { HOSTNAME: 'screeps.com', PORT: '443', PROTOCOL: 'https', PATH: '/', SHARD: 'shard1' } },
	{ name: 'shard2', keys: { HOSTNAME: 'screeps.com', PORT: '443', PROTOCOL: 'https', PATH: '/', SHARD: 'shard2' } },
	{ name: 'shard3', keys: { HOSTNAME: 'screeps.com', PORT: '443', PROTOCOL: 'https', PATH: '/', SHARD: 'shard3' } },
	// No shardX exists on the public server; this is the one to edit for a
	// private server or a shard that does not have a row of its own yet.
	{ name: 'shardx', keys: { HOSTNAME: 'screeps.com', PORT: '443', PROTOCOL: 'https', PATH: '/', SHARD: 'shardX' } },
	{ name: 'season', keys: { HOSTNAME: 'screeps.com', PORT: '443', PROTOCOL: 'https', PATH: '/season/', SHARD: 'shardSeason' } }
];

// What an existing "default" profile becomes. Whoever had one got it from the
// unsuffixed keys, which predate profiles having names at all — so it keeps its
// settings and its place as the default, and only stops being called "default".
// Underscore, not a hyphen: this becomes part of an env key.
const PORTED_NAME = 'a_server';

function isSeeded(values) { return Boolean(values[SEEDED_KEY]); }

// { patch, drop, portedTo } — pure, so the whole decision is testable without
// touching a file. `portedTo` is null when there was nothing to rename.
function planSeed(values) {
	const patch = {};
	const drop = [];
	const existing = screepsProfiles.parseProfiles(values);
	let portedTo = null;

	// Rename an existing "default" out of the way first, so a seeded profile can
	// never collide with it and nothing the user configured is lost.
	if (Object.prototype.hasOwnProperty.call(existing, screepsProfiles.DEFAULT_PROFILE)
		&& !Object.prototype.hasOwnProperty.call(existing, PORTED_NAME)) {
		for (const key of screepsProfiles.KEYS) {
			const from = screepsProfiles.envKeyFor(screepsProfiles.DEFAULT_PROFILE, key);
			if (values[from] === undefined) continue;
			patch[screepsProfiles.envKeyFor(PORTED_NAME, key)] = values[from];
			drop.push(from);
		}
		if (drop.length) portedTo = PORTED_NAME;
	}

	for (const profile of SEED_PROFILES) {
		// Never overwrite a profile that already exists under a seeded name.
		if (Object.prototype.hasOwnProperty.call(existing, profile.name)) continue;
		for (const key of Object.keys(profile.keys)) {
			patch[screepsProfiles.envKeyFor(profile.name, key)] = profile.keys[key];
		}
	}

	// With no profile named "default" there is nothing to fall back to, so the
	// pointer has to be explicit. Keep whatever the user was already using.
	const pointer = 'DOJO_DEFAULT_SCREEPS_PROFILE';
	if (!values[pointer]) {
		patch[pointer] = portedTo || (Object.keys(existing).length ? Object.keys(existing).sort()[0] : 'shard0');
	} else if (values[pointer].trim().toLowerCase() === screepsProfiles.DEFAULT_PROFILE && portedTo) {
		patch[pointer] = portedTo;
	}

	patch[SEEDED_KEY] = '1';
	return { patch: patch, drop: drop, portedTo: portedTo };
}

// Returns { seeded, added, portedTo }. Never throws for a missing .env, and a
// failure here must not stop the server booting.
function seed(options) {
	options = options || {};
	const log = options.log || function () {};
	const file = options.file || envPath();

	let text = '';
	try { text = fs.readFileSync(file, 'utf8'); } catch (e) { text = ''; }
	const values = parse(text);
	if (isSeeded(values)) return { seeded: false, added: [], portedTo: null };

	const plan = planSeed(values);
	const before = screepsProfiles.parseProfiles(values);
	const added = SEED_PROFILES
		.filter(function (p) { return !Object.prototype.hasOwnProperty.call(before, p.name); })
		.map(function (p) { return p.name; });

	fs.writeFileSync(file, merge(remove(text, plan.drop), plan.patch), 'utf8');

	if (plan.portedTo) log('[dojo] renamed the unnamed "default" server profile to "' + plan.portedTo + '"');
	if (added.length) log('[dojo] added server profiles: ' + added.join(', ') + ' (add a token to the one you use)');
	return { seeded: true, added: added, portedTo: plan.portedTo };
}

module.exports = {
	SEEDED_KEY: SEEDED_KEY,
	SEED_PROFILES: SEED_PROFILES,
	PORTED_NAME: PORTED_NAME,
	isSeeded: isSeeded,
	planSeed: planSeed,
	seed: seed
};

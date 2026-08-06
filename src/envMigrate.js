'use strict';

// Rewrites the old unsuffixed keys into profile form, once, at server boot.
//
//   DOJO_BOT_PATH        -> DOJO_BOT_PROFILE_DEFAULT_PATH
//   DOJO_SCREEPS_<KEY>   -> DOJO_SCREEPS_PROFILE_DEFAULT_<KEY>
//
// Doing this automatically rather than offering a button is deliberate. The
// browser only ever sees secrets MASKED, so a UI-driven migration could not
// carry a token across — it had to leave the old key in place and ask the user
// to retype it, which is exactly the confusing half-migrated state the button
// was supposed to avoid. Here we are reading the real file, so the value moves
// intact and nobody has to think about it.
//
// The original is copied aside first. This edits a file the user owns and may
// have hand-written; a backup costs nothing and makes the change reversible.
const fs = require('fs');
const botProfiles = require('./botProfiles');
const screepsProfiles = require('./screepsProfiles');
const { envPath } = require('./envConfig');
const { parse, merge, remove } = require('./server/envFile');

// { moves: [{ from, to, key }], drops: [key] } — a legacy key whose profile-form
// twin already exists is dropped rather than moved: the profile form already
// wins at read time, so keeping both would only leave two names for one setting.
function planMigration(values) {
	const moves = [];
	const drops = [];

	function consider(legacyKey, profileKey) {
		if (!Object.prototype.hasOwnProperty.call(values, legacyKey)) return;
		if (Object.prototype.hasOwnProperty.call(values, profileKey)) drops.push(legacyKey);
		else moves.push({ from: legacyKey, to: profileKey });
	}

	consider(botProfiles.LEGACY_PATH_KEY, botProfiles.envKeyFor(botProfiles.DEFAULT_PROFILE));
	for (const key of screepsProfiles.KEYS) {
		consider(screepsProfiles.legacyKeyFor(key),
			screepsProfiles.envKeyFor(screepsProfiles.DEFAULT_PROFILE, key));
	}
	return { moves: moves, drops: drops };
}

function isNeeded(plan) { return plan.moves.length > 0 || plan.drops.length > 0; }

// Applies a plan to the .env TEXT, preserving comments, ordering and every key
// it does not touch (that is what envFile.merge/remove are for).
function applyPlan(text, values, plan) {
	const patch = {};
	for (const move of plan.moves) patch[move.to] = values[move.from];
	const dropped = plan.moves.map(function (m) { return m.from; }).concat(plan.drops);
	return merge(remove(text, dropped), patch);
}

// .env.bak, then .env.bak1, .env.bak2, ... — never overwrite an earlier backup.
function nextBackupPath(base, exists) {
	const check = exists || function (p) { return fs.existsSync(p); };
	if (!check(base + '.bak')) return base + '.bak';
	for (let n = 1; ; n++) {
		const candidate = base + '.bak' + n;
		if (!check(candidate)) return candidate;
	}
}

// Returns { migrated, moved, dropped, backupPath }. Never throws for a missing
// .env, and a failure here must not stop the server booting: the legacy keys
// still resolve, so the worst case is that the file stays as it was.
function migrate(options) {
	options = options || {};
	const log = options.log || function () {};
	const file = options.file || envPath();
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (e) {
		return { migrated: false, moved: [], dropped: [], backupPath: null };
	}

	const values = parse(text);
	const plan = planMigration(values);
	if (!isNeeded(plan)) return { migrated: false, moved: [], dropped: [], backupPath: null };

	const backupPath = nextBackupPath(file);
	fs.copyFileSync(file, backupPath);
	fs.writeFileSync(file, applyPlan(text, values, plan), 'utf8');

	const moved = plan.moves.map(function (m) { return m.from + ' -> ' + m.to; });
	log('[dojo] migrated ' + (plan.moves.length + plan.drops.length) + ' old .env key(s) to profile form'
		+ ' (backup: ' + require('path').basename(backupPath) + ')');
	for (const line of moved) log('[dojo]   ' + line);
	for (const key of plan.drops) log('[dojo]   ' + key + ' removed (its profile key already exists)');
	return { migrated: true, moved: moved, dropped: plan.drops, backupPath: backupPath };
}

module.exports = {
	planMigration: planMigration,
	isNeeded: isNeeded,
	applyPlan: applyPlan,
	nextBackupPath: nextBackupPath,
	migrate: migrate
};

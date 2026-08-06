'use strict';

// Seeding rewrites a file the user owns, once ever. What it must never do
// matters most: run twice, overwrite something they configured, or lose a token
// while renaming the profile that held it.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const envSeed = require('../../src/envSeed');
const screepsProfiles = require('../../src/screepsProfiles');
const { parse } = require('../../src/server/envFile');

function applied(values, plan) {
	const next = Object.assign({}, values, plan.patch);
	for (const key of plan.drop) delete next[key];
	return next;
}

describe('envSeed', function () {
	it('seeds the shards you might actually import from', function () {
		const plan = envSeed.planSeed({});
		const profiles = screepsProfiles.parseProfiles(applied({}, plan));
		assert.deepStrictEqual(Object.keys(profiles).sort(),
			['season', 'shard0', 'shard1', 'shard2', 'shard3', 'shardx']);
		assert.strictEqual(profiles.shard2.SHARD, 'shard2');
		assert.strictEqual(profiles.season.SHARD, 'shardSeason');
		assert.strictEqual(profiles.season.PATH, '/season/', 'the seasonal server lives under /season/');
	});

	it('leaves credentials out — a token belongs to the person, not to us', function () {
		const plan = envSeed.planSeed({});
		for (const key of Object.keys(plan.patch)) {
			assert.strictEqual(/_TOKEN$|_PASSWORD$|_USERNAME$/.test(key), false, key + ' must not be seeded');
		}
	});

	// Every seeded name has to survive the round trip into an env key and back;
	// a hyphen, for instance, would produce a line .env's parser skips entirely.
	it('uses names that are valid inside an env key', function () {
		for (const profile of envSeed.SEED_PROFILES.concat([{ name: envSeed.PORTED_NAME }])) {
			assert.ok(screepsProfiles.NAME_RE.test(profile.name), profile.name + ' is not a valid profile name');
			const envKey = screepsProfiles.envKeyFor(profile.name, 'TOKEN');
			assert.ok(/^[A-Z0-9_]+$/.test(envKey), envKey + ' is not a usable env key');
			assert.deepStrictEqual(screepsProfiles.parseKey(envKey), { name: profile.name, key: 'TOKEN' });
		}
	});

	describe('an existing "default" profile', function () {
		const before = {
			DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN: 'super-secret',
			DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shardSeason',
			DOJO_SCREEPS_PROFILE_DEFAULT_PATH: '/season/'
		};

		it('is renamed, keeping every setting including the token', function () {
			const plan = envSeed.planSeed(before);
			const profiles = screepsProfiles.parseProfiles(applied(before, plan));
			assert.strictEqual(plan.portedTo, envSeed.PORTED_NAME);
			assert.strictEqual(profiles[envSeed.PORTED_NAME].TOKEN, 'super-secret');
			assert.strictEqual(profiles[envSeed.PORTED_NAME].PATH, '/season/');
			assert.strictEqual(profiles.default, undefined, 'nothing should still be called "default"');
		});

		it('stays the default, since it was the one in use', function () {
			const plan = envSeed.planSeed(before);
			assert.strictEqual(plan.patch.DOJO_DEFAULT_SCREEPS_PROFILE, envSeed.PORTED_NAME);
		});

		it('follows an explicit pointer that named it', function () {
			const plan = envSeed.planSeed(Object.assign({ DOJO_DEFAULT_SCREEPS_PROFILE: 'default' }, before));
			assert.strictEqual(plan.patch.DOJO_DEFAULT_SCREEPS_PROFILE, envSeed.PORTED_NAME);
		});

		it('leaves a pointer at some other profile alone', function () {
			const plan = envSeed.planSeed(Object.assign({
				DOJO_DEFAULT_SCREEPS_PROFILE: 'mine',
				DOJO_SCREEPS_PROFILE_MINE_SHARD: 'shard0'
			}, before));
			assert.strictEqual(plan.patch.DOJO_DEFAULT_SCREEPS_PROFILE, undefined);
		});
	});

	it('never overwrites a profile that already has a seeded name', function () {
		const before = { DOJO_SCREEPS_PROFILE_SHARD0_HOSTNAME: 'my.private.server' };
		const plan = envSeed.planSeed(before);
		const profiles = screepsProfiles.parseProfiles(applied(before, plan));
		assert.strictEqual(profiles.shard0.HOSTNAME, 'my.private.server');
	});

	describe('seed', function () {
		let dir, file;

		beforeEach(function () {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-seed-'));
			file = path.join(dir, '.env');
		});

		it('runs once and leaves a flag behind', function () {
			fs.writeFileSync(file, '', 'utf8');
			const first = envSeed.seed({ file: file });
			assert.strictEqual(first.seeded, true);
			assert.strictEqual(parse(fs.readFileSync(file, 'utf8'))[envSeed.SEEDED_KEY], '1');

			const second = envSeed.seed({ file: file });
			assert.strictEqual(second.seeded, false);
		});

		// The point of the flag. Deleting a seeded profile is a decision, and
		// putting it back on the next boot would quietly overrule it.
		it('does not re-create a profile the user deleted', function () {
			fs.writeFileSync(file, '', 'utf8');
			envSeed.seed({ file: file });

			const kept = fs.readFileSync(file, 'utf8')
				.split('\n')
				.filter(function (line) { return line.indexOf('DOJO_SCREEPS_PROFILE_SHARD2_') === -1; })
				.join('\n');
			fs.writeFileSync(file, kept, 'utf8');

			envSeed.seed({ file: file });
			const profiles = screepsProfiles.parseProfiles(parse(fs.readFileSync(file, 'utf8')));
			assert.strictEqual(profiles.shard2, undefined, 'a deleted profile must stay deleted');
		});

		it('keeps comments and unrelated keys', function () {
			fs.writeFileSync(file, '# mine\nDOJO_UI_PORT=9999\n', 'utf8');
			envSeed.seed({ file: file });
			const after = fs.readFileSync(file, 'utf8');
			assert.ok(after.includes('# mine'));
			assert.ok(after.includes('DOJO_UI_PORT=9999'));
		});
	});
});

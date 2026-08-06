'use strict';

const assert = require('assert');
const screepsProfiles = require('../../src/screepsProfiles');

describe('screepsProfiles', function () {
	describe('parseKey', function () {
		it('splits a profile name from the trailing key', function () {
			assert.deepStrictEqual(screepsProfiles.parseKey('DOJO_SCREEPS_PROFILE_SEASON_SHARD'), { name: 'season', key: 'SHARD' });
		});

		it('keeps underscores inside a profile name', function () {
			assert.deepStrictEqual(screepsProfiles.parseKey('DOJO_SCREEPS_PROFILE_MY_SEASON_SHARD'), { name: 'my_season', key: 'SHARD' });
		});

		it('does not confuse keys that share a tail', function () {
			assert.deepStrictEqual(screepsProfiles.parseKey('DOJO_SCREEPS_PROFILE_X_PASSWORD'), { name: 'x', key: 'PASSWORD' });
			assert.deepStrictEqual(screepsProfiles.parseKey('DOJO_SCREEPS_PROFILE_X_USERNAME'), { name: 'x', key: 'USERNAME' });
			assert.deepStrictEqual(screepsProfiles.parseKey('DOJO_SCREEPS_PROFILE_X_HOSTNAME'), { name: 'x', key: 'HOSTNAME' });
		});

		it('ignores unrelated keys', function () {
			assert.strictEqual(screepsProfiles.parseKey('DOJO_SCREEPS_SHARD'), null);
			assert.strictEqual(screepsProfiles.parseKey('DOJO_SCREEPS_PROFILE_SHARD'), null);
		});
	});

	it('maps legacy unsuffixed keys onto the default profile', function () {
		const profiles = screepsProfiles.parseProfiles({ DOJO_SCREEPS_SHARD: 'shard0', DOJO_SCREEPS_TOKEN: 'abc' });
		assert.deepStrictEqual(profiles, { default: { SHARD: 'shard0', TOKEN: 'abc' } });
	});

	it('lets the new form win over a legacy key', function () {
		const profiles = screepsProfiles.parseProfiles({
			DOJO_SCREEPS_SHARD: 'shard0',
			DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard3'
		});
		assert.strictEqual(profiles.default.SHARD, 'shard3');
	});

	describe('resolve', function () {
		const env = {
			DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN: 'tok',
			DOJO_SCREEPS_PROFILE_DEFAULT_HOSTNAME: 'screeps.com',
			DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard0',
			DOJO_SCREEPS_PROFILE_SEASON_SHARD: 'season',
			DOJO_SCREEPS_PROFILE_LOCAL_HOSTNAME: 'localhost',
			DOJO_SCREEPS_PROFILE_LOCAL_TOKEN: 'other'
		};

		it('overlays a profile on the default, so it only states what differs', function () {
			const config = screepsProfiles.resolve('season', env);
			assert.strictEqual(config.DOJO_SCREEPS_SHARD, 'season');
			assert.strictEqual(config.DOJO_SCREEPS_HOSTNAME, 'screeps.com');
			assert.strictEqual(config.DOJO_SCREEPS_TOKEN, 'tok');
		});

		it('returns the flat shape createClient() already reads', function () {
			const config = screepsProfiles.resolve('local', env);
			assert.strictEqual(config.DOJO_SCREEPS_HOSTNAME, 'localhost');
			assert.strictEqual(config.DOJO_SCREEPS_TOKEN, 'other');
			assert.strictEqual(config.DOJO_SCREEPS_SHARD, 'shard0');   // inherited
		});

		it('drops a default key the chosen profile does not inherit a value for', function () {
			const config = screepsProfiles.resolve('bare', { DOJO_SCREEPS_PROFILE_BARE_HOSTNAME: 'h' });
			assert.strictEqual(config.DOJO_SCREEPS_TOKEN, undefined);
		});

		it('uses DOJO_DEFAULT_SCREEPS_PROFILE when nothing names a profile', function () {
			const config = screepsProfiles.resolve(undefined,
				Object.assign({ DOJO_DEFAULT_SCREEPS_PROFILE: 'season' }, env));
			assert.strictEqual(config.DOJO_SCREEPS_SHARD, 'season');
		});

		it('names the registered profiles when one is unknown', function () {
			assert.throws(function () {
				screepsProfiles.resolve('nope', env, 'x/settings.json');
			}, /x\/settings\.json: unknown screeps profile "nope" \(registered: default, local, season\)/);
		});

		it('tolerates an absent default — a checkout with no .env has no server settings at all', function () {
			assert.doesNotThrow(function () { screepsProfiles.resolve(undefined, {}); });
		});
	});

	it('listProfiles exposes only whether a secret is set', function () {
		const listed = screepsProfiles.listProfiles({
			DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN: 'super-secret',
			DOJO_SCREEPS_PROFILE_DEFAULT_SHARD: 'shard0',
			DOJO_SCREEPS_PROFILE_SEASON_SHARD: 'season'
		});
		const asJson = JSON.stringify(listed);
		assert.strictEqual(asJson.includes('super-secret'), false);
		const byName = {};
		for (const p of listed) byName[p.name] = p;
		assert.strictEqual(byName.default.hasToken, true);
		assert.strictEqual(byName.season.hasToken, true);          // inherited from default
		assert.deepStrictEqual(byName.season.ownKeys, ['SHARD']);  // but owns only its shard
		assert.strictEqual(byName.season.hostname, 'screeps.com'); // default fallback
	});

	it('listProfiles puts the default first', function () {
		const listed = screepsProfiles.listProfiles({
			DOJO_SCREEPS_PROFILE_ALPHA_SHARD: 'a',
			DOJO_SCREEPS_PROFILE_SEASON_SHARD: 'season',
			DOJO_DEFAULT_SCREEPS_PROFILE: 'season'
		});
		assert.deepStrictEqual(listed.map(function (p) { return p.name; }), ['season', 'alpha']);
	});
});

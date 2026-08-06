'use strict';

const assert = require('assert');
const composeOverride = require('../../scripts/composeOverride');

const allExist = function () { return true; };

describe('composeOverride', function () {
	it('emits one read-only mount per profile, for every service', function () {
		const result = composeOverride.generate({
			DOJO_BOT_PROFILE_SPEEDRUN_PATH: '/host/speed',
			DOJO_BOT_PROFILE_OLD_PATH: '/host/old'
		}, allExist);
		assert.strictEqual(result.mounts.length, 2);
		for (const service of composeOverride.SERVICES) {
			assert.ok(result.yaml.includes('  ' + service + ':'), 'missing service ' + service);
		}
		assert.ok(result.yaml.includes('"/host/speed:/bots/speedrun:ro"'));
		assert.ok(result.yaml.includes('"/host/old:/bots/old:ro"'));
	});

	it('leaves the default profile to the base compose file', function () {
		// docker-compose.yml already mounts ${DOJO_BOT_PATH:-.} at /bots/default;
		// emitting it again would just duplicate the mount
		const result = composeOverride.generate({ DOJO_BOT_PROFILE_DEFAULT_PATH: '/host/main' }, allExist);
		assert.strictEqual(result.yaml, null);
		assert.deepStrictEqual(result.mounts, []);
	});

	it('produces nothing when only legacy keys are set', function () {
		assert.strictEqual(composeOverride.generate({ DOJO_BOT_PATH: '/host/legacy' }, allExist).yaml, null);
	});

	it('skips a profile whose host path is gone rather than breaking the stack', function () {
		const result = composeOverride.generate({
			DOJO_BOT_PROFILE_GOOD_PATH: '/host/good',
			DOJO_BOT_PROFILE_STALE_PATH: '/host/deleted'
		}, function (p) { return p === '/host/good'; });
		assert.deepStrictEqual(result.mounts.map(function (m) { return m.name; }), ['good']);
		assert.deepStrictEqual(result.skipped.map(function (m) { return m.name; }), ['stale']);
		assert.strictEqual(result.yaml.includes('/host/deleted'), false);
	});

	describe('yamlQuote', function () {
		it('survives the Windows paths this exists for', function () {
			assert.strictEqual(composeOverride.yamlQuote('C:/Program Files/bot'), '"C:/Program Files/bot"');
		});

		it('escapes backslashes and quotes', function () {
			assert.strictEqual(composeOverride.yamlQuote('C:\\bots\\my "bot"'), '"C:\\\\bots\\\\my \\"bot\\""');
		});
	});

	it('quotes every mount, so a path with spaces still parses', function () {
		const result = composeOverride.generate({ DOJO_BOT_PROFILE_X_PATH: 'C:/Program Files/bot' }, allExist);
		assert.ok(result.yaml.includes('"C:/Program Files/bot:/bots/x:ro"'));
	});
});

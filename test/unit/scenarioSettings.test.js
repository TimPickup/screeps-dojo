'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scenarioSettings = require('../../src/scenarioSettings');

describe('scenarioSettings', function () {
	let dir;

	beforeEach(function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-settings-'));
	});

	function write(text) {
		fs.writeFileSync(path.join(dir, 'settings.json'), text, 'utf8');
	}

	it('treats an absent file as "inherit everything"', function () {
		const loaded = scenarioSettings.load(dir);
		assert.strictEqual(loaded.present, false);
		assert.deepStrictEqual(loaded.settings, { bots: {} });
		assert.deepStrictEqual(loaded.warnings, []);
	});

	it('reads "bot" as shorthand for bots.main', function () {
		write('{"bot":"speedrun"}');
		assert.deepStrictEqual(scenarioSettings.load(dir).settings, { bots: { main: 'speedrun' } });
	});

	it('merges bot and bots into one map', function () {
		write('{"bot":"speedrun","bots":{"enemy":"default"},"server":"season"}');
		assert.deepStrictEqual(scenarioSettings.load(dir).settings, {
			bots: { enemy: 'default', main: 'speedrun' },
			server: 'season'
		});
	});

	it('refuses an ambiguous main bot', function () {
		write('{"bot":"a","bots":{"main":"b"}}');
		assert.throws(function () { scenarioSettings.load(dir); }, /either "bot" or "bots\.main", not both/);
	});

	it('lowercases profile names so settings.json can be written naturally', function () {
		write('{"bot":"SpeedRun","server":"Season"}');
		const settings = scenarioSettings.load(dir).settings;
		assert.strictEqual(settings.bots.main, 'speedrun');
		assert.strictEqual(settings.server, 'season');
	});

	it('names the file and the parse error for malformed JSON', function () {
		write('{ not json');
		assert.throws(function () { scenarioSettings.load(dir); }, /settings\.json: invalid JSON/);
	});

	it('warns about an unknown key instead of killing the run', function () {
		write('{"bot":"a","botz":"typo"}');
		const loaded = scenarioSettings.load(dir);
		assert.strictEqual(loaded.settings.bots.main, 'a');
		assert.strictEqual(loaded.warnings.length, 1);
		assert.match(loaded.warnings[0], /unknown setting "botz"/);
	});

	it('rejects wrong types with a message naming the setting', function () {
		write('{"bots":["a"]}');
		assert.throws(function () { scenarioSettings.load(dir); }, /"bots" must be an object/);
		write('{"bot":42}');
		assert.throws(function () { scenarioSettings.load(dir); }, /"bot" must be a non-empty profile name/);
		write('{"server":""}');
		assert.throws(function () { scenarioSettings.load(dir); }, /"server" must be a non-empty profile name/);
		write('{"bots":{"Bad Side":"a"}}');
		assert.throws(function () { scenarioSettings.load(dir); }, /invalid side name/);
	});

	it('rejects a top-level array or null', function () {
		write('[]');
		assert.throws(function () { scenarioSettings.load(dir); }, /expected a JSON object/);
		write('null');
		assert.throws(function () { scenarioSettings.load(dir); }, /expected a JSON object/);
	});

	it('accepts what the editor writes — the shorthand form with extra sides', function () {
		// ui/src/components/ScenarioSettingsEditor/settingsDoc.ts emits exactly
		// this shape; if the two ever drift, the editor would write a file that
		// kills the run it was meant to configure.
		write('{\n\t"bot": "speedrun",\n\t"bots": {\n\t\t"enemy": "old"\n\t},\n\t"server": "season"\n}\n');
		const loaded = scenarioSettings.load(dir);
		assert.deepStrictEqual(loaded.settings.bots, { enemy: 'old', main: 'speedrun' });
		assert.strictEqual(loaded.settings.server, 'season');
		assert.deepStrictEqual(loaded.warnings, []);
	});

	it('accepts an empty object — what the ⚙ creates for a new scenario', function () {
		write('{}\n');
		assert.deepStrictEqual(scenarioSettings.load(dir).settings, { bots: {} });
	});
});

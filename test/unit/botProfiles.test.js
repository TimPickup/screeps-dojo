'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const botProfiles = require('../../src/botProfiles');

describe('botProfiles', function () {
	describe('parseKey', function () {
		it('splits a profile name from the trailing key', function () {
			assert.deepStrictEqual(botProfiles.parseKey('DOJO_BOT_PROFILE_MAIN_PATH'), { name: 'main', key: 'PATH' });
		});

		it('keeps underscores inside a profile name', function () {
			// the key is matched at the END, which is the whole point: anchoring on
			// the first underscore would read this as the profile "my"
			assert.deepStrictEqual(botProfiles.parseKey('DOJO_BOT_PROFILE_MY_BOT_PATH'), { name: 'my_bot', key: 'PATH' });
		});

		it('ignores unrelated and malformed keys', function () {
			assert.strictEqual(botProfiles.parseKey('DOJO_BOT_PATH'), null);
			assert.strictEqual(botProfiles.parseKey('DOJO_BOT_PROFILE_PATH'), null);   // no name
			assert.strictEqual(botProfiles.parseKey('DOJO_BOT_PROFILE_MAIN_DIR'), null); // unknown key
		});
	});

	describe('parseProfiles', function () {
		it('reads the new form', function () {
			const profiles = botProfiles.parseProfiles({
				DOJO_BOT_PROFILE_MAIN_PATH: '/host/main',
				DOJO_BOT_PROFILE_SPEEDRUN_PATH: '/host/speed'
			});
			assert.deepStrictEqual(Object.keys(profiles).sort(), ['main', 'speedrun']);
			assert.strictEqual(profiles.main.hostPath, '/host/main');
			assert.strictEqual(profiles.main.legacy, false);
		});

		it('maps the legacy DOJO_BOT_PATH onto the default profile', function () {
			const profiles = botProfiles.parseProfiles({ DOJO_BOT_PATH: '/host/legacy' });
			assert.deepStrictEqual(Object.keys(profiles), ['default']);
			assert.strictEqual(profiles.default.hostPath, '/host/legacy');
			assert.strictEqual(profiles.default.legacy, true);
		});

		it('lets the new form win over the legacy key', function () {
			const profiles = botProfiles.parseProfiles({
				DOJO_BOT_PATH: '/host/legacy',
				DOJO_BOT_PROFILE_DEFAULT_PATH: '/host/new'
			});
			assert.strictEqual(profiles.default.hostPath, '/host/new');
			assert.strictEqual(profiles.default.legacy, false);
		});

		it('ignores blank values and names that could not be a mount path', function () {
			const profiles = botProfiles.parseProfiles({
				DOJO_BOT_PROFILE_EMPTY_PATH: '',
				DOJO_BOT_PROFILE__LEADING_PATH: '/host/x'
			});
			assert.deepStrictEqual(Object.keys(profiles), []);
		});
	});

	it('listProfiles puts the default first, then sorts', function () {
		const listed = botProfiles.listProfiles({
			DOJO_BOT_PROFILE_ZED_PATH: '/z',
			DOJO_BOT_PROFILE_ALPHA_PATH: '/a',
			DOJO_BOT_PROFILE_SPEEDRUN_PATH: '/s',
			DOJO_DEFAULT_BOT_PROFILE: 'speedrun'
		});
		assert.deepStrictEqual(listed.map(function (p) { return p.name; }), ['speedrun', 'alpha', 'zed']);
	});

	it('defaultProfileName falls back to "default" and lowercases', function () {
		assert.strictEqual(botProfiles.defaultProfileName({}), 'default');
		assert.strictEqual(botProfiles.defaultProfileName({ DOJO_DEFAULT_BOT_PROFILE: ' Speedrun ' }), 'speedrun');
	});

	it('envKeyFor round-trips through parseKey', function () {
		assert.deepStrictEqual(botProfiles.parseKey(botProfiles.envKeyFor('my_bot')), { name: 'my_bot', key: 'PATH' });
	});

	describe('resolveDir / implicitDir / status', function () {
		let root, mounted;

		before(function () {
			root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-bots-'));
			mounted = path.join(root, 'mounted');
			fs.mkdirSync(mounted);
			fs.writeFileSync(path.join(mounted, 'main.js'), 'module.exports = {};\n');
			fs.writeFileSync(path.join(mounted, 'notes.txt'), 'not a module\n');
			fs.mkdirSync(path.join(root, 'empty'));
		});

		function env(extra) {
			return Object.assign({ DOJO_BOTS_DIR: root }, extra);
		}

		it('resolves a mounted profile to its container dir', function () {
			const dir = botProfiles.resolveDir('mounted', env({ DOJO_BOT_PROFILE_MOUNTED_PATH: '/host/x' }));
			assert.strictEqual(dir, path.posix.join(root, 'mounted'));
		});

		it('names the registered profiles when one is unknown', function () {
			assert.throws(function () {
				botProfiles.resolveDir('nope', env({ DOJO_BOT_PROFILE_MOUNTED_PATH: '/host/x' }), 'x/settings.json');
			}, /x\/settings\.json: unknown bot profile "nope" \(registered: mounted\)/);
		});

		it('distinguishes registered-but-unmounted from unknown', function () {
			assert.throws(function () {
				botProfiles.resolveDir('ghost', env({ DOJO_BOT_PROFILE_GHOST_PATH: '/host/gone' }));
			}, /registered but not mounted.*npm run ui/);
		});

		it('rejects a name that could not be a directory', function () {
			assert.throws(function () { botProfiles.resolveDir('../etc', env({})); }, /invalid bot profile name/);
		});

		it('implicitDir follows an explicit default profile', function () {
			const dir = botProfiles.implicitDir(env({
				DOJO_BOT_PROFILE_MOUNTED_PATH: '/host/x',
				DOJO_DEFAULT_BOT_PROFILE: 'mounted'
			}));
			assert.strictEqual(dir, path.posix.join(root, 'mounted'));
		});

		it('implicitDir lets DOJO_BOT_DIR win — outside a container there are no mounts to point at', function () {
			// CI sets it to the workspace and has no Docker at all, so a profile
			// pointer there could only resolve to a directory that cannot exist.
			assert.strictEqual(botProfiles.implicitDir(env({
				DOJO_BOT_DIR: '/workspace',
				DOJO_BOT_PROFILE_MOUNTED_PATH: '/host/x',
				DOJO_DEFAULT_BOT_PROFILE: 'mounted'
			})), '/workspace');
		});

		it('implicitDir lands on the default mount when nothing else is set', function () {
			assert.strictEqual(botProfiles.implicitDir({ DOJO_BOTS_DIR: root }), path.posix.join(root, 'default'));
		});

		it('status counts .js modules in a mounted profile', function () {
			const s = botProfiles.status({ name: 'mounted', hostPath: '/host/x', legacy: false }, env({}));
			assert.strictEqual(s.mounted, true);
			assert.strictEqual(s.jsModuleCount, 1);
			assert.strictEqual(s.error, null);
		});

		it('status flags a mount that holds no modules', function () {
			const s = botProfiles.status({ name: 'empty', hostPath: '/host/e', legacy: false }, env({}));
			assert.strictEqual(s.mounted, true);
			assert.match(s.error, /no \.js modules/);
		});

		it('status reports an absent mount as actionable, not as a crash', function () {
			const s = botProfiles.status({ name: 'ghost', hostPath: '/host/g', legacy: false }, env({}));
			assert.strictEqual(s.mounted, false);
			assert.match(s.error, /npm run ui/);
		});
	});
});

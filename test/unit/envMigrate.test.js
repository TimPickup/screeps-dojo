'use strict';

// The migration rewrites a file the user owns, so what it must never do matters
// more than what it does: lose a value, clobber a backup, or touch anything it
// was not asked to.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const envMigrate = require('../../src/envMigrate');

describe('envMigrate', function () {
	describe('planMigration', function () {
		it('moves the legacy bot path onto the default profile', function () {
			const plan = envMigrate.planMigration({ DOJO_BOT_PATH: 'C:/bot' });
			assert.deepStrictEqual(plan.moves, [{ from: 'DOJO_BOT_PATH', to: 'DOJO_BOT_PROFILE_DEFAULT_PATH' }]);
			assert.deepStrictEqual(plan.drops, []);
		});

		it('moves every legacy screeps key', function () {
			const plan = envMigrate.planMigration({ DOJO_SCREEPS_TOKEN: 't', DOJO_SCREEPS_SHARD: 'shard0' });
			assert.deepStrictEqual(plan.moves.map(function (m) { return m.to; }).sort(),
				['DOJO_SCREEPS_PROFILE_DEFAULT_SHARD', 'DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN']);
		});

		it('drops a legacy key whose profile twin already exists', function () {
			// The profile form already wins at read time, so keeping both would
			// leave two names for one setting and no way to tell which is live.
			const plan = envMigrate.planMigration({
				DOJO_BOT_PATH: 'C:/old', DOJO_BOT_PROFILE_DEFAULT_PATH: 'C:/new'
			});
			assert.deepStrictEqual(plan.moves, []);
			assert.deepStrictEqual(plan.drops, ['DOJO_BOT_PATH']);
		});

		it('has nothing to do for an already-migrated file', function () {
			const plan = envMigrate.planMigration({ DOJO_BOT_PROFILE_DEFAULT_PATH: 'C:/bot', DOJO_UI_PORT: '8787' });
			assert.strictEqual(envMigrate.isNeeded(plan), false);
		});

		it('leaves unrelated keys alone', function () {
			const plan = envMigrate.planMigration({ DOJO_UI_PORT: '8787', DOJO_FAST_MOCK_ENGINE: '1' });
			assert.strictEqual(envMigrate.isNeeded(plan), false);
		});
	});

	it('applyPlan keeps comments, ordering and untouched keys', function () {
		const text = [
			'# my notes',
			'DOJO_BOT_PATH=C:/bot',
			'',
			'DOJO_UI_PORT=8787',
			'DOJO_SCREEPS_TOKEN=secret',
			''
		].join('\n');
		const values = { DOJO_BOT_PATH: 'C:/bot', DOJO_UI_PORT: '8787', DOJO_SCREEPS_TOKEN: 'secret' };
		const out = envMigrate.applyPlan(text, values, envMigrate.planMigration(values));

		assert.ok(out.includes('# my notes'), 'comments must survive');
		assert.ok(out.includes('DOJO_UI_PORT=8787'), 'untouched keys must survive');
		assert.ok(out.includes('DOJO_BOT_PROFILE_DEFAULT_PATH=C:/bot'));
		assert.ok(out.includes('DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN=secret'), 'the secret moves intact');
		assert.strictEqual(/^DOJO_BOT_PATH=/m.test(out), false, 'the old key must be gone');
		assert.strictEqual(/^DOJO_SCREEPS_TOKEN=/m.test(out), false);
	});

	it('nextBackupPath never overwrites an earlier backup', function () {
		const taken = new Set(['/x/.env.bak', '/x/.env.bak1']);
		assert.strictEqual(envMigrate.nextBackupPath('/x/.env', function (p) { return taken.has(p); }), '/x/.env.bak2');
		assert.strictEqual(envMigrate.nextBackupPath('/x/.env', function () { return false; }), '/x/.env.bak');
	});

	describe('migrate', function () {
		let dir, file;

		beforeEach(function () {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-migrate-'));
			file = path.join(dir, '.env');
		});

		it('rewrites the file and leaves the original beside it', function () {
			fs.writeFileSync(file, 'DOJO_BOT_PATH=C:/bot\nDOJO_SCREEPS_TOKEN=secret\n', 'utf8');
			const result = envMigrate.migrate({ file: file });

			assert.strictEqual(result.migrated, true);
			const after = fs.readFileSync(file, 'utf8');
			assert.ok(after.includes('DOJO_BOT_PROFILE_DEFAULT_PATH=C:/bot'));
			assert.ok(after.includes('DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN=secret'),
				'a secret has to move intact — that is what the UI could not do');
			assert.strictEqual(fs.readFileSync(result.backupPath, 'utf8'), 'DOJO_BOT_PATH=C:/bot\nDOJO_SCREEPS_TOKEN=secret\n');
		});

		it('is a no-op the second time, and takes no second backup', function () {
			fs.writeFileSync(file, 'DOJO_BOT_PATH=C:/bot\n', 'utf8');
			envMigrate.migrate({ file: file });
			const after = fs.readFileSync(file, 'utf8');

			const again = envMigrate.migrate({ file: file });
			assert.strictEqual(again.migrated, false);
			assert.strictEqual(again.backupPath, null);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), after, 'a settled file must not be touched');
			assert.deepStrictEqual(fs.readdirSync(dir).filter(function (n) { return n.indexOf('.bak') !== -1; }).length, 1);
		});

		it('does nothing when there is no .env at all', function () {
			const result = envMigrate.migrate({ file: path.join(dir, 'nope.env') });
			assert.strictEqual(result.migrated, false);
		});
	});
});

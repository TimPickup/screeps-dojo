'use strict';

const assert = require('assert');
const updateCheck = require('../../src/updateCheck');

describe('updateCheck', function () {
	describe('isNewer', function () {
		it('compares each component numerically, not as text', function () {
			assert.strictEqual(updateCheck.isNewer('0.3.0', '0.2.0'), true);
			assert.strictEqual(updateCheck.isNewer('0.10.0', '0.9.0'), true, '10 > 9, even though "10" < "9" as text');
			assert.strictEqual(updateCheck.isNewer('1.0.0', '0.99.99'), true);
			assert.strictEqual(updateCheck.isNewer('0.2.1', '0.2.0'), true);
		});

		it('is false for the same or an older version', function () {
			assert.strictEqual(updateCheck.isNewer('0.3.0', '0.3.0'), false);
			assert.strictEqual(updateCheck.isNewer('0.2.0', '0.3.0'), false);
			assert.strictEqual(updateCheck.isNewer('0.9.0', '0.10.0'), false);
		});

		// Fail-soft: a missing or mangled version must read as "nothing newer"
		// rather than nagging on every command.
		it('treats junk as not newer', function () {
			assert.strictEqual(updateCheck.isNewer(null, '0.3.0'), false);
			assert.strictEqual(updateCheck.isNewer(undefined, '0.3.0'), false);
			assert.strictEqual(updateCheck.isNewer('', '0.3.0'), false);
			assert.strictEqual(updateCheck.isNewer('not-a-version', '0.3.0'), false);
		});
	});

	describe('formatNotice', function () {
		const info = {
			current: '0.2.0', latest: '0.3.0', updateAvailable: true,
			repoUrl: 'https://github.com/TimPickup/screeps-dojo'
		};

		it('states both versions, how to update, and where to read why', function () {
			const notice = updateCheck.formatNotice(info);
			assert.ok(notice.includes('v0.3.0'), notice);
			assert.ok(notice.includes('v0.2.0'), notice);
			assert.ok(notice.includes('git pull'), 'must say how to update: ' + notice);
			assert.ok(notice.includes('npm run build:ui'), 'a pull leaves ui/dist stale: ' + notice);
			assert.ok(notice.includes('/releases'), 'must link the notes: ' + notice);
		});

		it('honours NO_COLOR', function () {
			const before = process.env.NO_COLOR;
			process.env.NO_COLOR = '1';
			try {
				assert.ok(!/\[/.test(updateCheck.formatNotice(info)), 'no ANSI escapes when NO_COLOR is set');
			} finally {
				if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before;
			}
		});
	});

	// A version check must never be the reason a command fails or hangs.
	it('reports nothing and stays quiet when opted out', async function () {
		const before = process.env.DOJO_NO_UPDATE_CHECK;
		process.env.DOJO_NO_UPDATE_CHECK = '1';
		try {
			const info = await updateCheck.getInfo(true);
			assert.strictEqual(info.updateAvailable, false);
			assert.strictEqual(info.latest, null);
			assert.strictEqual(info.current, updateCheck.CURRENT);
			await updateCheck.printNotice();   // must not throw
		} finally {
			if (before === undefined) delete process.env.DOJO_NO_UPDATE_CHECK; else process.env.DOJO_NO_UPDATE_CHECK = before;
		}
	});

	it('reports the running version', function () {
		const pkg = require('../../package.json');
		assert.strictEqual(updateCheck.CURRENT, pkg.version);
	});
});

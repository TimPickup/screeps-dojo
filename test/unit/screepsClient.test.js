'use strict';

const assert = require('assert');
const { createClient, usernameFromFindResult } = require('../../src/import/screepsClient');

describe('screeps import client', function () {
	it('does not require token activation for username/password auth', async function () {
		const client = createClient({
			DOJO_SCREEPS_USERNAME: 'Drak',
			DOJO_SCREEPS_PASSWORD: 'secret',
			DOJO_SCREEPS_HOSTNAME: 'private.example'
		});
		const status = await client.checkToken();
		assert.strictEqual(status.active, true);
		assert.strictEqual(status.authMode, 'password');
		assert.strictEqual(status.activateUrl, '');
	});

	describe('usernameFromFindResult', function () {
		// /api/user/find answers { ok: 1, user: { _id, username, ... } }.
		it('reads the username out of a successful lookup', function () {
			assert.strictEqual(
				usernameFromFindResult({ ok: 1, user: { _id: 'p1', username: 'Almaravarion' } }),
				'Almaravarion'
			);
		});

		it('returns null for a response with no user', function () {
			assert.strictEqual(usernameFromFindResult({ ok: 1 }), null);
			assert.strictEqual(usernameFromFindResult({ ok: 1, user: {} }), null);
			assert.strictEqual(usernameFromFindResult(null), null);
			assert.strictEqual(usernameFromFindResult(undefined), null);
		});

		it('returns null when the username is not a string', function () {
			assert.strictEqual(usernameFromFindResult({ user: { username: 42 } }), null);
		});
	});
});

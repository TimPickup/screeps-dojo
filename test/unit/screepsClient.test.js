'use strict';

const assert = require('assert');
const { createClient } = require('../../src/import/screepsClient');

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
});

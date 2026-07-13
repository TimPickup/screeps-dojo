'use strict';

const assert = require('assert');
const { configureChildEnv } = require('../../src/serverBoot');

describe('serverBoot child process environment', function () {
	it('runs bot VMs sequentially so shared driver caches initialize once', function () {
		const env = configureChildEnv('engine_runner', {});
		assert.strictEqual(env.RUNNER_THREADS, '1');
	});

	it('binds storage to IPv4 inside Docker', function () {
		const env = configureChildEnv('storage', {});
		assert.strictEqual(env.STORAGE_HOST, '127.0.0.1');
	});
});

'use strict';

const assert = require('assert');
const { configureChildEnv, assertInProcessIsolation, getMockEngineFeatures } = require('../../src/serverBoot');

describe('serverBoot child process environment', function () {
	it('runs bot VMs sequentially so shared driver caches initialize once', function () {
		const env = configureChildEnv('engine_runner', {});
		assert.strictEqual(env.RUNNER_THREADS, '1');
	});

	it('binds storage to IPv4 inside Docker', function () {
		const env = configureChildEnv('storage', {});
		assert.strictEqual(env.STORAGE_HOST, '127.0.0.1');
	});

	it('copies mock-engine feature switches to every child', function () {
		const oldMaster = process.env.DOJO_FAST_MOCK_ENGINE;
		const oldRpc = process.env.DOJO_FAST_MOCK_ENGINE_RPC_V8;
		process.env.DOJO_FAST_MOCK_ENGINE = '1';
		process.env.DOJO_FAST_MOCK_ENGINE_RPC_V8 = '0';
		try {
			const env = configureChildEnv('storage', {});
			assert.strictEqual(env.DOJO_FAST_MOCK_ENGINE, '1');
			assert.strictEqual(env.DOJO_FAST_MOCK_ENGINE_RPC_V8, '0');
		}
		finally {
			if (oldMaster === undefined) delete process.env.DOJO_FAST_MOCK_ENGINE;
			else process.env.DOJO_FAST_MOCK_ENGINE = oldMaster;
			if (oldRpc === undefined) delete process.env.DOJO_FAST_MOCK_ENGINE_RPC_V8;
			else process.env.DOJO_FAST_MOCK_ENGINE_RPC_V8 = oldRpc;
		}
	});

	it('reports the resolved mock-engine feature set', function () {
		assert.deepStrictEqual(getMockEngineFeatures({
			DOJO_FAST_MOCK_ENGINE: '1',
			DOJO_FAST_MOCK_ENGINE_IN_PROCESS: '0'
		}), {
			rpcV8: true,
			codeCache: true,
			roomGuard: true,
			inProcess: false,
			resetActiveRooms: true
		});
	});

	it('requires an isolated process for in-process execution', function () {
		assert.throws(function () {
			assertInProcessIsolation({ DOJO_FAST_MOCK_ENGINE_IN_PROCESS: '1' });
		}, /dedicated scenario or smoke process/);
		assert.doesNotThrow(function () {
			assertInProcessIsolation({
				DOJO_FAST_MOCK_ENGINE_IN_PROCESS: '1',
				DOJO_MOCK_ENGINE_PROCESS_ISOLATED: '1'
			});
		});
	});
});

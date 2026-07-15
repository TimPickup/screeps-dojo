'use strict';

const assert = require('assert');
const features = require('../../src/mockEngineFeatures');

describe('mock engine feature switches', function () {
	const names = ['rpcV8', 'codeCache', 'roomGuard', 'inProcess', 'resetActiveRooms'];

	it('defaults every feature on when no switches are set', function () {
		assert.deepStrictEqual(features.resolveAll({}), {
			rpcV8: true,
			codeCache: true,
			roomGuard: true,
			inProcess: true,
			resetActiveRooms: true
		});
	});

	it('treats an empty master switch as the default-on setting', function () {
		const resolved = features.resolveAll({ DOJO_FAST_MOCK_ENGINE: '' });
		for (const name of names) assert.strictEqual(resolved[name], true, name);
	});

	it('enables every feature through the master switch', function () {
		const resolved = features.resolveAll({ DOJO_FAST_MOCK_ENGINE: '1' });
		for (const name of names) assert.strictEqual(resolved[name], true, name);
	});

	it('disables every feature through an explicit zero master switch', function () {
		const resolved = features.resolveAll({ DOJO_FAST_MOCK_ENGINE: '0' });
		for (const name of names) assert.strictEqual(resolved[name], false, name);
	});

	it('lets explicit individual values override the master', function () {
		const env = {
			DOJO_FAST_MOCK_ENGINE: '1',
			DOJO_FAST_MOCK_ENGINE_RPC_V8: '0',
			DOJO_FAST_MOCK_ENGINE_CODE_CACHE: '1'
		};
		assert.strictEqual(features.isEnabled('rpcV8', env), false);
		assert.strictEqual(features.isEnabled('codeCache', env), true);
		assert.strictEqual(features.isEnabled('roomGuard', env), true);
	});

	it('enables one feature while the master is off', function () {
		const env = {
			DOJO_FAST_MOCK_ENGINE: '0',
			DOJO_FAST_MOCK_ENGINE_IN_PROCESS: '1'
		};
		assert.strictEqual(features.isEnabled('inProcess', env), true);
		assert.strictEqual(features.isEnabled('rpcV8', env), false);
	});

	it('treats unrecognized individual values as unset', function () {
		const env = {
			DOJO_FAST_MOCK_ENGINE: '1',
			DOJO_FAST_MOCK_ENGINE_ROOM_GUARD: 'yes'
		};
		assert.strictEqual(features.isEnabled('roomGuard', env), true);
	});

	it('rejects unknown feature names', function () {
		assert.throws(function () { features.isEnabled('missing', {}); }, /Unknown mock engine feature/);
	});

	it('copies only public feature variables into a child environment', function () {
		const source = {
			DOJO_FAST_MOCK_ENGINE: '1',
			DOJO_FAST_MOCK_ENGINE_RPC_V8: '0',
			DOJO_SCREEPS_TOKEN: 'secret'
		};
		const target = { DRIVER_MODULE: '@screeps/driver' };
		assert.strictEqual(features.copyPublicEnv(source, target), target);
		assert.deepStrictEqual(target, {
			DRIVER_MODULE: '@screeps/driver',
			DOJO_FAST_MOCK_ENGINE: '1',
			DOJO_FAST_MOCK_ENGINE_RPC_V8: '0'
		});
	});
});

'use strict';

const MASTER_KEY = 'DOJO_FAST_MOCK_ENGINE';
const FEATURES = Object.freeze({
	rpcV8: 'DOJO_FAST_MOCK_ENGINE_RPC_V8',
	codeCache: 'DOJO_FAST_MOCK_ENGINE_CODE_CACHE',
	roomGuard: 'DOJO_FAST_MOCK_ENGINE_ROOM_GUARD',
	inProcess: 'DOJO_FAST_MOCK_ENGINE_IN_PROCESS',
	resetActiveRooms: 'DOJO_FAST_MOCK_ENGINE_RESET_ACTIVE_ROOMS'
});
const PUBLIC_KEYS = Object.freeze([MASTER_KEY].concat(Object.values(FEATURES)));

function isEnabled(name, env) {
	env = env || process.env;
	const key = FEATURES[name];
	if (!key) throw new Error('Unknown mock engine feature: ' + name);
	if (env[key] === '1') return true;
	if (env[key] === '0') return false;
	if (env[MASTER_KEY] === '0') return false;
	return true;
}

function resolveAll(env) {
	const resolved = {};
	for (const name of Object.keys(FEATURES)) resolved[name] = isEnabled(name, env);
	return resolved;
}

function copyPublicEnv(source, target) {
	for (const key of PUBLIC_KEYS) {
		if (source[key] !== undefined) target[key] = source[key];
	}
	return target;
}

module.exports = {
	MASTER_KEY: MASTER_KEY,
	FEATURES: FEATURES,
	PUBLIC_KEYS: PUBLIC_KEYS,
	isEnabled: isEnabled,
	resolveAll: resolveAll,
	copyPublicEnv: copyPublicEnv
};

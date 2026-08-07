'use strict';

// The point of the fingerprint: a release bumps the version in package.json,
// which busts the Dockerfile's npm layer and spends ~7 minutes reinstalling 682
// identical packages. So the question it answers is "is the image made of
// anything different?", not "did a file change?".
//
// Both directions matter. Missing a real dependency change ships a stale image,
// which is far worse than a needless rebuild — so anything it cannot read has
// to come out as "different".
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const buildFingerprint = require('../../scripts/buildFingerprint');

function makeProject(overrides) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-fp-'));
	const pkg = Object.assign({
		name: 'screeps-dojo',
		version: '0.8.1',
		scripts: { postinstall: 'node tools/mockEnginePatches.cjs apply', test: 'node scripts/test.js' },
		dependencies: { screeps: '4.3.0' },
		devDependencies: { mocha: '^11.0.0' }
	}, (overrides || {}).pkg);
	const lock = Object.assign({
		lockfileVersion: 3,
		version: '0.8.1',
		packages: { '': { name: 'screeps-dojo', version: '0.8.1' }, 'node_modules/screeps': { version: '4.3.0' } }
	}, (overrides || {}).lock);

	fs.writeFileSync(path.join(dir, 'Dockerfile'), (overrides || {}).dockerfile || 'FROM node:24\nRUN npm ci\n');
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, '\t'));
	fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock, null, '\t'));
	fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'tools', 'mockEnginePatches.cjs'), (overrides || {}).patcher || '// patcher\n');
	fs.mkdirSync(path.join(dir, 'server-mock-patches'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'server-mock-patches', 'a.patch'), (overrides || {}).patch || 'patch a\n');
	return dir;
}

describe('buildFingerprint', function () {
	const made = [];
	function project(overrides) { const d = makeProject(overrides); made.push(d); return d; }
	after(function () { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* */ } } });

	it('is unchanged by a release — which is the whole point', function () {
		const base = buildFingerprint.fingerprint(project());
		const bumped = buildFingerprint.fingerprint(project({
			pkg: { version: '0.9.0' },
			lock: { version: '0.9.0', packages: { '': { name: 'screeps-dojo', version: '0.9.0' }, 'node_modules/screeps': { version: '4.3.0' } } }
		}));
		assert.strictEqual(bumped, base, 'a version bump must not force a rebuild');
	});

	it('changes when a dependency changes', function () {
		const base = buildFingerprint.fingerprint(project());
		const changed = buildFingerprint.fingerprint(project({ pkg: { dependencies: { screeps: '4.4.0' } } }));
		assert.notStrictEqual(changed, base);
	});

	it('changes when the lockfile resolves something differently', function () {
		const base = buildFingerprint.fingerprint(project());
		const changed = buildFingerprint.fingerprint(project({
			lock: { lockfileVersion: 3, version: '0.8.1', packages: { '': { name: 'screeps-dojo', version: '0.8.1' }, 'node_modules/screeps': { version: '9.9.9' } } }
		}));
		assert.notStrictEqual(changed, base);
	});

	it('changes when the Dockerfile changes', function () {
		const base = buildFingerprint.fingerprint(project());
		assert.notStrictEqual(buildFingerprint.fingerprint(project({ dockerfile: 'FROM node:25\n' })), base);
	});

	// These run DURING npm ci, so their text is baked into the image.
	it('changes when an install-time script changes', function () {
		const base = buildFingerprint.fingerprint(project());
		const changed = buildFingerprint.fingerprint(project({
			pkg: { scripts: { postinstall: 'node tools/mockEnginePatches.cjs apply --different', test: 'node scripts/test.js' } }
		}));
		assert.notStrictEqual(changed, base);
	});

	it('ignores scripts that never run during the build', function () {
		const base = buildFingerprint.fingerprint(project());
		const changed = buildFingerprint.fingerprint(project({
			pkg: { scripts: { postinstall: 'node tools/mockEnginePatches.cjs apply', test: 'something else entirely' } }
		}));
		assert.strictEqual(changed, base, 'changing `npm test` cannot change the image');
	});

	it('changes when a mock-engine patch or the patcher changes', function () {
		const base = buildFingerprint.fingerprint(project());
		assert.notStrictEqual(buildFingerprint.fingerprint(project({ patch: 'patch a, edited\n' })), base);
		assert.notStrictEqual(buildFingerprint.fingerprint(project({ patcher: '// patcher, edited\n' })), base);
	});

	// A missing or unreadable input must never look the same as a present one:
	// shipping a stale image is much worse than a needless rebuild.
	it('never reads as unchanged when an input is missing', function () {
		const dir = project();
		const base = buildFingerprint.fingerprint(dir);
		fs.rmSync(path.join(dir, 'Dockerfile'));
		assert.notStrictEqual(buildFingerprint.fingerprint(dir), base);
	});

	it('falls back to hashing a manifest it cannot parse', function () {
		const dir = project();
		const base = buildFingerprint.fingerprint(dir);
		fs.writeFileSync(path.join(dir, 'package.json'), '{ not json');
		assert.notStrictEqual(buildFingerprint.fingerprint(dir), base);
	});

	it('is stable across repeated calls', function () {
		const dir = project();
		assert.strictEqual(buildFingerprint.fingerprint(dir), buildFingerprint.fingerprint(dir));
	});
});

'use strict';

// Two halves of the same bug: a container left holding an older node_modules
// than the code it is running.
//
// /dojo/node_modules is an anonymous volume, and compose reuses an existing one
// when it recreates a container — only --renew-anon-volumes discards it. So an
// update that added a dependency rebuilt the image and then ran against the
// previous volume, with the GUI showing new code over the bind mount while the
// module it needed was absent.
//
// scripts/composeUp.js stops it happening again; bootstrap.missingDependencies()
// notices when it already has, which is what covers the update that DELIVERS the
// fix — that one is still performed by the old launcher.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { upArgs } = require('../../scripts/composeUp');
const { missingDependencies, installCommand, hasModules } = require('../../src/server/bootstrap');

function fixture(deps, installed) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-stale-'));
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: deps }));
	for (const name of installed) {
		const dir = path.join(root, 'node_modules', name);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: name, version: '1.0.0', main: 'index.js' }));
		fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {};');
	}
	return root;
}

describe('bringing the container up after a rebuild', function () {
	it('renews the anonymous volume when the image was just rebuilt', function () {
		const args = upArgs({ rebuilt: true });
		assert.ok(args.includes('--renew-anon-volumes'), 'a new image needs a new node_modules');
		// Without this, a container whose config and image id are unchanged is left
		// running and the renewal never happens.
		assert.ok(args.includes('--force-recreate'));
		assert.strictEqual(args[args.length - 1], 'ui');
	});

	it('leaves the volume alone when nothing was rebuilt', function () {
		// Re-seeding ~680 packages on every launch would be a needless cost; an
		// unchanged image means the volume already matches it.
		const args = upArgs({});
		assert.ok(!args.includes('--renew-anon-volumes'));
		assert.ok(!args.includes('--force-recreate'));
		assert.deepStrictEqual(args, ['compose', 'up', '-d', 'ui']);
	});

	it('can force a recreate without renewing the volume', function () {
		// The stuck-port recovery path in ui.js wants a new container, not a
		// reinstall.
		const args = upArgs({ forceRecreate: true });
		assert.ok(args.includes('--force-recreate'));
		assert.ok(!args.includes('--renew-anon-volumes'));
	});

	it('takes no arguments at all without throwing', function () {
		assert.deepStrictEqual(upArgs(), ['compose', 'up', '-d', 'ui']);
	});
});

describe('detecting a stale node_modules', function () {
	const made = [];
	after(function () { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
	function make(deps, installed) { const r = fixture(deps, installed); made.push(r); return r; }

	it('names a dependency the update added but the volume does not have', function () {
		const root = make({ alpha: '1.0.0', '@scope/beta': '2.0.0' }, ['alpha']);
		assert.deepStrictEqual(missingDependencies(root), ['@scope/beta']);
	});

	it('reports nothing when every dependency is present', function () {
		const root = make({ alpha: '1.0.0', '@scope/beta': '2.0.0' }, ['alpha', '@scope/beta']);
		assert.deepStrictEqual(missingDependencies(root), []);
	});

	it('reports nothing for a manifest with no dependencies', function () {
		const root = make({}, []);
		assert.deepStrictEqual(missingDependencies(root), []);
	});

	it('treats an installed package with a broken entry point as present', function () {
		// require.resolve fails on it, but it IS installed — reinstalling would not
		// help, and reporting it would put the GUI in a permanent install loop.
		const root = make({ alpha: '1.0.0' }, []);
		const dir = path.join(root, 'node_modules', 'alpha');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'alpha', main: 'nope.js' }));
		assert.deepStrictEqual(missingDependencies(root), []);
	});

	it('does not treat an unreadable manifest as a stale volume', function () {
		// No manifest is not evidence of anything; guessing "stale" here would
		// trigger an install nothing asked for.
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-stale-'));
		made.push(root);
		assert.deepStrictEqual(missingDependencies(root), []);
	});

	it('repairs an existing install with npm ci, not npm install', function () {
		// The case npm install cannot fix: every package present, but the engine
		// files carry ANOTHER version's patches. npm has no reason to replace a
		// package that is already there, so the old patched files survive and
		// postinstall then refuses them as an unexpected hash. Only deleting
		// node_modules and reinstalling from the lockfile gets back to pristine.
		const root = make({ alpha: '1.0.0' }, ['alpha']);
		fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
		assert.strictEqual(installCommand(root)[0], 'ci');
	});

	it('installs rather than ci when nothing is installed yet', function () {
		// A genuine first run has nothing to delete, and npm ci on an empty tree
		// buys nothing over install.
		const root = make({ alpha: '1.0.0' }, []);
		fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
		assert.strictEqual(installCommand(root)[0], 'install');
	});

	it('falls back to install when there is no lockfile to ci from', function () {
		const root = make({ alpha: '1.0.0' }, ['alpha']);
		assert.strictEqual(installCommand(root)[0], 'install');
	});

	it('knows whether anything is installed at all', function () {
		assert.strictEqual(hasModules(make({}, ['alpha'])), true);
		assert.strictEqual(hasModules(make({}, [])), false);
	});

	it('ignores devDependencies', function () {
		// Installing with --omit=dev is legitimate and nothing the server does
		// needs them.
		const root = make({}, []);
		const manifest = { dependencies: {}, devDependencies: { mocha: '1.0.0' } };
		fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
		assert.deepStrictEqual(missingDependencies(root), []);
	});
});

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const installer = require('../../tools/mockEnginePatches.cjs');

function sha(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-patches-'));
	const packageRoot = path.join(root, 'fixture-package');
	fs.mkdirSync(path.join(packageRoot, 'lib'), { recursive: true });
	fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'fixture-package', version: '1.2.3' }));
	fs.writeFileSync(path.join(packageRoot, 'lib/value.js'), "module.exports = 'old';\n");
	fs.mkdirSync(path.join(root, 'patches'), { recursive: true });
	fs.writeFileSync(path.join(root, 'patches/value.patch'), [
		'--- a/lib/value.js',
		'+++ b/lib/value.js',
		'@@ -1 +1 @@',
		"-module.exports = 'old';",
		"+module.exports = 'new';",
		''
	].join('\n'));
	fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
	fs.writeFileSync(path.join(root, 'assets/copied.js'), "module.exports = 'copied';\n");
	const manifest = {
		schemaVersion: 1,
		packages: { 'fixture-package': '1.2.3' },
		operations: [
			{
				type: 'patch', package: 'fixture-package', patch: 'patches/value.patch',
				targets: [{
					path: 'lib/value.js',
					pristineSha256: sha("module.exports = 'old';\n"),
					patchedSha256: sha("module.exports = 'new';\n")
				}]
			},
			{
				type: 'copy', package: 'fixture-package', source: 'assets/copied.js', target: 'lib/copied.js',
				pristineSha256: null, patchedSha256: sha("module.exports = 'copied';\n")
			}
		]
	};
	const manifestPath = path.join(root, 'manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	return {
		root: root,
		packageRoot: packageRoot,
		manifestPath: manifestPath,
		options: { repoRoot: root, manifestPath: manifestPath, packageRoots: { 'fixture-package': packageRoot } }
	};
}

describe('mock engine patch installer', function () {
	let current;
	afterEach(function () {
		if (current) fs.rmSync(current.root, { recursive: true, force: true });
		current = null;
	});

	it('applies pristine targets and is idempotent', function () {
		current = fixture();
		const first = installer.run('apply', current.options);
		assert.strictEqual(first.changed, 2);
		assert.strictEqual(fs.readFileSync(path.join(current.packageRoot, 'lib/value.js'), 'utf8'), "module.exports = 'new';\n");
		assert.strictEqual(fs.readFileSync(path.join(current.packageRoot, 'lib/copied.js'), 'utf8'), "module.exports = 'copied';\n");
		const second = installer.run('apply', current.options);
		assert.strictEqual(second.changed, 0);
		assert.strictEqual(second.verified, 2);
	});

	it('checks a patched set without changing it', function () {
		current = fixture();
		installer.run('apply', current.options);
		const result = installer.run('check', current.options);
		assert.deepStrictEqual(result, { mode: 'check', changed: 0, verified: 2, snapshotRegenerated: false });
	});

	it('rejects an unknown hash before changing any target', function () {
		current = fixture();
		fs.writeFileSync(path.join(current.packageRoot, 'lib/value.js'), "module.exports = 'local edit';\n");
		assert.throws(function () { installer.run('apply', current.options); }, /Unexpected hash.*lib\/value\.js/);
		assert.strictEqual(fs.readFileSync(path.join(current.packageRoot, 'lib/value.js'), 'utf8'), "module.exports = 'local edit';\n");
		assert.strictEqual(fs.existsSync(path.join(current.packageRoot, 'lib/copied.js')), false);
	});

	it('rejects the wrong package version', function () {
		current = fixture();
		fs.writeFileSync(path.join(current.packageRoot, 'package.json'), JSON.stringify({ name: 'fixture-package', version: '9.9.9' }));
		assert.throws(function () { installer.run('apply', current.options); }, /fixture-package version 9\.9\.9; expected 1\.2\.3/);
	});

	it('check mode rejects pristine targets', function () {
		current = fixture();
		assert.throws(function () { installer.run('check', current.options); }, /Patch set is not installed/);
		assert.strictEqual(fs.readFileSync(path.join(current.packageRoot, 'lib/value.js'), 'utf8'), "module.exports = 'old';\n");
	});
});

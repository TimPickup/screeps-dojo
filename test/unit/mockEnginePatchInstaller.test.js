'use strict';

const assert = require('assert');
const childProcess = require('child_process');
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
		assert.deepStrictEqual(result, { mode: 'check', changed: 0, verified: 2, snapshotRegenerated: false, normalised: [] });
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

	// `npm ci` on a plain checkout leaves node_modules inside the repository.
	// Only the compose volume mount and the image build ever put it outside one,
	// which is why this went unseen: in a work tree, `git apply` reads the
	// git-style header below as repository-relative, skips it for falling
	// outside the package prefix, and still exits 0.
	it('applies a git-style patch with the package inside a git work tree', function () {
		current = fixture();
		fs.writeFileSync(path.join(current.root, 'patches/value.patch'), [
			'diff --git a/lib/value.js b/lib/value.js',
			'--- a/lib/value.js',
			'+++ b/lib/value.js',
			'@@ -1 +1 @@',
			"-module.exports = 'old';",
			"+module.exports = 'new';",
			''
		].join('\n'));
		childProcess.execFileSync('git', ['init', '-q', '.'], { cwd: current.root });
		assert.ok(fs.existsSync(path.join(current.root, '.git')), 'fixture must be a work tree');

		const result = installer.run('apply', current.options);

		assert.strictEqual(result.changed, 2);
		assert.strictEqual(
			fs.readFileSync(path.join(current.packageRoot, 'lib/value.js'), 'utf8'),
			"module.exports = 'new';\n"
		);
	});
});

// The manifest pins a sha256 over the RAW BYTES of every file it applies or
// copies, so a checkout that rewrote line endings breaks the install — and
// core.autocrlf=true is the git for Windows default, so that is a normal clone
// there, not an exotic one. LF is what the manifest hashed and what the Linux
// container needs, so normalising CRLF back out is a repair the pinned hash
// then proves correct. Anything else is a real difference and must still stop.
describe('mock engine patch installer line endings', function () {
	let current;
	afterEach(function () {
		if (current) fs.rmSync(current.root, { recursive: true, force: true });
		current = null;
	});

	function toCrlf(filename) {
		fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace(/\n/g, '\r\n'));
	}

	it('installs a copy source that was checked out with CRLF', function () {
		current = fixture();
		toCrlf(path.join(current.root, 'assets/copied.js'));

		const result = installer.run('apply', current.options);

		assert.strictEqual(result.changed, 2);
		assert.deepStrictEqual(result.normalised, ['assets/copied.js']);
		assert.strictEqual(
			fs.readFileSync(path.join(current.packageRoot, 'lib/copied.js'), 'utf8'),
			"module.exports = 'copied';\n"
		);
		assert.deepStrictEqual(installer.run('check', current.options).verified, 2);
	});

	it('applies a patch file that was checked out with CRLF', function () {
		current = fixture();
		toCrlf(path.join(current.root, 'patches/value.patch'));

		const result = installer.run('apply', current.options);

		assert.strictEqual(result.changed, 2);
		assert.deepStrictEqual(result.normalised, ['patches/value.patch']);
		assert.strictEqual(
			fs.readFileSync(path.join(current.packageRoot, 'lib/value.js'), 'utf8'),
			"module.exports = 'new';\n"
		);
	});

	it('reports nothing normalised for an ordinary LF checkout', function () {
		current = fixture();
		assert.deepStrictEqual(installer.run('apply', current.options).normalised, []);
	});

	it('still refuses a copy source whose content really differs', function () {
		current = fixture();
		fs.writeFileSync(path.join(current.root, 'assets/copied.js'), "module.exports = 'tampered';\r\n");

		assert.throws(function () { installer.run('apply', current.options); }, /Copy source hash mismatch/);
		assert.strictEqual(fs.existsSync(path.join(current.packageRoot, 'lib/copied.js')), false);
	});
});

// .gitattributes is the only fix that needs nothing of the person cloning. It
// has to cover every byte-hashed file, not just *.patch: lib/dojo-features.js
// was missed for two releases and broke every default Windows clone.
describe('mock engine patch sources survive a Windows checkout', function () {
	it('marks every byte-hashed manifest source -text in .gitattributes', function () {
		const repoRoot = path.resolve(__dirname, '../..');
		const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'server-mock-patches/manifest.json'), 'utf8'));
		const sources = manifest.operations.map(function (operation) { return operation.patch || operation.source; });
		assert.ok(sources.length > 1, 'manifest should list sources to check');
		for (const source of sources) {
			const attr = childProcess.execFileSync('git', ['check-attr', 'text', '--', source], {
				cwd: repoRoot,
				encoding: 'utf8'
			}).trim();
			assert.ok(/: text: unset$/.test(attr), source + ' is not held byte-exact by .gitattributes: ' + attr);
		}
	});
});

#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(DEFAULT_REPO_ROOT, 'server-mock-patches', 'manifest.json');

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function readHash(filename) {
	return fs.existsSync(filename) ? sha256(fs.readFileSync(filename)) : null;
}

function resolvePackageRoot(name, repoRoot, explicitRoots) {
	if (explicitRoots && explicitRoots[name]) return explicitRoots[name];
	return path.dirname(require.resolve(name + '/package.json', { paths: [repoRoot] }));
}

function loadContext(options) {
	options = options || {};
	const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
	const manifestPath = path.resolve(options.manifestPath || DEFAULT_MANIFEST);
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	if (manifest.schemaVersion !== 1) throw new Error('Unsupported mock engine patch manifest schema: ' + manifest.schemaVersion);
	const roots = {};
	for (const name of Object.keys(manifest.packages)) {
		const root = resolvePackageRoot(name, repoRoot, options.packageRoots);
		const actual = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
		const expected = manifest.packages[name];
		if (actual !== expected) throw new Error(name + ' version ' + actual + '; expected ' + expected);
		roots[name] = root;
	}
	return { repoRoot: repoRoot, manifestPath: manifestPath, manifest: manifest, roots: roots };
}

function targetState(targetPath, target) {
	const actual = readHash(targetPath);
	if (actual === target.patchedSha256) return 'patched';
	if (actual === target.pristineSha256) return 'pristine';
	// Refusing to write over a file we do not recognise is the point — but the
	// commonest cause is a node_modules that still holds a PREVIOUS revision of
	// one of these patches (an existing container's volume after the patch set
	// changed), and `npm install` will not replace it. Say so: without this the
	// failure is a hash and a dead end.
	throw new Error('Unexpected hash for ' + targetPath + ': ' + (actual || '<missing>')
		+ '\n  This file is neither pristine nor patched by the CURRENT patch set — most often'
		+ '\n  a node_modules left over from an older revision of it. Reinstall the dependency'
		+ '\n  tree rather than patching over it: `npm ci` here, or, for the container,'
		+ '\n  `npm run ui:down && npm run ui` (which re-seeds node_modules from the image).');
}

function inspectOperations(context) {
	return context.manifest.operations.map(function (operation) {
		const packageRoot = context.roots[operation.package];
		if (!packageRoot) throw new Error('Manifest operation references unknown package: ' + operation.package);
		if (operation.type === 'patch') {
			const targets = operation.targets.map(function (target) {
				const filename = path.join(packageRoot, target.path);
				return { definition: target, filename: filename, state: targetState(filename, target) };
			});
			const states = new Set(targets.map(function (target) { return target.state; }));
			if (states.size > 1) throw new Error('Patch operation is partially installed: ' + operation.patch);
			return {
				definition: operation,
				packageRoot: packageRoot,
				patchPath: path.resolve(context.repoRoot, operation.patch),
				targets: targets,
				state: targets[0].state
			};
		}
		if (operation.type === 'copy') {
			const filename = path.join(packageRoot, operation.target);
			return {
				definition: operation,
				packageRoot: packageRoot,
				sourcePath: path.resolve(context.repoRoot, operation.source),
				targets: [{
					definition: { path: operation.target, pristineSha256: operation.pristineSha256, patchedSha256: operation.patchedSha256 },
					filename: filename,
					state: targetState(filename, operation)
				}],
				state: targetState(filename, operation)
			};
		}
		throw new Error('Unknown manifest operation type: ' + operation.type);
	});
}

// `git apply` behaves differently depending on whether it finds a repository
// above the directory it runs in. Inside a work tree it reads a git-style diff
// header (`diff --git a/x b/x`) as repository-relative, and silently skips any
// path that falls outside the current directory's prefix — printing "Skipped
// patch" and exiting 0, which is indistinguishable from success here.
//
// Nothing hit that until node_modules lived inside a work tree: the compose
// volume is a separate mount, so git stops at the filesystem boundary, and the
// image build has no .git at all. A plain `npm ci` on a checkout — CI, or
// anyone installing outside the container — is inside one. Stop the repository
// search above the package so the patch is applied to the files on disk
// wherever it runs.
function gitApplyEnv(packageRoot) {
	const env = Object.assign({}, process.env);
	// The search starts at the package and walks up; the ceiling has to be the
	// directory above it, not the package itself.
	env.GIT_CEILING_DIRECTORIES = path.dirname(packageRoot);
	return env;
}

// The patch is fed on stdin rather than by path so it can be normalised first
// (see normaliseEol): a patch checked out with CRLF carries a trailing \r on
// every context line, matches nothing, and fails as "patch does not apply" —
// which reads like a stale patch set rather than a checkout artefact. An LF
// patch passes through byte for byte, so this is only ever a repair.
function runPatch(operation, dryRun) {
	const raw = fs.readFileSync(operation.patchPath);
	const patch = normaliseEol(raw);
	const args = ['apply', '--recount'];
	if (dryRun) args.push('--check');
	args.push('-');
	const result = childProcess.spawnSync('git', args, {
		cwd: operation.packageRoot,
		encoding: 'utf8',
		input: patch,
		env: gitApplyEnv(operation.packageRoot)
	});
	if (result.status !== 0) {
		throw new Error('Patch failed: ' + operation.definition.patch + '\n' + (result.stdout || '') + (result.stderr || ''));
	}
	return !patch.equals(raw);
}

function regenerateSnapshot(context) {
	const snapshot = context.manifest.snapshot;
	if (!snapshot) return false;
	const root = context.roots[snapshot.package];
	const source = path.join(root, snapshot.source);
	const output = path.join(root, snapshot.output);
	const stamp = path.join(root, snapshot.stamp);
	const sourceHash = readHash(source);
	const stampedHash = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
	if (sourceHash === stampedHash && fs.existsSync(output) && fs.statSync(output).size > 0) return false;
	const generator = path.join(root, snapshot.generator);
	const result = childProcess.spawnSync(process.execPath, ['--no-node-snapshot', generator], { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) throw new Error('Runtime snapshot generation failed:\n' + (result.stdout || '') + (result.stderr || ''));
	if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('Runtime snapshot was not generated: ' + output);
	fs.writeFileSync(stamp, sourceHash + '\n');
	return true;
}

function verifySnapshot(context) {
	const snapshot = context.manifest.snapshot;
	if (!snapshot) return;
	const root = context.roots[snapshot.package];
	const sourceHash = readHash(path.join(root, snapshot.source));
	const stampPath = path.join(root, snapshot.stamp);
	const output = path.join(root, snapshot.output);
	const stampedHash = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8').trim() : '';
	if (sourceHash !== stampedHash) throw new Error('Runtime snapshot is stale for ' + snapshot.package);
	if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('Runtime snapshot is missing for ' + snapshot.package);
}

// Every file this installs comes out of the repository, and the manifest pins a
// sha256 over its RAW BYTES. A checkout that rewrote line endings therefore
// breaks the install — and core.autocrlf=true is the default git for Windows
// installs, so that is an ordinary clone there, not an exotic one.
//
// .gitattributes holds server-mock-patches/ byte-exact so a fresh clone is
// right to begin with, but it only applies at checkout: a clone taken before it
// landed keeps the rewritten copy, and `git pull` does not re-check-out a file
// that did not otherwise change. Rather than send people through
// `git rm --cached -r . && git reset --hard`, repair it here. LF is what the
// manifest hashed and what the Linux container needs, so stripping the CR back
// out is the one difference we can correct rather than refuse — and the pinned
// hash, checked after, is what proves the correction right. Anything else is a
// real difference and still stops the install.
function normaliseEol(content) {
	// latin1 round-trips every byte, so this rewrites bytes and not decoded text.
	return Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

// Returns the bytes to copy, and whether they had to be repaired to get there.
function readCopySource(operation) {
	const expected = operation.definition.patchedSha256;
	if (!fs.existsSync(operation.sourcePath)) throw new Error('Copy source is missing: ' + operation.sourcePath);
	const content = fs.readFileSync(operation.sourcePath);
	if (sha256(content) === expected) return { content: content, normalised: false };
	const normalised = normaliseEol(content);
	if (sha256(normalised) === expected) return { content: normalised, normalised: true };
	throw new Error('Copy source hash mismatch: ' + operation.sourcePath);
}

function run(mode, options) {
	if (mode !== 'apply' && mode !== 'check') throw new Error('Usage: mockEnginePatches.cjs <apply|check> [--json]');
	const context = loadContext(options);
	const operations = inspectOperations(context);
	if (mode === 'check') {
		const unpatched = operations.filter(function (operation) { return operation.state !== 'patched'; });
		if (unpatched.length) throw new Error('Patch set is not installed: ' + unpatched.map(function (op) {
			return op.definition.patch || op.definition.target;
		}).join(', '));
		verifySnapshot(context);
		return { mode: mode, changed: 0, verified: operations.length, snapshotRegenerated: false, normalised: [] };
	}

	const pending = operations.filter(function (operation) { return operation.state === 'pristine'; });
	// The dry run is also where a line-ending repair is discovered, so record what
	// needed one and report it: silently correcting the checkout would hide a
	// clone that is worth fixing at source.
	const normalised = [];
	const sources = new Map();
	for (const operation of pending) {
		if (operation.definition.type === 'patch') {
			if (runPatch(operation, true)) normalised.push(operation.definition.patch);
		} else {
			const source = readCopySource(operation);
			sources.set(operation, source.content);
			if (source.normalised) normalised.push(operation.definition.source);
		}
	}

	const backups = new Map();
	for (const operation of pending) {
		for (const target of operation.targets) {
			backups.set(target.filename, fs.existsSync(target.filename) ? fs.readFileSync(target.filename) : null);
		}
	}
	let snapshotRegenerated = false;
	try {
		for (const operation of pending) {
			if (operation.definition.type === 'patch') runPatch(operation, false);
			else {
				fs.mkdirSync(path.dirname(operation.targets[0].filename), { recursive: true });
				fs.writeFileSync(operation.targets[0].filename, sources.get(operation));
			}
		}
		const verified = inspectOperations(context);
		if (verified.some(function (operation) { return operation.state !== 'patched'; })) {
			throw new Error('Patch verification failed after apply');
		}
		snapshotRegenerated = regenerateSnapshot(context);
		verifySnapshot(context);
	} catch (error) {
		for (const [filename, content] of backups) {
			if (content === null) fs.rmSync(filename, { force: true });
			else fs.writeFileSync(filename, content);
		}
		throw error;
	}
	return {
		mode: mode,
		changed: pending.length,
		verified: operations.length,
		snapshotRegenerated: snapshotRegenerated,
		normalised: normalised
	};
}

function main() {
	const mode = process.argv[2];
	const json = process.argv.indexOf('--json') !== -1;
	try {
		const result = run(mode);
		if (json) process.stdout.write(JSON.stringify({ ok: true, result: result }) + '\n');
		else {
			console.log('[dojo] mock engine patches: ' + result.verified + ' verified, ' + result.changed + ' changed'
				+ (result.snapshotRegenerated ? ', runtime snapshot regenerated' : ''));
			// Worth saying out loud rather than repairing in silence: the install is
			// fine, but the checkout it came from is not, and every other file read
			// from that clone carries the same rewrite.
			if (result.normalised.length) {
				console.log('[dojo] repaired CRLF line endings in ' + result.normalised.length + ' repository file(s): '
					+ result.normalised.join(', ')
					+ '\n[dojo] this checkout was taken with core.autocrlf=true, before .gitattributes held'
					+ '\n[dojo] these files byte for byte. Nothing to do; to clear it at source, re-clone.');
			}
		}
	} catch (error) {
		if (json) process.stdout.write(JSON.stringify({ ok: false, error: String(error.message || error) }) + '\n');
		else console.error('[dojo] mock engine patches failed:', error.message || error);
		process.exitCode = 1;
	}
}

module.exports = { run: run, sha256: sha256 };

if (require.main === module) main();

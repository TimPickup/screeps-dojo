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
	throw new Error('Unexpected hash for ' + targetPath + ': ' + (actual || '<missing>'));
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

function runPatch(operation, dryRun) {
	const args = ['apply', '--recount'];
	if (dryRun) args.push('--check');
	args.push(operation.patchPath);
	const result = childProcess.spawnSync('git', args, { cwd: operation.packageRoot, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error('Patch failed: ' + operation.definition.patch + '\n' + (result.stdout || '') + (result.stderr || ''));
	}
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
		return { mode: mode, changed: 0, verified: operations.length, snapshotRegenerated: false };
	}

	const pending = operations.filter(function (operation) { return operation.state === 'pristine'; });
	for (const operation of pending) {
		if (operation.definition.type === 'patch') runPatch(operation, true);
		else if (readHash(operation.sourcePath) !== operation.definition.patchedSha256) {
			throw new Error('Copy source hash mismatch: ' + operation.sourcePath);
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
				fs.copyFileSync(operation.sourcePath, operation.targets[0].filename);
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
	return { mode: mode, changed: pending.length, verified: operations.length, snapshotRegenerated: snapshotRegenerated };
}

function main() {
	const mode = process.argv[2];
	const json = process.argv.indexOf('--json') !== -1;
	try {
		const result = run(mode);
		if (json) process.stdout.write(JSON.stringify({ ok: true, result: result }) + '\n');
		else console.log('[dojo] mock engine patches: ' + result.verified + ' verified, ' + result.changed + ' changed'
			+ (result.snapshotRegenerated ? ', runtime snapshot regenerated' : ''));
	} catch (error) {
		if (json) process.stdout.write(JSON.stringify({ ok: false, error: String(error.message || error) }) + '\n');
		else console.error('[dojo] mock engine patches failed:', error.message || error);
		process.exitCode = 1;
	}
}

module.exports = { run: run, sha256: sha256 };

if (require.main === module) main();

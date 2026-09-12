'use strict';

// Bumps the project version. The ONLY supported way to do it.
//
//   npm run release -- 0.13.0
//
// Why this exists: package-lock.json carries a "version" field for every
// dependency, and a find/replace of the old version string across the file
// will happily rewrite one of those instead — silently producing a lockfile
// whose dependency version no longer matches its own resolved URL and
// integrity hash. That has happened here, more than once. This repo's
// auto-update check reads package.json off main, so a release commit is what
// every other user pulls; a corrupted lockfile breaks their `npm ci` after the
// release, not before it.
//
// `npm version --no-git-tag-version` touches exactly the two project-level
// fields and nothing else. This wraps it, then VERIFIES that claim against the
// resulting diff rather than trusting it, and refuses to leave a bad bump in
// the tree.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

function fail(message) {
	console.error('[release] ' + message);
	process.exit(1);
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
}

function git(args) {
	const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
	if (result.status !== 0) return null;
	return result.stdout;
}

// Every changed line in the two manifests must be one of the project's own
// two "version" fields. A '+' or '-' line anywhere else — a dependency's
// version, a resolved URL, an integrity hash — means the bump went wrong.
// `diffText` is for the tests; leave it off and the working tree is read.
function offendingDiffLines(diffText) {
	const diff = arguments.length === 0
		? git(['diff', '--unified=0', '--', 'package.json', 'package-lock.json'])
		: diffText;
	if (diff === null) return null; // not a git repo, or git unavailable
	const bad = [];
	for (const line of diff.split('\n')) {
		if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
		if (/^[+-]\s*"version":\s*"[^"]+",?\s*$/.test(line)) continue;
		bad.push(line);
	}
	return bad;
}

function main(argv) {
	const version = (argv[0] || '').replace(/^v/, '').trim();
	if (!SEMVER.test(version)) {
		fail('usage: npm run release -- <version>   e.g. npm run release -- 0.13.0');
	}

	const current = readJson('package.json').version;
	if (current === version) fail('package.json is already ' + version);

	const dirtyBefore = git(['status', '--porcelain', '--', 'package.json', 'package-lock.json']);
	if (dirtyBefore === null) {
		console.log('[release] not a git checkout — bumping without the diff check');
	} else if (dirtyBefore.trim()) {
		fail('package.json / package-lock.json already have uncommitted changes — '
			+ 'commit or stash them so the bump can be checked on its own');
	}

	console.log('[release] ' + current + ' -> ' + version);
	try {
		// npm's own bump: it understands the lockfile's structure, so it edits
		// the root version and packages[""].version and leaves every dependency
		// alone. Never replicate this by hand.
		execFileSync('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'],
			{ cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
	} catch (e) {
		fail('npm version failed: ' + String((e && e.message) || e));
	}

	const bad = offendingDiffLines();
	if (bad && bad.length) {
		console.error('[release] the bump touched lines it had no business touching:');
		for (const line of bad.slice(0, 20)) console.error('    ' + line);
		fail('reverting is on you: git checkout -- package.json package-lock.json');
	}

	const after = readJson('package.json').version;
	const lock = readJson('package-lock.json');
	if (after !== version) fail('package.json says ' + after + ' after the bump');
	if (lock.version !== version || (lock.packages && lock.packages[''] && lock.packages[''].version !== version)) {
		fail('package-lock.json was not updated to ' + version);
	}

	console.log('[release] package.json and package-lock.json are at ' + version + ', and nothing else changed.');
	console.log('[release] next: move the CHANGELOG\'s [Unreleased] section under ## [' + version + '], then commit both.');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { offendingDiffLines: offendingDiffLines, SEMVER: SEMVER };

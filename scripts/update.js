'use strict';

// Host launcher: `npm run update`. One command to take a new dojo version.
// Node built-ins only.
//
//   1. git pull --ff-only         (source is bind-mounted, so this is the update)
//   2. npm run build:ui           (ui/dist is git-ignored and stale after a pull)
//   3. docker compose build       (node_modules is baked into the image)
//   4. restart the GUI container  (only if it was already running)
//
// Steps 2-4 are cheap when nothing changed, so running this when you are
// already current costs a few seconds and changes nothing. It refuses to touch
// a dirty tree: a failed merge halfway through an update is worse than no
// update, and your scenarios/ workspace is git-ignored so a clean tree is the
// normal case.
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

function run(cmd, args, opts) {
	return spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: isWin, cwd: ROOT }, opts || {}));
}
function out(cmd, args) {
	const r = spawnSync(cmd, args, { encoding: 'utf8', shell: isWin, cwd: ROOT });
	return ((r.stdout || '') + (r.stderr || '')).trim();
}
function say(msg) { console.log('[dojo-update] ' + msg); }
function fail(msg) { console.error('\n[dojo-update] ' + msg); process.exit(1); }

function version() {
	try {
		delete require.cache[require.resolve(path.join(ROOT, 'package.json'))];
		return require(path.join(ROOT, 'package.json')).version;
	} catch (e) { return '?'; }
}

if (run('git', ['--version'], { stdio: 'ignore' }).status !== 0) {
	fail('git not found on PATH — update manually, or install git.');
}
if (out('git', ['rev-parse', '--is-inside-work-tree']) !== 'true') {
	fail('not a git checkout — nothing to pull. Download the latest release instead.');
}

const dirty = out('git', ['status', '--porcelain', '--untracked-files=no']);
if (dirty) {
	console.error('[dojo-update] you have uncommitted changes to tracked files:');
	console.error(dirty.split('\n').slice(0, 10).map(function (l) { return '    ' + l; }).join('\n'));
	fail('commit or stash them first — refusing to pull onto a dirty tree.');
}

const before = out('git', ['rev-parse', 'HEAD']);
const wasRunning = /\bui\b/.test(out('docker', ['compose', 'ps', '--services', '--filter', 'status=running']));

say('pulling…');
if (run('git', ['pull', '--ff-only']).status !== 0) {
	fail('git pull failed. Resolve it by hand (a diverged branch needs a merge or rebase).');
}

if (out('git', ['rev-parse', 'HEAD']) === before) {
	say('already up to date (v' + version() + ') — nothing to rebuild.');
	process.exit(0);
}

say('rebuilding the web UI…');
if (run('npm', ['run', 'build:ui']).status !== 0) fail('UI build failed.');

say('rebuilding the container image (cached unless dependencies changed)…');
if (run('docker', ['compose', 'build']).status !== 0) fail('image build failed.');

if (wasRunning) {
	say('restarting the GUI so it runs the new code…');
	if (run('docker', ['compose', 'up', '-d', '--force-recreate', 'ui']).status !== 0) {
		fail('could not restart the GUI container — start it with: npm run ui');
	}
}

say('now on v' + version() + (wasRunning ? ' — GUI restarted.' : '.'));
say('what changed: https://github.com/TimPickup/screeps-dojo/releases');

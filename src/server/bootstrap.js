'use strict';

// First-run install, decoupled from the browser. Built-ins only. If the
// toolchain (screeps-server-mockup) isn't in the volume yet, spawn `npm install`
// as a child writing to server/install.log and stream it to the welcome screen.
// Because the install is a child of this long-lived process and writes to a
// file, closing the browser tab never interrupts it — a reopened tab re-tails
// the log. Dep-needing routes stay gated on state==='ready'.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const progressHeartbeat = require('../progressHeartbeat');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LOG_DIR = path.join(REPO_ROOT, 'server');
const LOG_FILE = path.join(LOG_DIR, 'install.log');

// reason distinguishes the two ways this screen appears: a genuine first-run
// install, and a repair of a container holding an older node_modules than the
// code it runs. The copy is not interchangeable — telling someone mid-project
// that this is their "first run" reads as though something was lost.
const state = { phase: 'ready', reason: null, subscribers: new Set() };

// Anything at all installed. Distinguishes "nothing here yet" from "here, but
// belonging to a different version" — which need different repairs, not just
// different words.
function hasModules(root) {
	try { return fs.readdirSync(path.join(root || REPO_ROOT, 'node_modules')).length > 0; }
	catch (e) { return false; }
}

// What to run to get from the current state to a working one.
//
// `npm install` is enough when packages are merely ABSENT: it fetches what is
// missing and leaves the rest alone. It cannot fix a node_modules carrying
// another version's ENGINE PATCHES, and leaving the rest alone is precisely why
// — the mock-engine files are already present, so npm has no reason to replace
// them, they stay patched by the old patch set, and `postinstall` then refuses
// with "Unexpected hash" because they match neither the pristine nor the patched
// checksum this revision expects. The install fails and the screen says so.
//
// `npm ci` deletes node_modules outright and reinstalls from the lockfile, which
// is the only thing that gets back to pristine files the current patch set can
// apply to. It costs a full reinstall including the native compiles, so it is
// used only when something is actually installed and wrong.
function installCommand(root) {
	const base = root || REPO_ROOT;   // a root only for the tests
	// --foreground-scripts streams the native builds, as the Dockerfile does. They
	// are the slow part, and without it they are also the SILENT part: npm's own
	// output stops for minutes and the screen looks dead. --loglevel=error drops
	// the deprecation warnings, none of which are actionable and the last of which
	// would otherwise be left sitting on screen as the apparent cause.
	const flags = ['--no-audit', '--no-fund', '--foreground-scripts', '--loglevel=error'];
	const hasLock = fs.existsSync(path.join(base, 'package-lock.json'));
	if (hasModules(base) && hasLock) return ['ci'].concat(flags);
	return ['install'].concat(flags);
}

// "Installed" means the engine toolchain actually RESOLVES — not merely that a
// node_modules/screeps-server-mockup directory exists. A git-dependency install
// that was interrupted leaves the directory behind without the package's files,
// which would otherwise be reported as ready and then crash every run-child with
// "Cannot find module 'screeps-server-mockup'".
function isInstalled() {
	try {
		require.resolve('screeps-server-mockup', { paths: [REPO_ROOT] });
		require('../../tools/mockEnginePatches.cjs').run('check', { repoRoot: REPO_ROOT });
		return missingDependencies().length === 0;
	}
	catch (e) { return false; }
}

// Every runtime dependency package.json declares, that does not resolve.
//
// This catches a node_modules that is populated but STALE. /dojo/node_modules is
// an anonymous volume, and compose reuses an existing one when it recreates a
// container — it is only discarded by --renew-anon-volumes. So an update that
// added a dependency would rebuild the image correctly and then run against the
// previous volume, indefinitely. Resolving the toolchain alone cannot see that:
// the old volume has screeps-server-mockup, it just does not have whatever the
// update added.
//
// Launchers pass --renew-anon-volumes now (scripts/composeUp.js), but that only
// helps from the release AFTER the one a user is on: the update that delivers
// the fix is itself performed by the old launcher. Detecting it here closes that
// gap, because the server runs from the bind-mounted source and so is always the
// version just pulled.
//
// devDependencies are deliberately not checked — an install with --omit=dev is a
// legitimate way to run this, and nothing the server does needs them.
function missingDependencies(root) {
	const base = root || REPO_ROOT;   // a root only for the tests; production uses REPO_ROOT
	let names;
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
		names = Object.keys(manifest.dependencies || {});
	} catch (e) {
		return [];   // unreadable manifest is not evidence of a stale volume
	}
	const missing = [];
	for (const name of names) {
		try { require.resolve(name, { paths: [base] }); }
		catch (e) {
			// A package with no main/exports entry point still installs and is still
			// present; only a genuinely absent one counts.
			if (e && e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') continue;
			if (!fs.existsSync(path.join(base, 'node_modules', name, 'package.json'))) missing.push(name);
		}
	}
	return missing;
}

function broadcast(evt) {
	for (const sink of state.subscribers) { try { sink(evt); } catch (e) { /* ignore */ } }
}

// Returns { ready: boolean }. When not installed, kicks off the install and
// flips to ready when it finishes (or 'failed').
function start() {
	if (isInstalled()) { state.phase = 'ready'; return { ready: true }; }
	state.phase = 'installing';
	try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
	// Say which of the two this is. A repair is the confusing one: the GUI reads
	// its source over the bind mount, so the user is looking at new code and has
	// no reason to suspect the container is holding old modules.
	//
	// Anything already installed makes this a repair, not a first run — including
	// the case where every package is present and it is the ENGINE PATCHES that
	// belong to another version. That one reports no missing dependencies at all,
	// so it cannot be detected by counting them.
	const missing = missingDependencies();
	const args = installCommand();
	state.reason = hasModules() ? 'repair' : 'install';
	const banner = state.reason === 'repair'
		? '[dojo] this container is holding the installed packages of a previous version,\n'
		+ '[dojo] not the code you just updated to.\n'
		+ (missing.length ? '[dojo] missing: ' + missing.join(', ') + '\n' : '[dojo] the engine patches belong to a different revision.\n')
		+ '[dojo] ' + (args[0] === 'ci' ? 'Reinstalling from the lockfile' : 'Installing what is absent')
		+ ' — a few minutes, once. Your scenarios\n'
		+ '[dojo] and recordings are untouched, and the GUI carries on by itself after.\n'
		: '[dojo] installing toolchain (first run, a few minutes)…\n';
	fs.writeFileSync(LOG_FILE, banner);
	const child = spawn('npm', args, { cwd: REPO_ROOT, shell: process.platform === 'win32' });
	function write(text) {
		try { fs.appendFileSync(LOG_FILE, text); } catch (e) { /* ignore */ }
		broadcast({ type: 'log', line: text });
	}
	// Say something while npm says nothing. The compiles in here run silent for
	// minutes, and the last line before the silence is one of npm's deprecation
	// warnings — so a healthy install reads as having died on that warning. This
	// is the same heartbeat the host agent streams into a rebuild.
	const heartbeat = progressHeartbeat.startHeartbeat(write);
	function append(chunk) {
		heartbeat.bump();
		write(chunk.toString());
	}
	child.stdout.on('data', append);
	child.stderr.on('data', append);
	child.on('close', function (code) {
		heartbeat.stop();
		if (code === 0 && isInstalled()) { state.phase = 'ready'; broadcast({ type: 'ready' }); }
		else { state.phase = 'failed'; broadcast({ type: 'failed', code: code }); }
	});
	child.on('error', function (err) { heartbeat.stop(); state.phase = 'failed'; broadcast({ type: 'failed', error: String(err.message || err) }); });
	return { ready: false };
}

function getPhase() { return state.phase; }
function getReason() { return state.reason; }
function readLog() { try { return fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : ''; } catch (e) { return ''; } }
function subscribe(sink) { state.subscribers.add(sink); return function () { state.subscribers.delete(sink); }; }

module.exports = { start: start, getPhase: getPhase, readLog: readLog, subscribe: subscribe, isInstalled: isInstalled, missingDependencies: missingDependencies, getReason: getReason,
	installCommand: installCommand, hasModules: hasModules };

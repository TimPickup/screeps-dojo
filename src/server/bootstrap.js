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

const REPO_ROOT = path.join(__dirname, '..', '..');
const LOG_DIR = path.join(REPO_ROOT, 'server');
const LOG_FILE = path.join(LOG_DIR, 'install.log');

const state = { phase: 'ready', subscribers: new Set() };

// "Installed" means the engine toolchain actually RESOLVES — not merely that a
// node_modules/screeps-server-mockup directory exists. A git-dependency install
// that was interrupted leaves the directory behind without the package's files,
// which would otherwise be reported as ready and then crash every run-child with
// "Cannot find module 'screeps-server-mockup'".
function isInstalled() {
	try {
		require.resolve('screeps-server-mockup', { paths: [REPO_ROOT] });
		require('../../tools/mockEnginePatches.cjs').run('check', { repoRoot: REPO_ROOT });
		return true;
	}
	catch (e) { return false; }
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
	fs.writeFileSync(LOG_FILE, '[dojo] installing toolchain (first run, a few minutes)…\n');
	const child = spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: REPO_ROOT, shell: process.platform === 'win32' });
	function append(chunk) {
		const text = chunk.toString();
		try { fs.appendFileSync(LOG_FILE, text); } catch (e) { /* ignore */ }
		broadcast({ type: 'log', line: text });
	}
	child.stdout.on('data', append);
	child.stderr.on('data', append);
	child.on('close', function (code) {
		if (code === 0 && isInstalled()) { state.phase = 'ready'; broadcast({ type: 'ready' }); }
		else { state.phase = 'failed'; broadcast({ type: 'failed', code: code }); }
	});
	child.on('error', function (err) { state.phase = 'failed'; broadcast({ type: 'failed', error: String(err.message || err) }); });
	return { ready: false };
}

function getPhase() { return state.phase; }
function readLog() { try { return fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : ''; } catch (e) { return ''; } }
function subscribe(sink) { state.subscribers.add(sink); return function () { state.subscribers.delete(sink); }; }

module.exports = { start: start, getPhase: getPhase, readLog: readLog, subscribe: subscribe, isInstalled: isInstalled };

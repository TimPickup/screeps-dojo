'use strict';

// Host launcher: `npm run ui`. One command to build (if needed), bring up the
// GUI container, and open the browser. Node built-ins only.
//
//   1. verify docker is available
//   2. build the image if missing (streamed to this terminal)
//   3. build the React app if ui/dist is missing
//   4. docker compose up -d ui
//   5. poll /api/health, then open the browser
//
// The slow first-run `npm install` happens INSIDE the container and streams to
// the welcome screen in the browser (not here).
const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
// The host agent (scripts/hostAgent.js) lets the GUI ask for the host-side
// commands it cannot run itself. It starts in the background by default;
// --agent keeps this terminal as the agent instead, --no-agent skips it.
const ARGS = process.argv.slice(2);
const WITH_AGENT = ARGS.includes('--agent');
const NO_AGENT = ARGS.includes('--no-agent');
// The image is rebuilt only when its inputs changed (see below). --build forces
// it, --no-build never does.
const FORCE_BUILD = ARGS.includes('--build');
const NO_BUILD = ARGS.includes('--no-build');
const PORT = Number(process.env.DOJO_UI_PORT) || 8787;
const URL = 'http://localhost:' + PORT + '/';

function run(cmd, args, opts) {
	return spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: isWin, cwd: ROOT }, opts || {}));
}
function out(cmd, args) {
	const r = spawnSync(cmd, args, { encoding: 'utf8', shell: isWin, cwd: ROOT });
	return (r.stdout || '') + (r.stderr || '');
}
function fail(msg) { console.error('\n[dojo-ui] ' + msg); process.exit(1); }

// 1. docker present?
if (run('docker', ['--version'], { stdio: 'ignore' }).status !== 0) {
	fail('Docker not found. Install Docker Desktop and make sure it is running.');
}
if (run('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
	fail('Docker is installed but not running. Start Docker Desktop and retry.');
}

// 2. Build the images (BOTH services, so neither ships a stale/un-baked
// node_modules) — but ONLY when something the build actually depends on has
// changed since the image was made.
//
// "docker compose build is cached" is true of the layers and misleading in
// practice: the Dockerfile copies package.json before `npm ci`, so editing a
// SCRIPT in that file invalidates the layer and re-runs the whole native
// toolchain build — isolated-vm compile, mockup TypeScript, ffmpeg download.
// Minutes, for a change that touched nothing the image contains. Worse, the
// build then wakes Docker Scout, whose image scan hammers the disk long after
// the build itself has finished.
//
// So: compare the image's creation time against the files the Dockerfile
// actually reads. Anything unexpected (no image, no timestamp, a docker that
// will not answer) falls through to building, because a stale image is the far
// worse failure.
const BUILD_INPUTS = [
	'Dockerfile', 'package.json', 'package-lock.json',
	'server-mock-patches', 'tools/mockEnginePatches.cjs'
];

function newestInputMs() {
	let newest = 0;
	for (const rel of BUILD_INPUTS) {
		const full = path.join(ROOT, rel);
		let stat;
		try { stat = fs.statSync(full); } catch (e) { continue; }
		newest = Math.max(newest, stat.mtimeMs);
		if (!stat.isDirectory()) continue;
		for (const entry of fs.readdirSync(full)) {
			try { newest = Math.max(newest, fs.statSync(path.join(full, entry)).mtimeMs); } catch (e) { /* skip */ }
		}
	}
	return newest;
}

function imageCreatedMs() {
	// Ask compose which image belongs to the service; fall back to the default
	// <project>-<service> name for a checkout whose containers were removed.
	let id = out('docker', ['compose', 'images', '-q', 'dojo']).trim().split('\n')[0].trim();
	if (!id) id = path.basename(ROOT).toLowerCase() + '-dojo';
	const created = out('docker', ['image', 'inspect', id, '--format', '{{.Created}}']).trim();
	const parsed = Date.parse(created);
	return parsed > 0 ? parsed : 0;
}

function buildReason() {
	if (FORCE_BUILD) return 'asked for with --build';
	if (NO_BUILD) return null;
	const imageMs = imageCreatedMs();
	if (!imageMs) return 'no image yet';
	const inputMs = newestInputMs();
	if (inputMs > imageMs) return 'Dockerfile or dependencies changed since the image was built';
	return null;
}

const reason = buildReason();
if (reason) {
	console.log('[dojo-ui] building the container image (' + reason + ')…');
	console.log('[dojo-ui]   This compiles the engine (isolated-vm), builds the mock server,');
	console.log('[dojo-ui]   and downloads ffmpeg — a few minutes, and it may look quiet mid-compile.');
	if (run('docker', ['compose', 'build', '--progress=plain']).status !== 0) fail('image build failed.');
} else if (NO_BUILD) {
	console.log('[dojo-ui] skipping the build (--no-build) — the image may be out of date.');
} else {
	console.log('[dojo-ui] image is up to date — skipping the build (force it with: npm run ui -- --build).');
}

// 3. frontend built?
if (!fs.existsSync(path.join(ROOT, 'ui', 'dist', 'index.html'))) {
	console.log('[dojo-ui] building the web UI…');
	if (run('npm', ['run', 'build:ui']).status !== 0) fail('UI build failed.');
}

// 4. mount every registered bot profile, then bring up the service. This has to
// happen before `up`: a bind mount is fixed when the container is created, so a
// profile added to .env since the last launch only becomes readable now.
require('./composeOverride').write({ log: console.log });

console.log('[dojo-ui] starting the GUI container…');
if (run('docker', ['compose', 'up', '-d', 'ui']).status !== 0) fail('docker compose up failed.');

// 5. poll health, then open the browser. We open as soon as the server is
// REACHABLE (even while it's still installing the toolchain) so its welcome
// screen can show progress. If it stays unreachable, that usually means a stale
// container whose host port never published (e.g. the port was busy on a prior
// launch) — recreate it once, then fall back to an actionable message.
console.log('[dojo-ui] waiting for the server…');
let tries = 0, opened = false, recreated = false;
const timer = setInterval(function () {
	tries += 1;
	const req = http.get(URL + 'api/health', function (res) {
		res.resume();
		if (res.statusCode === 200 && !opened) {
			opened = true;
			clearInterval(timer);
			console.log('[dojo-ui] server up → ' + URL
				+ '\n[dojo-ui] (first run installs the toolchain — watch progress on the welcome screen)');
			openBrowser(URL);
			// the GUI shows its own update banner, but this process keeps the
			// terminal, so say it here too
			require('../src/updateCheck').printNotice().then(function () {
				// The host agent comes up with the GUI. It can do strictly less
				// than this launcher already did (build the image, recreate the
				// container), so making it a second command to remember only meant
				// the GUI's buttons quietly did not appear.
				//
				//   --no-agent  don't start it (the GUI prints commands instead)
				//   --agent     keep THIS terminal as the agent, to watch it work
				if (NO_AGENT) {
					console.log('[dojo-ui] host agent not started (--no-agent): the GUI will show commands to run.');
					return;
				}
				if (WITH_AGENT) { require('./hostAgent').run(); return; }
				const started = require('./hostAgent').startDetached();
				if (started.started) {
					console.log('[dojo-ui] host agent running in the background (pid ' + started.pid + ')'
						+ ' — Settings can now apply bot-path changes and updates for you.');
					console.log('[dojo-ui] it logs to .dojo-host/agent.log and stops with: npm run ui:stop');
				} else if (started.reason === 'already running') {
					console.log('[dojo-ui] host agent already running (pid ' + started.pid + ').');
				} else {
					console.log('[dojo-ui] could not start the host agent (' + started.reason + ')'
						+ ' — the GUI will show commands to run instead.');
				}
			});
		}
	});
	req.on('error', function () { /* unreachable yet */ });
	req.setTimeout(1500, function () { req.destroy(); });

	// reachable check failed for ~10s while the container is up → likely a stuck
	// port mapping; recreate the container once (keeps the node_modules volume).
	if (!opened && !recreated && tries === 10) {
		recreated = true;
		console.log('[dojo-ui] not reachable yet — recreating the container in case its port is stuck…');
		run('docker', ['compose', 'up', '-d', '--force-recreate', 'ui']);
	}
	if (!opened && tries > 60) {
		clearInterval(timer);
		console.log('\n[dojo-ui] still not reachable at ' + URL + ' after 60s. Try:');
		console.log('  • see what the server is doing:   docker compose logs ui');
		console.log('  • another dojo was on this port?  npm run ui:down   then   npm run ui');
		console.log('  • or set a different DOJO_UI_PORT in .env');
	}
}, 1000);

function openBrowser(url) {
	const cmd = isWin ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
	const args = isWin ? ['', url] : [url];
	try { spawnSync(cmd, args, { shell: true, stdio: 'ignore' }); } catch (e) { /* user can open manually */ }
}

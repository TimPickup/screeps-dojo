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
// node_modules). docker compose build is cached and fast once nothing has
// changed; the first build bakes the toolchain in and takes a few minutes.
console.log('[dojo-ui] building the container image (first run takes a few minutes; cached afterwards)…');
if (run('docker', ['compose', 'build']).status !== 0) fail('image build failed.');

// 3. frontend built?
if (!fs.existsSync(path.join(ROOT, 'ui', 'dist', 'index.html'))) {
	console.log('[dojo-ui] building the web UI…');
	if (run('npm', ['run', 'build:ui']).status !== 0) fail('UI build failed.');
}

// 4. bring up the service
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

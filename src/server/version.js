'use strict';

// Reports the running version and whether a newer one is on GitHub's main
// branch. The latest version is fetched from the public repo's package.json
// (cached 1h, fail-soft: latest=null when offline / fetch fails). Fork-friendly:
// point the check elsewhere with DOJO_UPDATE_REPO=owner/name.
const https = require('https');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CURRENT = (function () {
	try { return require(path.join(REPO_ROOT, 'package.json')).version || '0.0.0'; }
	catch (e) { return '0.0.0'; }
})();
const UPDATE_REPO = process.env.DOJO_UPDATE_REPO || 'TimPickup/screeps-dojo';
const RAW_URL = 'https://raw.githubusercontent.com/' + UPDATE_REPO + '/main/package.json';
const TTL_MS = 60 * 60 * 1000;

let cache = { at: 0, latest: null };

function parts(v) { return String(v || '').split('.').map(function (n) { return parseInt(n, 10) || 0; }); }
function isNewer(a, b) {
	const A = parts(a), B = parts(b);
	for (let i = 0; i < 3; i++) {
		if ((A[i] || 0) > (B[i] || 0)) return true;
		if ((A[i] || 0) < (B[i] || 0)) return false;
	}
	return false;
}

function fetchLatest() {
	return new Promise(function (resolve) {
		const req = https.get(RAW_URL, { headers: { 'User-Agent': 'screeps-dojo' } }, function (res) {
			if (res.statusCode !== 200) { res.resume(); return resolve(null); }
			let body = '';
			res.on('data', function (c) { body += c; });
			res.on('end', function () { try { resolve(JSON.parse(body).version || null); } catch (e) { resolve(null); } });
		});
		req.on('error', function () { resolve(null); });
		req.setTimeout(4000, function () { req.destroy(); resolve(null); });
	});
}

async function getVersionInfo() {
	if (Date.now() - cache.at > TTL_MS) {
		cache = { at: Date.now(), latest: await fetchLatest() };
	}
	const latest = cache.latest;
	return {
		current: CURRENT,
		latest: latest,
		updateAvailable: !!(latest && isNewer(latest, CURRENT)),
		repoUrl: 'https://github.com/' + UPDATE_REPO
	};
}

module.exports = { getVersionInfo: getVersionInfo, CURRENT: CURRENT };

'use strict';

// Is a newer dojo published? The latest version is the `version` in the public
// repo's package.json on main (that is what a release bumps), so this needs no
// release API and works for forks via DOJO_UPDATE_REPO=owner/name.
//
// Used from two places with different needs, hence the disk cache: the GUI
// server is long-lived and can hold the answer in memory, while a CLI launcher
// is a fresh process every run and must not pay for a network round trip on
// each `npm test`. Both share the same one-hour TTL.
//
// Fail-soft everywhere: no network, a proxy, a rate limit or a mangled response
// all end as "no idea, say nothing". A version check must never be the reason a
// test run reports failure. Opt out entirely with DOJO_NO_UPDATE_CHECK=1.
const https = require('https');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '..');
const CACHE_FILE = path.join(REPO_ROOT, '.tmp', 'update-check.json');
const TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

const CURRENT = (function () {
	try { return require(path.join(REPO_ROOT, 'package.json')).version || '0.0.0'; }
	catch (e) { return '0.0.0'; }
})();

const UPDATE_REPO = process.env.DOJO_UPDATE_REPO || 'TimPickup/screeps-dojo';
const RAW_URL = 'https://raw.githubusercontent.com/' + UPDATE_REPO + '/main/package.json';
const REPO_URL = 'https://github.com/' + UPDATE_REPO;

function parts(v) { return String(v || '').split('.').map(function (n) { return parseInt(n, 10) || 0; }); }

function isNewer(candidate, current) {
	const A = parts(candidate), B = parts(current);
	for (let i = 0; i < 3; i++) {
		if ((A[i] || 0) > (B[i] || 0)) return true;
		if ((A[i] || 0) < (B[i] || 0)) return false;
	}
	return false;
}

function fetchLatest() {
	return new Promise(function (resolve) {
		let req;
		try {
			req = https.get(RAW_URL, { headers: { 'User-Agent': 'screeps-dojo' } }, function (res) {
				if (res.statusCode !== 200) { res.resume(); return resolve(null); }
				let body = '';
				res.on('data', function (chunk) { body += chunk; });
				res.on('end', function () {
					try { resolve(JSON.parse(body).version || null); } catch (e) { resolve(null); }
				});
			});
		} catch (e) { return resolve(null); }
		req.on('error', function () { resolve(null); });
		req.setTimeout(FETCH_TIMEOUT_MS, function () { req.destroy(); resolve(null); });
	});
}

function readCache() {
	try {
		const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
		if (typeof cached.at !== 'number' || Date.now() - cached.at > TTL_MS) return null;
		return cached;
	} catch (e) { return null; }
}

function writeCache(latest) {
	try {
		fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
		fs.writeFileSync(CACHE_FILE, JSON.stringify({ at: Date.now(), latest: latest }));
	} catch (e) { /* a cache we cannot write is just a slower check */ }
}

function info(latest) {
	return {
		current: CURRENT,
		latest: latest,
		updateAvailable: !!(latest && isNewer(latest, CURRENT)),
		repoUrl: REPO_URL
	};
}

// `useDiskCache` is for short-lived CLI processes; the GUI server keeps its own
// in-memory cache and passes false.
async function getInfo(useDiskCache) {
	if (process.env.DOJO_NO_UPDATE_CHECK === '1') return info(null);
	if (useDiskCache !== false) {
		const cached = readCache();
		if (cached) return info(cached.latest);
	}
	const latest = await fetchLatest();
	if (useDiskCache !== false) writeCache(latest);
	return info(latest);
}

// Deliberately short: this prints after a test run, when the thing the user
// actually came for is the line above it.
function formatNotice(versionInfo) {
	const colour = !process.env.NO_COLOR;
	const yellow = colour ? '[33m' : '';
	const bold = colour ? '[1m' : '';
	const reset = colour ? '[0m' : '';
	return [
		'',
		yellow + bold + '⬆ Screeps Dojo v' + versionInfo.latest + ' is available' + reset
			+ yellow + ' — you have v' + versionInfo.current + reset,
		yellow + '  update:  git pull  &&  npm run build:ui  &&  npm run build' + reset,
		yellow + '  notes:   ' + versionInfo.repoUrl + '/releases' + reset,
		''
	].join('\n');
}

// Prints to stderr, like npm's own update notice: it is commentary on the run,
// not part of its output, so piping a command somewhere stays clean. Never
// rejects — callers exit straight after.
async function printNotice() {
	try {
		const versionInfo = await getInfo(true);
		if (versionInfo.updateAvailable) process.stderr.write(formatNotice(versionInfo) + '\n');
	} catch (e) { /* fail-soft: a missed notice must never fail a command */ }
}

module.exports = {
	CURRENT: CURRENT,
	REPO_URL: REPO_URL,
	isNewer: isNewer,
	getInfo: getInfo,
	formatNotice: formatNotice,
	printNotice: printNotice,
	CACHE_FILE: CACHE_FILE
};

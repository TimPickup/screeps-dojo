'use strict';

// Reports the running version and whether a newer one is published. The check
// itself lives in src/updateCheck.js, shared with the CLI launchers so the GUI
// banner and the terminal notice can never disagree about what "newer" means.
//
// The server is long-lived, so it caches in memory (one fetch per hour per
// process) rather than through the disk cache a short-lived CLI process needs.
const updateCheck = require('../updateCheck');

const TTL_MS = 60 * 60 * 1000;

let cache = { at: 0, info: null };

async function getVersionInfo() {
	if (!cache.info || Date.now() - cache.at > TTL_MS) {
		cache = { at: Date.now(), info: await updateCheck.getInfo(false) };
	}
	return cache.info;
}

module.exports = { getVersionInfo: getVersionInfo, CURRENT: updateCheck.CURRENT };

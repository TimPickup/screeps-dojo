'use strict';

// Reads .env (bind-mounted) merged over process.env, WITHOUT a dependency.
// Shared by the import route (token) and Phase-5 env/verify routes. Re-read per
// call so edits via the Settings overlay take effect immediately.
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

function loadEnvConfig() {
	const config = Object.assign({}, process.env);
	if (fs.existsSync(ENV_PATH)) {
		for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
			const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
			if (match) config[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
		}
	}
	return config;
}

module.exports = { loadEnvConfig: loadEnvConfig, ENV_PATH: ENV_PATH };

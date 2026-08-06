'use strict';

// Reads .env (bind-mounted) merged over process.env, WITHOUT a dependency.
// Re-read per call so edits via the Settings overlay take effect immediately.
//
// This lives in src/ rather than src/server/ because the RUNNER needs it too,
// and that is not an accident of layering: docker compose reads .env on the
// HOST, to interpolate the compose file. It does not pass those variables into
// the container. So inside the container, bot and screeps profiles exist only in
// this file — process.env alone would report none registered, while the Settings
// screen (which merges the file) listed them happily.
const fs = require('fs');
const path = require('path');

// DOJO_ENV_FILE exists so tests can point at a temp file instead of the real
// one; nothing in normal operation sets it.
const ENV_PATH = process.env.DOJO_ENV_FILE || path.join(__dirname, '..', '.env');

function envPath() { return process.env.DOJO_ENV_FILE || ENV_PATH; }

function loadEnvConfig() {
	const config = Object.assign({}, process.env);
	const file = envPath();
	if (fs.existsSync(file)) {
		for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
			const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
			if (match) config[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
		}
	}
	return config;
}

module.exports = { loadEnvConfig: loadEnvConfig, ENV_PATH: ENV_PATH, envPath: envPath };

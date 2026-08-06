'use strict';

const fs = require('fs');
const { ENV_PATH } = require('../envConfig');
const { parse, merge, remove } = require('../envFile');
const botProfiles = require('../../botProfiles');
const screepsProfiles = require('../../screepsProfiles');
const scenarioSettings = require('../../scenarioSettings');
const { pathSafe } = require('../pathSafe');

// Keys the Settings screen may read back. Bot/screeps profile keys are matched
// by shape rather than listed, since their names are user-chosen.
const LEGACY_SHOWN_KEYS = [
	'DOJO_BOT_PATH', 'DOJO_UI_PORT', 'DOJO_SCREEPS_TOKEN', 'DOJO_SCREEPS_SHARD',
	'DOJO_SCREEPS_HOSTNAME', 'DOJO_SCREEPS_PATH', 'DOJO_SCREEPS_PORT', 'DOJO_SCREEPS_PROTOCOL',
	'DOJO_DEFAULT_BOT_PROFILE', 'DOJO_DEFAULT_SCREEPS_PROFILE'
];

// /bots is a Docker bind mount, where every syscall costs milliseconds. Probing
// each profile is one readdir, so cache it and invalidate on write; the TTL is
// only a backstop for a mount that appears without going through us.
const STATUS_TTL_MS = 5000;
let statusCache = { at: 0, entries: null };

function isSecretKey(key) {
	if (key === 'DOJO_SCREEPS_TOKEN' || key === 'DOJO_SCREEPS_PASSWORD') return true;
	const parsed = screepsProfiles.parseKey(key);
	return Boolean(parsed && screepsProfiles.SECRET_KEYS.includes(parsed.key));
}

function isShownKey(key) {
	if (LEGACY_SHOWN_KEYS.includes(key)) return true;
	return Boolean(botProfiles.parseKey(key) || screepsProfiles.parseKey(key));
}

function maskValue(v) {
	if (!v) return '';
	if (v.length <= 8) return '••••';
	return '••••' + v.slice(-4);
}

function readEnvText() {
	return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
}

// Env as the runner sees it: process.env with .env layered on top, matching
// loadEnvConfig(). Profile listings must agree with what a run would resolve.
function effectiveEnv() {
	return Object.assign({}, process.env, parse(readEnvText()));
}

function botStatuses(env) {
	const now = Date.now();
	if (statusCache.entries && now - statusCache.at < STATUS_TTL_MS) return statusCache.entries;
	const entries = botProfiles.listProfiles(env).map(function (profile) {
		return botProfiles.status(profile, env);
	});
	statusCache = { at: now, entries: entries };
	return entries;
}

function invalidateBotStatuses() { statusCache = { at: 0, entries: null }; }

module.exports = function registerEnvRoutes(router, ctx) {
	router.get('/api/env', function (req, res) {
		const values = parse(readEnvText());
		const out = {};
		const secrets = [];
		for (const k of Object.keys(values)) {
			if (!isShownKey(k)) continue;
			if (isSecretKey(k)) { secrets.push(k); out[k] = maskValue(values[k]); }
			else out[k] = values[k];
		}
		ctx.sendJson(res, 200, { values: out, secrets: secrets });
	});

	router.put('/api/env', function (req, res) {
		const body = req.body || {};
		const incoming = body.values || {};
		const removing = Array.isArray(body.remove) ? body.remove.filter(function (k) { return typeof k === 'string'; }) : [];
		// never write back a masked secret (the UI sends the mask if unchanged)
		const patch = {};
		for (const k of Object.keys(incoming)) {
			const v = incoming[k];
			if (typeof v !== 'string') continue;
			if (isSecretKey(k) && v.indexOf('•') !== -1) continue;
			patch[k] = v;
		}
		const before = parse(readEnvText());
		const merged = merge(remove(readEnvText(), removing), patch);
		fs.writeFileSync(ENV_PATH, merged, 'utf8');
		invalidateBotStatuses();

		// A recreate is only needed when a MOUNT changed. Re-pointing the default
		// or a scenario at an already-registered profile is free, and saying
		// otherwise would train people to ignore the warning.
		const after = parse(merged);
		const restartRequired = botPathsChanged(before, after);
		ctx.sendJson(res, 200, { ok: true, restartRequired: restartRequired });
	});

	function botPathsChanged(before, after) {
		const keys = new Set();
		for (const source of [before, after]) {
			for (const k of Object.keys(source)) {
				if (k === botProfiles.LEGACY_PATH_KEY || botProfiles.parseKey(k)) keys.add(k);
			}
		}
		for (const k of keys) { if (before[k] !== after[k]) return true; }
		return false;
	}

	// Registered bot profiles with real mount status, so the UI can say which
	// rows are live and which are still waiting on `npm run ui` — rather than
	// warning about every save.
	router.get('/api/bots', function (req, res) {
		const env = effectiveEnv();
		try {
			ctx.sendJson(res, 200, {
				profiles: botStatuses(env),
				default: botProfiles.defaultProfileName(env),
				usesLegacyKeys: botProfiles.usesLegacyKeys(env)
			});
		} catch (e) {
			ctx.sendJson(res, 500, { error: String((e && e.message) || e) });
		}
	});

	// Never includes a token or password — only whether one is set.
	router.get('/api/servers', function (req, res) {
		const env = effectiveEnv();
		try {
			ctx.sendJson(res, 200, {
				profiles: screepsProfiles.listProfiles(env),
				default: screepsProfiles.defaultProfileName(env),
				usesLegacyKeys: screepsProfiles.usesLegacyKeys(env)
			});
		} catch (e) {
			ctx.sendJson(res, 500, { error: String((e && e.message) || e) });
		}
	});

	// A scenario's effective settings: what settings.json asks for, plus what it
	// resolves to once profiles and defaults are applied. One readFile.
	router.get('/api/scenarios/:name/settings', function (req, res) {
		let dir;
		try { dir = pathSafe(ctx.scenariosRoot, req.params.name); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		const env = effectiveEnv();
		try {
			const loaded = scenarioSettings.load(dir);
			ctx.sendJson(res, 200, {
				present: loaded.present,
				settings: loaded.settings,
				warnings: loaded.warnings,
				effectiveBot: loaded.settings.bots.main || botProfiles.defaultProfileName(env),
				effectiveServer: loaded.settings.server || screepsProfiles.defaultProfileName(env)
			});
		} catch (e) {
			ctx.sendJson(res, 200, {
				present: true, settings: { bots: {} }, warnings: [],
				error: String((e && e.message) || e)
			});
		}
	});

	// Verify a mounted bot profile (NOT an arbitrary typed path — an unmounted
	// path is unreadable from in here, which is the whole reason profiles exist).
	router.get('/api/verify/bot', function (req, res) {
		const env = effectiveEnv();
		const wanted = (req.query.get('profile') || '').trim().toLowerCase();
		try {
			const dir = wanted ? botProfiles.resolveDir(wanted, env) : botProfiles.implicitDir(env);
			const files = fs.readdirSync(dir);
			const jsModuleCount = files.filter(function (f) { return f.endsWith('.js'); }).length;
			ctx.sendJson(res, 200, { ok: jsModuleCount > 0, jsModuleCount: jsModuleCount, mount: dir });
		} catch (e) {
			ctx.sendJson(res, 200, { ok: false, error: String((e && e.message) || e) });
		}
	});

	router.get('/api/verify/server', async function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up' }); return; }
		const wanted = (req.query.get('profile') || '').trim().toLowerCase();
		try {
			const { createClient } = require('../../import/screepsClient');
			const { loadEnvConfig } = require('../envConfig');
			const config = screepsProfiles.resolve(wanted || undefined, loadEnvConfig());
			const client = createClient(config);
			const status = await client.checkToken();
			ctx.sendJson(res, 200, { ok: !status.error, active: status.active, secondsLeft: status.secondsLeft, error: status.error });
		} catch (e) {
			ctx.sendJson(res, 200, { ok: false, error: String((e && e.message) || e) });
		}
	});
};

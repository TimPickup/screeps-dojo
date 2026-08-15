'use strict';

const fs = require('fs');
const { loadEnvConfig, envPath } = require('../../envConfig');
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
	return fs.existsSync(envPath()) ? fs.readFileSync(envPath(), 'utf8') : '';
}

// Env as the runner sees it: process.env with .env layered on top, matching
// loadEnvConfig(). Profile listings must agree with what a run would resolve.
function effectiveEnv() { return loadEnvConfig(); }

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
		fs.writeFileSync(envPath(), merged, 'utf8');
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

	// Rename a profile, server-side, because only here are the real values.
	// Doing this in the browser meant a token could not come with it.
	router.post('/api/env/rename-profile', function (req, res) {
		const body = req.body || {};
		const kind = String(body.kind || '');
		const from = String(body.from || '').trim().toLowerCase();
		const to = String(body.to || '').trim().toLowerCase();
		const family = kind === 'bot' ? botProfiles : kind === 'screeps' ? screepsProfiles : null;

		if (!family) { ctx.sendJson(res, 400, { error: 'kind must be "bot" or "screeps"' }); return; }
		if (!family.NAME_RE.test(to)) { ctx.sendJson(res, 400, { error: 'invalid profile name "' + to + '"' }); return; }
		if (from === to) { ctx.sendJson(res, 200, { ok: true, renamed: 0 }); return; }

		const text = readEnvText();
		const values = parse(text);
		if (family.known(to, values)) { ctx.sendJson(res, 409, { error: 'a profile named "' + to + '" already exists' }); return; }

		// Every key this profile owns moves across under the new name, values
		// intact — including the secrets the browser never sees.
		const patch = {};
		const drop = [];
		for (const key of Object.keys(values)) {
			const parsed = family.parseKey(key);
			if (!parsed || parsed.name !== from) continue;
			patch[kind === 'bot' ? family.envKeyFor(to) : family.envKeyFor(to, parsed.key)] = values[key];
			drop.push(key);
		}
		// The legacy unsuffixed form is the "default" profile under another name.
		if (from === family.DEFAULT_PROFILE) {
			if (kind === 'bot' && values[botProfiles.LEGACY_PATH_KEY] !== undefined) {
				patch[botProfiles.envKeyFor(to)] = values[botProfiles.LEGACY_PATH_KEY];
				drop.push(botProfiles.LEGACY_PATH_KEY);
			} else if (kind === 'screeps') {
				for (const key of screepsProfiles.KEYS) {
					const legacy = screepsProfiles.legacyKeyFor(key);
					if (values[legacy] === undefined) continue;
					patch[screepsProfiles.envKeyFor(to, key)] = values[legacy];
					drop.push(legacy);
				}
			}
		}
		if (!drop.length) { ctx.sendJson(res, 404, { error: 'no profile named "' + from + '"' }); return; }

		// A pointer at the old name would select a profile that no longer exists,
		// which resolveDir turns into a hard failure at run time. The IMPLICIT
		// default counts too: with no pointer set, the profile literally named
		// "default" is the one in use, so renaming that has to leave a pointer
		// behind or nothing is the default any more.
		const pointerKey = kind === 'bot' ? 'DOJO_DEFAULT_BOT_PROFILE' : 'DOJO_DEFAULT_SCREEPS_PROFILE';
		if (family.defaultProfileName(values) === from) patch[pointerKey] = to;

		fs.writeFileSync(envPath(), merge(remove(text, drop), patch), 'utf8');
		invalidateBotStatuses();
		ctx.sendJson(res, 200, { ok: true, renamed: drop.length });
	});

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
		let client;
		try {
			const { createClient } = require('../../import/screepsClient');
			const config = screepsProfiles.resolve(wanted || undefined, loadEnvConfig());
			client = createClient(config);
			const status = await client.checkToken();
			await client.connect();
			await client.me();
			ctx.sendJson(res, 200, { ok: true, authMode: status.authMode, active: status.active, secondsLeft: status.secondsLeft });
		} catch (e) {
			ctx.sendJson(res, 200, { ok: false, error: String((e && e.message) || e) });
		} finally { if (client) client.disconnect(); }
	});
};

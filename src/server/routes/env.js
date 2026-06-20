'use strict';

const fs = require('fs');
const { ENV_PATH } = require('../envConfig');
const { parse, merge } = require('../envFile');

const SECRET_KEYS = ['DOJO_SCREEPS_TOKEN'];
const SHOWN_KEYS = [
	'DOJO_BOT_PATH', 'DOJO_UI_PORT', 'DOJO_SCREEPS_TOKEN', 'DOJO_SCREEPS_SHARD',
	'DOJO_SCREEPS_HOSTNAME', 'DOJO_SCREEPS_PATH', 'DOJO_SCREEPS_PORT', 'DOJO_SCREEPS_PROTOCOL'
];

function maskValue(v) {
	if (!v) return '';
	if (v.length <= 8) return '••••';
	return '••••' + v.slice(-4);
}

function readEnvText() {
	return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
}

module.exports = function registerEnvRoutes(router, ctx) {
	router.get('/api/env', function (req, res) {
		const values = parse(readEnvText());
		const out = {};
		for (const k of SHOWN_KEYS) {
			if (values[k] === undefined) continue;
			out[k] = SECRET_KEYS.includes(k) ? maskValue(values[k]) : values[k];
		}
		ctx.sendJson(res, 200, { values: out, secrets: SECRET_KEYS });
	});

	router.put('/api/env', function (req, res) {
		const incoming = (req.body && req.body.values) || {};
		// never write back a masked secret (the UI sends the mask if unchanged)
		const patch = {};
		for (const k of Object.keys(incoming)) {
			const v = incoming[k];
			if (typeof v !== 'string') continue;
			if (SECRET_KEYS.includes(k) && v.indexOf('•') !== -1) continue;
			patch[k] = v;
		}
		const before = parse(readEnvText());
		const merged = merge(readEnvText(), patch);
		fs.writeFileSync(ENV_PATH, merged, 'utf8');
		const restartRequired = Object.prototype.hasOwnProperty.call(patch, 'DOJO_BOT_PATH')
			&& patch.DOJO_BOT_PATH !== before.DOJO_BOT_PATH;
		ctx.sendJson(res, 200, { ok: true, restartRequired: restartRequired });
	});

	// Verify the live /bot mount (NOT an arbitrary typed path — that needs a
	// container recreate to re-mount).
	router.get('/api/verify/bot', function (req, res) {
		const botDir = process.env.DOJO_BOT_DIR || '/bot';
		try {
			const files = fs.readdirSync(botDir);
			const jsModuleCount = files.filter(function (f) { return f.endsWith('.js'); }).length;
			ctx.sendJson(res, 200, { ok: jsModuleCount > 0, jsModuleCount: jsModuleCount, mount: botDir });
		} catch (e) {
			ctx.sendJson(res, 200, { ok: false, error: 'bot mount not readable: ' + botDir });
		}
	});

	router.get('/api/verify/server', async function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up' }); return; }
		try {
			const { createClient } = require('../../import/screepsClient');
			const { loadEnvConfig } = require('../envConfig');
			const client = createClient(loadEnvConfig());
			const status = await client.checkToken();
			ctx.sendJson(res, 200, { ok: !status.error, active: status.active, secondsLeft: status.secondsLeft, error: status.error });
		} catch (e) {
			ctx.sendJson(res, 200, { ok: false, error: String((e && e.message) || e) });
		}
	});
};

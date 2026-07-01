'use strict';

const https = require('https');
const { decodeTerrain } = require('./terrainDecode');

// Show only the first/last 4 chars of a secret so logs can identify which token
// is in use without exposing the full value.
function maskToken(token) {
	if (!token || token.length <= 8) return '****';
	return token.slice(0, 4) + '…' + token.slice(-4);
}

// Thin wrapper over screeps-api for the importer. Reads config from an env-like
// object so the CLI can pass process.env.
function createClient(config) {
	const token = config.DOJO_SCREEPS_TOKEN;
	// Fallback auth when no token is set: username/password. A private server
	// (screepsmod-auth) issues API tokens that work over REST but are rejected by
	// the WebSocket auth; signing in yields a NATIVE session token the socket
	// accepts. screeps-api takes { email, password } and signs in automatically.
	const email = config.DOJO_SCREEPS_USERNAME || config.DOJO_SCREEPS_EMAIL;
	const password = config.DOJO_SCREEPS_PASSWORD;
	if (!token && !(email && password)) {
		throw new Error('set DOJO_SCREEPS_TOKEN, or DOJO_SCREEPS_USERNAME + DOJO_SCREEPS_PASSWORD (.env)');
	}
	const shard = config.DOJO_SCREEPS_SHARD || 'shard0';
	const hostname = config.DOJO_SCREEPS_HOSTNAME || 'screeps.com';

	// screeps-api v2 is ESM-only, so it cannot be require()'d from this CommonJS
	// module. Load it lazily via dynamic import() and memoize the client. This
	// keeps createClient() synchronous, so importRoom.js stays unchanged.
	let apiPromise = null;
	function getApi() {
		if (!apiPromise) {
			apiPromise = import('screeps-api').then(function (mod) {
				const clientOpts = {
					protocol: config.DOJO_SCREEPS_PROTOCOL || 'https',
					hostname: hostname,
					port: Number(config.DOJO_SCREEPS_PORT || 443),
					path: config.DOJO_SCREEPS_PATH || '/'
				};
				if (token) clientOpts.token = token;
				else { clientOpts.email = email; clientOpts.password = password; }
				return new mod.ScreepsHttpClient(clientOpts);
			});
		}
		return apiPromise;
	}

	// Cache of userId -> classification tag ('me'|'invader'|'sourceKeeper'|null).
	let myId = null;
	const ownerCache = {};

	function queryToken() {
		// /api/auth/query-token?token=... ; token is the query param (no header).
		return new Promise(function (resolve, reject) {
			const url = 'https://' + hostname + '/api/auth/query-token?token=' + encodeURIComponent(token);
			https.get(url, function (res) {
				let body = '';
				res.on('data', function (chunk) { body += chunk; });
				res.on('end', function () {
					try { resolve(JSON.parse(body)); }
					catch (error) { reject(new Error('query-token parse failed: ' + body.slice(0, 200))); }
				});
			}).on('error', reject);
		});
	}

	return {
		async connect() {
			const api = await getApi();
			// Password auth: sign in first so a native session token exists for the
			// socket handshake (the mod's REST-only API token fails socket auth).
			// Token auth needs no signin call; the token is sent automatically.
			if (!token) await api.authSignin(email, password);
			await api.socket.connect();
		},

		// Reports whether the no-rate-limit window is active and how long is left.
		// Surfaces the activation URL when it is not. Never throws on inactive.
		// The noratelimit page is anonymous and needs the token in the URL to work,
		// so activateUrl carries the real secret (write it to a gitignored file,
		// never to stdout); maskedUrl is the safe-to-print version.
		async checkToken() {
			// No token (username/password auth): the no-rate-limit window is a
			// live-server concept, so there's nothing to check.
			if (!token) return { active: false, secondsLeft: 0, activateUrl: '', maskedUrl: '(password auth; rate-limit check skipped)' };
			const base = 'https://' + hostname + '/a/#!/account/auth-tokens/noratelimit?token=';
			const activateUrl = base + token;
			const maskedUrl = base + maskToken(token);
			let info;
			try {
				info = await queryToken();
			} catch (error) {
				// Best-effort check; never block the import if query-token misbehaves.
				return { active: false, secondsLeft: 0, error: error.message, activateUrl: activateUrl, maskedUrl: maskedUrl };
			}
			// The unlimited window is a future expiry timestamp (ms) at token.noRatelimitUntil.
			const until = Number(info && info.token && info.token.noRatelimitUntil) || 0;
			const secondsLeft = Math.round((until - Date.now()) / 1000);
			const active = secondsLeft > 0;
			return { active: active, secondsLeft: active ? secondsLeft : 0, activateUrl: activateUrl, maskedUrl: maskedUrl };
		},

		async me() {
			const api = await getApi();
			const user = await api.me();
			myId = user._id;
			ownerCache[myId] = 'me';
			return user;
		},

		// One full room snapshot: terrain rows + raw object docs.
		async getRoom(roomName) {
			const api = await getApi();
			const terrainResponse = await api.gameRoomTerrain(roomName, shard);
			const encoded = terrainResponse.terrain[0].terrain;
			const terrainRows = decodeTerrain(encoded);

			const objects = await new Promise(function (resolve, reject) {
				const timer = setTimeout(function () { reject(new Error('room snapshot timed out for ' + roomName)); }, 15000);
				api.socket.subscribeRoom(roomName, shard, function (event) {
					if (!event || !event.data || !event.data.objects) return;
					clearTimeout(timer);
					api.socket.unsubscribeRoom(roomName, shard);
					// First payload is the full set: id -> object doc.
					resolve(Object.keys(event.data.objects).map(function (id) {
						return Object.assign({ _id: id }, event.data.objects[id]);
					}));
				}).catch(reject);
			});
			return { terrainRows: terrainRows, objects: objects };
		},

		async getMemory() {
			const api = await getApi();
			const result = await api.userMemoryGet('', shard);
			return result && result.data !== undefined ? result.data : result;
		},

		async getSegments(list) {
			const api = await getApi();
			const out = {};
			for (const segment of list) {
				const result = await api.userMemorySegmentGet(segment, shard);
				const data = result && result.data !== undefined ? result.data : result;
				if (data !== null && data !== undefined && data !== '') out[segment] = data;
			}
			return out;
		},

		// Returns classifyOwner(userId) for roomToMap. Resolves unknown ids to a
		// username via the API and tags Invader / Source Keeper; real players -> null.
		ownerClassifier() {
			// NPC users have FIXED ids on every Screeps server: '2' = Invader,
			// '3' = Source Keeper (confirmed on the live season server). /api/user/find
			// can't resolve these (it demands a 24-hex ObjectId), so map them directly.
			// Anything that isn't me or an NPC is another player -> dropped (null).
			return function classifyOwner(userId) {
				if (myId && userId === myId) return 'me';
				if (userId === '2') return 'invader';
				if (userId === '3') return 'sourceKeeper';
				return null;
			};
		},

		disconnect() {
			// disconnect() always runs after connect(), so the client is already
			// constructed; resolve the memoized promise and close its socket.
			if (apiPromise) {
				apiPromise.then(function (api) {
					try { api.socket.disconnect(); } catch (error) { /* already closed */ }
				}).catch(function () { /* never constructed */ });
			}
		}
	};
}

module.exports = { createClient: createClient };

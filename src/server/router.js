'use strict';

// Minimal method+path router with `:param` segments. No deps. Returns a
// `{ handler, params }` match or null. Query parsing is done by the caller
// (the server passes a parsed URL to handlers).
function createRouter() {
	const routes = [];
	function add(method, pattern, handler) {
		routes.push({ method: method, parts: pattern.split('/').filter(Boolean), handler: handler });
	}
	function match(method, pathname) {
		const segs = pathname.split('/').filter(Boolean);
		for (const r of routes) {
			if (r.method !== method) continue;
			if (r.parts.length !== segs.length) continue;
			const params = {};
			let ok = true;
			for (let i = 0; i < r.parts.length; i++) {
				const p = r.parts[i];
				if (p[0] === ':') params[p.slice(1)] = decodeURIComponent(segs[i]);
				else if (p !== segs[i]) { ok = false; break; }
			}
			if (ok) return { handler: r.handler, params: params };
		}
		return null;
	}
	return {
		get: function (p, h) { add('GET', p, h); },
		post: function (p, h) { add('POST', p, h); },
		put: function (p, h) { add('PUT', p, h); },
		del: function (p, h) { add('DELETE', p, h); },
		match: match
	};
}

module.exports = { createRouter: createRouter };

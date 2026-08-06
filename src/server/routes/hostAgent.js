'use strict';

// Asks the host to do the things the container cannot do for itself: recreate
// itself so a newly registered bot profile is actually mounted, restart, or
// take an update. The work happens in scripts/hostAgent.js on the host; this
// only writes the request and reports whether anything is listening.
//
// Nothing here can run a command. The request carries an action NAME from a
// closed list (src/hostChannel.js) and nothing else — no path, no argument, no
// flag — so the worst a compromised server could ask for is one of the three
// things you already agreed to when you started the agent.
const fs = require('fs');
const crypto = require('crypto');
const hostChannel = require('../../hostChannel');

module.exports = function registerHostAgentRoutes(router, ctx) {
	function statusPayload() {
		const status = hostChannel.readStatus();
		const running = hostChannel.isLive(status, Date.now());
		const pending = hostChannel.readRequest();
		return {
			running: running,
			// Offer only what an agent would accept. With no agent listening the
			// UI must show the command to type instead of a button that hangs.
			actions: running ? (status.actions || hostChannel.ACTIONS) : [],
			summaries: hostChannel.ACTION_SUMMARY,
			busy: Boolean(running && status.busy),
			lastResult: (status && status.lastResult) || null,
			pending: pending ? { id: pending.id, action: pending.action, requestedAt: pending.requestedAt } : null
		};
	}

	router.get('/api/host-agent', function (req, res) {
		try { ctx.sendJson(res, 200, statusPayload()); }
		catch (e) { ctx.sendJson(res, 500, { error: String((e && e.message) || e) }); }
	});

	// The tail of the agent's log. An update rebuilds the image for minutes with
	// its output streaming here, so without this the GUI could only say "working"
	// and ask you to trust it.
	router.get('/api/host-agent/log', function (req, res) {
		const wanted = Math.min(Math.max(parseInt(req.query.get('lines'), 10) || 40, 1), 500);
		let text = '';
		try { text = fs.readFileSync(hostChannel.logPath(), 'utf8'); } catch (e) { /* nothing logged yet */ }
		const lines = text.split('\n').filter(function (line) { return line.trim() !== ''; });
		ctx.sendJson(res, 200, { lines: lines.slice(-wanted) });
	});

	router.post('/api/host-agent/request', function (req, res) {
		const action = String((req.body && req.body.action) || '');
		if (hostChannel.ACTIONS.indexOf(action) === -1) {
			ctx.sendJson(res, 400, { error: 'not an allowed action (' + hostChannel.ACTIONS.join(', ') + ')' });
			return;
		}
		const status = hostChannel.readStatus();
		if (!hostChannel.isLive(status, Date.now())) {
			// Writing anyway would leave a request that fires the moment someone
			// starts an agent for an unrelated reason. The agent drops stale
			// requests for the same reason; refusing here is the clearer half.
			ctx.sendJson(res, 409, { error: 'no host agent is running — start one with: npm run host-agent' });
			return;
		}
		if (status.busy) { ctx.sendJson(res, 409, { error: 'the host agent is already running an action' }); return; }

		const request = { id: crypto.randomUUID(), action: action, requestedAt: new Date().toISOString() };
		try {
			hostChannel.writeRequest(request);
		} catch (e) {
			ctx.sendJson(res, 500, { error: 'could not write the request: ' + String((e && e.message) || e) });
			return;
		}
		ctx.sendJson(res, 200, { ok: true, id: request.id, action: action });
	});
};

'use strict';

// Host-side agent: performs the few things the GUI cannot do for itself.
//
// The server runs INSIDE the container. It can neither recreate its own
// container (a bind mount is only established at creation, which is why a new
// bot profile needs one) nor rebuild the image after a `git pull`. Both are
// host commands. So the container asks, and this agent — running on the host,
// started deliberately by you — answers.
//
//   npm run host-agent          watch for requests until you stop it (Ctrl-C)
//   npm run ui -- --agent       open the GUI, then keep watching in this terminal
//
// The channel is a file in the repo, which is already bind-mounted into the
// container: .dojo-host/request.json in, .dojo-host/status.json out.
//
// WHY A FILE IS THE SAFE CHOICE. The alternative — mounting the Docker socket
// into the container — would hand a process that runs your bot code full
// control of the host daemon. This grants nothing new: anything able to write
// request.json can already write scripts/ui.js, because both are the same
// bind-mounted checkout. The privilege boundary is unchanged; only the
// convenience is new.
//
// The rules that keep it that way:
//
//   1. ALLOW-LIST. The request names an action from a fixed set. Nothing from
//      the file ever reaches a command line — each action maps to a constant
//      argv chosen here. There is no "run this command" action, by design.
//   2. CONSUME BEFORE ACTING. The request is deleted first, so a crash or a
//      container restart mid-action cannot replay it into a loop.
//   3. IDS ARE SINGLE-USE. A request id is handled at most once, even if the
//      file reappears.
//   4. STALE REQUESTS ARE DROPPED. A request made while the agent was not
//      running is discarded rather than acted on minutes later, when it would
//      arrive as a surprise.
//   5. RATE LIMITED, SINGLE FLIGHT. One action at a time, and a floor between
//      actions, so a wedged server cannot spin your machine.
//   6. AUDITED. Every decision, including refusals, is appended to
//      .dojo-host/agent.log and printed here.
//   7. OPT-IN. Nothing installs, daemonises, or survives this terminal. No
//      agent running means the GUI simply shows the command to type, exactly as
//      it did before.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const hostChannel = require('../src/hostChannel');

const ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

const POLL_MS = 1000;          // a stat per second; the GUI should feel answered at once
const HEARTBEAT_MS = 5000;     // must stay well under hostChannel.STALE_STATUS_MS
const MAX_REQUEST_AGE_MS = 2 * 60 * 1000;
const MIN_ACTION_INTERVAL_MS = 10 * 1000;

// The whole allow-list. Each action is a fixed argv: no part of it is ever
// derived from the request file, so a malformed or hostile request can only be
// refused, never shaped into a different command.
const ACTIONS = {
	restart: {
		summary: 'restart the GUI container',
		steps: [['docker', ['compose', 'restart', 'ui']]]
	},
	recreate: {
		summary: 're-create the GUI container so it picks up new bot mounts',
		steps: [
			[process.execPath, [path.join(ROOT, 'scripts', 'composeOverride.js')]],
			['docker', ['compose', 'up', '-d', 'ui']]
		]
	},
	update: {
		summary: 'pull, rebuild and restart (npm run update)',
		steps: [[process.execPath, [path.join(ROOT, 'scripts', 'update.js')]]]
	}
};

// The server refuses on the same list before ever writing a request. If these
// two drift, one half would offer something the other rejects — fail loudly at
// startup rather than at the moment someone presses the button.
(function assertAllowListsAgree() {
	const mine = Object.keys(ACTIONS).sort().join(',');
	const shared = hostChannel.ACTIONS.slice().sort().join(',');
	if (mine !== shared) {
		throw new Error('host agent actions (' + mine + ') do not match hostChannel.ACTIONS (' + shared + ')');
	}
}());

function log(message) {
	const line = new Date().toISOString() + '  ' + message;
	console.log('[dojo-agent] ' + message);
	try {
		fs.mkdirSync(hostChannel.DIR, { recursive: true });
		fs.appendFileSync(hostChannel.LOG_PATH, line + '\n', 'utf8');
	} catch (e) { /* the console line is the important one */ }
}

function readRequest() {
	let text;
	try {
		text = fs.readFileSync(hostChannel.REQUEST_PATH, 'utf8');
	} catch (e) {
		return null;   // no request is the normal state
	}
	try {
		return JSON.parse(text);
	} catch (e) {
		// Consume it: leaving unparseable bytes there would re-warn every second.
		try { fs.unlinkSync(hostChannel.REQUEST_PATH); } catch (unlinkError) { /* gone already */ }
		log('refused: request.json is not valid JSON');
		return null;
	}
}

function runSteps(action) {
	for (const step of ACTIONS[action].steps) {
		// shell is needed on Windows to resolve docker/npm through PATHEXT. It is
		// safe here and only here BECAUSE every argument is a constant from
		// ACTIONS — see rule 1. Never interpolate a request value into this.
		const result = spawnSync(step[0], step[1], { stdio: 'inherit', shell: isWin, cwd: ROOT });
		if (result.status !== 0) {
			return { ok: false, message: step[0] + ' ' + step[1].join(' ') + ' exited ' + result.status };
		}
	}
	return { ok: true, message: null };
}

function createAgent(options) {
	options = options || {};
	const now = options.now || Date.now;
	const handledIds = new Set();
	let lastActionAt = 0;
	let lastResult = null;
	let busy = false;

	function writeStatus() {
		hostChannel.writeStatus({
			pid: process.pid,
			heartbeatAt: new Date(now()).toISOString(),
			actions: Object.keys(ACTIONS),
			busy: busy,
			lastResult: lastResult
		});
	}

	// Returns what it decided, so a test can assert on refusals without
	// scraping the log.
	function tick() {
		const request = readRequest();
		if (!request) return { handled: false, reason: 'idle' };
		if (busy) return { handled: false, reason: 'busy' };

		// Rule 2: consume before acting. Everything below reasons about a request
		// that no longer exists on disk.
		try { fs.unlinkSync(hostChannel.REQUEST_PATH); } catch (e) { /* already gone */ }

		const id = typeof request.id === 'string' ? request.id : null;
		const action = typeof request.action === 'string' ? request.action : null;

		if (!id || !action) { log('refused: request is missing id or action'); return { handled: false, reason: 'malformed' }; }
		if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
			log('refused: "' + action + '" is not an allowed action (' + Object.keys(ACTIONS).join(', ') + ')');
			lastResult = { id: id, action: action, ok: false, message: 'not an allowed action', finishedAt: new Date(now()).toISOString() };
			writeStatus();
			return { handled: false, reason: 'not-allowed' };
		}
		if (handledIds.has(id)) { log('ignored: request ' + id + ' was already handled'); return { handled: false, reason: 'duplicate' }; }

		const age = now() - Date.parse(request.requestedAt || '');
		if (!(age >= 0) || age > MAX_REQUEST_AGE_MS) {
			log('dropped: request ' + id + ' (' + action + ') is stale — the agent was not running when it was made');
			return { handled: false, reason: 'stale' };
		}
		if (now() - lastActionAt < MIN_ACTION_INTERVAL_MS) {
			log('dropped: ' + action + ' came less than ' + (MIN_ACTION_INTERVAL_MS / 1000) + 's after the last action');
			return { handled: false, reason: 'rate-limited' };
		}

		handledIds.add(id);
		lastActionAt = now();
		busy = true;
		writeStatus();
		log('running: ' + ACTIONS[action].summary);

		const outcome = options.run ? options.run(action) : runSteps(action);
		busy = false;
		lastResult = {
			id: id, action: action, ok: outcome.ok, message: outcome.message,
			finishedAt: new Date(now()).toISOString()
		};
		writeStatus();
		log(outcome.ok ? 'done: ' + action : 'FAILED: ' + action + ' — ' + outcome.message);
		return { handled: true, reason: outcome.ok ? 'ok' : 'failed', action: action };
	}

	return { tick: tick, writeStatus: writeStatus, actions: Object.keys(ACTIONS) };
}

// Exported as run() so `npm run ui -- --agent` can continue into the agent in
// the same terminal rather than asking for a second one.
function run() {
	fs.mkdirSync(hostChannel.DIR, { recursive: true });
	// A request left over from a previous session must not fire the moment the
	// agent starts — rule 4, applied at the one moment age alone cannot cover.
	try { fs.unlinkSync(hostChannel.REQUEST_PATH); } catch (e) { /* nothing stale */ }

	const agent = createAgent({});
	agent.writeStatus();
	log('watching ' + hostChannel.REQUEST_PATH);
	log('allowed actions: ' + agent.actions.join(', ') + '  (Ctrl-C to stop)');

	const poll = setInterval(agent.tick, POLL_MS);
	const heartbeat = setInterval(agent.writeStatus, HEARTBEAT_MS);

	function stop() {
		clearInterval(poll);
		clearInterval(heartbeat);
		// Clear the status so the GUI stops offering buttons that nothing will
		// answer, rather than waiting for the heartbeat to age out.
		hostChannel.clearStatus();
		log('stopped.');
		process.exit(0);
	}
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}

if (require.main === module) run();

module.exports = {
	ACTIONS: ACTIONS,
	createAgent: createAgent,
	run: run,
	MAX_REQUEST_AGE_MS: MAX_REQUEST_AGE_MS,
	MIN_ACTION_INTERVAL_MS: MIN_ACTION_INTERVAL_MS
};

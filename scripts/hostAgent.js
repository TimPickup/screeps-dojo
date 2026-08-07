'use strict';

// Host-side agent: performs the few things the GUI cannot do for itself.
//
// The server runs INSIDE the container. It can neither recreate its own
// container (a bind mount is only established at creation, which is why a new
// bot profile needs one) nor rebuild the image after a `git pull`. Both are
// host commands. So the container asks, and this agent — running on the host —
// answers.
//
// `npm run ui` starts it in the background for you. That launcher already
// builds images and recreates containers, so an agent that can do strictly less
// has no business being a second command to remember; making it one only meant
// the GUI's buttons quietly failed to appear.
//
//   npm run ui                  start the GUI, and this agent behind it
//   npm run ui -- --agent       ...but keep THIS terminal as the agent, to watch it
//   npm run ui -- --no-agent    ...and don't start it at all
//   npm run host-agent          start it on its own
//   npm run ui:stop             stop the GUI and the agent together
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
//   7. NOTHING IS INSTALLED. No service, no scheduled task, no autostart: it
//      lives and dies with `npm run ui` / `npm run ui:stop`, and only ever one
//      at a time. With no agent running the GUI simply shows the command to
//      type, exactly as it did before — so this is a convenience that can be
//      switched off without losing anything.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const hostChannel = require('../src/hostChannel');

const ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

const POLL_MS = 1000;          // a stat per second; the GUI should feel answered at once
const HEARTBEAT_MS = 5000;     // must stay well under hostChannel.STALE_STATUS_MS
const MAX_REQUEST_AGE_MS = 2 * 60 * 1000;
// The request is stamped in the CONTAINER and judged on the HOST, and those two
// clocks are not the same one — Docker Desktop's VM drifts, and it was measured
// here running ~700ms ahead. A request stamped in the near future is that, not a
// forgery, so treat it as fresh. Requiring age >= 0 made acceptance a coin flip
// between the skew and the write-to-read latency, which is why a dropped
// request would go through on a retry moments later.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
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
		fs.mkdirSync(hostChannel.dir(), { recursive: true });
		fs.appendFileSync(hostChannel.logPath(), line + '\n', 'utf8');
	} catch (e) { /* the console line is the important one */ }
}

function readRequest() {
	let text;
	try {
		text = fs.readFileSync(hostChannel.requestPath(), 'utf8');
	} catch (e) {
		return null;   // no request is the normal state
	}
	try {
		return JSON.parse(text);
	} catch (e) {
		// Consume it: leaving unparseable bytes there would re-warn every second.
		try { fs.unlinkSync(hostChannel.requestPath()); } catch (unlinkError) { /* gone already */ }
		log('refused: request.json is not valid JSON');
		return null;
	}
}

// Runs an action's steps in order, ASYNCHRONOUSLY. A synchronous spawn would
// block the event loop for the whole action, which is wrong twice over: the
// heartbeat stops, so a multi-minute update makes the GUI decide the agent has
// died and hide the very button that started it; and handing a shell an
// inherited file descriptor for output can wedge on Windows.
//
// Output is piped rather than inherited, and written to agent.log as it
// arrives, so the GUI can tail a rebuild instead of watching a spinner.
function runSteps(action) {
	return new Promise(function (resolve) {
		const steps = ACTIONS[action].steps.slice();
		const sink = fs.createWriteStream(hostChannel.logPath(), { flags: 'a' });
		function emit(chunk) {
			sink.write(chunk);
			if (process.stdout.isTTY) process.stdout.write(chunk);
		}
		function finish(outcome) { sink.end(); resolve(outcome); }
		function next() {
			const step = steps.shift();
			if (!step) { finish({ ok: true, message: null }); return; }
			const what = step[0] + ' ' + step[1].join(' ');
			let child;
			try {
				// shell is needed on Windows to resolve docker through PATHEXT. It is
				// safe here and only here BECAUSE every argument is a constant from
				// ACTIONS — see rule 1. Never interpolate a request value into this.
				// windowsHide matters here: shell:true goes through cmd.exe, and from a
				// DETACHED agent that opens a console window over whatever the user is
				// doing — blank, because the output is piped to us, so it reads as a
				// hung program rather than as progress.
				child = spawn(step[0], step[1], {
					shell: isWin, cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
				});
			} catch (e) {
				finish({ ok: false, message: what + ' could not start: ' + String((e && e.message) || e) });
				return;
			}
			child.stdout.on('data', emit);
			child.stderr.on('data', emit);
			child.on('error', function (e) { finish({ ok: false, message: what + ': ' + String((e && e.message) || e) }); });
			child.on('close', function (code) {
				if (code !== 0) { finish({ ok: false, message: what + ' exited ' + code }); return; }
				next();
			});
		}
		next();
	});
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
	// scraping the log. Async because an action can take minutes; `busy` is set
	// before the first await, so a poll landing mid-action sees it and backs off
	// while the heartbeat keeps going.
	async function tick() {
		const request = readRequest();
		if (!request) return { handled: false, reason: 'idle' };
		if (busy) return { handled: false, reason: 'busy' };

		// Rule 2: consume before acting. Everything below reasons about a request
		// that no longer exists on disk.
		try { fs.unlinkSync(hostChannel.requestPath()); } catch (e) { /* already gone */ }

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
		if (!Number.isFinite(age)) {
			log('refused: request ' + id + ' (' + action + ') has an unreadable timestamp');
			return { handled: false, reason: 'stale' };
		}
		if (age > MAX_REQUEST_AGE_MS) {
			log('dropped: request ' + id + ' (' + action + ') is stale — the agent was not running when it was made');
			return { handled: false, reason: 'stale' };
		}
		if (age < -MAX_CLOCK_SKEW_MS) {
			log('dropped: request ' + id + ' (' + action + ') is dated too far in the future to trust');
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

		const outcome = await (options.run ? options.run(action) : runSteps(action));
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

// Is a process with this pid alive? A heartbeat alone cannot answer that: an
// agent killed less than STALE_STATUS_MS ago still looks live, which would stop
// a legitimate restart. Both halves run on the same machine, so signal 0 is the
// direct answer.
function pidAlive(pid) {
	if (!pid) return false;
	try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Exclusive ownership, so two agents can never both consume one request and run
// its action twice — two concurrent `update`s would be genuinely bad. The pid
// check below narrows the window; only an atomic create closes it, because two
// starts in the same instant would both see no agent and both spawn.
//
// 'wx' fails if the file exists, and that failure IS the lock. A lock left by a
// force-killed agent is detected by its pid being dead and taken over — the one
// case where deleting someone else's lock is correct.
function acquireLock() {
	fs.mkdirSync(hostChannel.dir(), { recursive: true });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = fs.openSync(hostChannel.lockPath(), 'wx');
			fs.writeSync(fd, String(process.pid));
			fs.closeSync(fd);
			return true;
		} catch (e) {
			if (e.code !== 'EEXIST') throw e;
			const owner = Number(String(readLockOwner()));
			if (owner === process.pid) return true;
			if (pidAlive(owner)) return false;
			try { fs.unlinkSync(hostChannel.lockPath()); } catch (unlinkError) { /* another starter won the takeover */ }
		}
	}
	return false;
}

function readLockOwner() {
	try { return fs.readFileSync(hostChannel.lockPath(), 'utf8').trim(); } catch (e) { return ''; }
}

// Only ever release a lock we still own: a takeover means someone else's pid is
// in there now, and removing it would let a third agent in.
function releaseLock() {
	if (Number(readLockOwner()) !== process.pid) return;
	try { fs.unlinkSync(hostChannel.lockPath()); } catch (e) { /* already gone */ }
}

function liveAgent() {
	const status = hostChannel.readStatus();
	if (!hostChannel.isLive(status, Date.now())) return null;
	if (status.pid === process.pid) return null;
	return pidAlive(status.pid) ? status : null;
}

// Stops a detached agent — what `npm run ui:stop` calls, so stopping the GUI
// does not leave a watcher behind for a container that is no longer there.
function stopRunning() {
	const status = hostChannel.readStatus();
	if (!status || !pidAlive(status.pid)) { hostChannel.clearStatus(); return false; }
	try { process.kill(status.pid); } catch (e) { /* raced with its own exit */ }
	hostChannel.clearStatus();
	// A killed agent never runs its own handler, so its lock has to go too or the
	// next start would have to wait for the stale-pid takeover.
	try { fs.unlinkSync(hostChannel.lockPath()); } catch (e) { /* never locked */ }
	console.log('[dojo-agent] stopped (pid ' + status.pid + ')');
	return true;
}

// Starts the agent in the BACKGROUND and returns immediately. `npm run ui` uses
// this: it already builds images and recreates containers, so the agent — which
// can do strictly less — has no business being a second command to remember.
// The GUI degrades to printing commands whenever no agent answers, so a failure
// here is not worth stopping a launch over.
function startDetached() {
	const already = liveAgent();
	if (already) return { started: false, pid: already.pid, reason: 'already running' };
	try {
		const child = spawn(process.execPath, [__filename], {
			cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true
		});
		child.unref();
		return { started: true, pid: child.pid, reason: null };
	} catch (e) {
		return { started: false, pid: null, reason: String((e && e.message) || e) };
	}
}

// Runs in the FOREGROUND until interrupted. `npm run host-agent` and
// `npm run ui -- --agent` use this when you want to watch it work.
function run() {
	const already = liveAgent();
	if (already) {
		console.log('[dojo-agent] an agent is already running (pid ' + already.pid + ') — nothing to do.');
		console.log('[dojo-agent] stop it with: npm run ui:stop');
		return;
	}
	if (!acquireLock()) {
		console.log('[dojo-agent] another agent holds the lock (pid ' + readLockOwner() + ') — nothing to do.');
		return;
	}
	// A request left over from a previous session must not fire the moment the
	// agent starts — rule 4, applied at the one moment age alone cannot cover.
	try { fs.unlinkSync(hostChannel.requestPath()); } catch (e) { /* nothing stale */ }

	const agent = createAgent({});
	agent.writeStatus();
	log('watching ' + hostChannel.requestPath());
	log('allowed actions: ' + agent.actions.join(', ') + '  (Ctrl-C to stop)');

	// tick() returns a promise; its own `busy` flag is what prevents overlap, and
	// a rejection must not take the agent down with it.
	const poll = setInterval(function () {
		agent.tick().catch(function (e) { log('tick failed: ' + String((e && e.message) || e)); });
	}, POLL_MS);
	const heartbeat = setInterval(agent.writeStatus, HEARTBEAT_MS);

	function stop() {
		clearInterval(poll);
		clearInterval(heartbeat);
		// Clear the status so the GUI stops offering buttons that nothing will
		// answer, rather than waiting for the heartbeat to age out.
		hostChannel.clearStatus();
		releaseLock();
		log('stopped.');
		process.exit(0);
	}
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}

if (require.main === module) {
	if (process.argv.slice(2).includes('--stop')) stopRunning();
	else run();
}

module.exports = {
	ACTIONS: ACTIONS,
	createAgent: createAgent,
	run: run,
	startDetached: startDetached,
	stopRunning: stopRunning,
	acquireLock: acquireLock,
	releaseLock: releaseLock,
	readLockOwner: readLockOwner,
	liveAgent: liveAgent,
	pidAlive: pidAlive,
	MAX_REQUEST_AGE_MS: MAX_REQUEST_AGE_MS,
	MAX_CLOCK_SKEW_MS: MAX_CLOCK_SKEW_MS,
	MIN_ACTION_INTERVAL_MS: MIN_ACTION_INTERVAL_MS
};

'use strict';

// The file channel between the containerised server and the host agent, defined
// in ONE place so the two halves cannot drift on a path or a field name.
//
//   .dojo-host/request.json   server -> agent   { id, action, requestedAt }
//   .dojo-host/status.json    agent -> server   { pid, heartbeatAt, actions, busy, lastResult }
//   .dojo-host/agent.log      agent -> you      an audit trail of every decision
//
// Both sides see these through the same bind mount (`.:/dojo`), so this module
// is shared rather than duplicated. See scripts/hostAgent.js for why a file is
// the safe channel and what the agent refuses.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.dojo-host');
const REQUEST_PATH = path.join(DIR, 'request.json');
const STATUS_PATH = path.join(DIR, 'status.json');
const LOG_PATH = path.join(DIR, 'agent.log');
const LOCK_PATH = path.join(DIR, 'agent.lock');

// The agent heartbeats every 5s; three missed beats means it is gone. Long
// enough that a busy host does not flicker the GUI, short enough that stopping
// the agent is noticed before anyone clicks a button nothing will answer.
const STALE_STATUS_MS = 15000;

// The allow-list, shared so the server refuses exactly what the agent would.
// The agent owns the argv each of these maps to; the names live here because
// both halves have to agree on them. Adding one is a deliberate, reviewed act:
// there is no "run this command" action, and there must never be.
const ACTIONS = ['restart', 'recreate', 'update'];

const ACTION_SUMMARY = {
	restart: 'Restart the GUI container',
	recreate: 'Re-create the GUI container (picks up new bot mounts)',
	update: 'Pull, rebuild and restart'
};

function readJson(file) {
	try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// Write to a sibling, then rename over the target. A plain writeFileSync
// truncates first, so a reader landing in that window gets half a file: the
// status would read as "no agent" and blink the GUI's buttons away, and a
// half-written request would be deleted as unparseable — losing it silently.
// Both sides poll on a timer, so that window is hit eventually. rename() is
// atomic within a filesystem, which is what makes the reader see one or the
// other and never a mixture.
//
// The suffix is the writer's pid: the agent and the server both write in here,
// and two writers sharing one temp name would corrupt each other's file.
function writeJson(file, value) {
	fs.mkdirSync(DIR, { recursive: true });
	const temp = file + '.' + process.pid + '.tmp';
	fs.writeFileSync(temp, JSON.stringify(value, null, '\t') + '\n', 'utf8');
	try {
		fs.renameSync(temp, file);
	} catch (e) {
		// Never leave the scratch file behind to be mistaken for real state.
		try { fs.unlinkSync(temp); } catch (cleanupError) { /* nothing to remove */ }
		throw e;
	}
}

function writeStatus(status) { writeJson(STATUS_PATH, status); }
function readStatus() { return readJson(STATUS_PATH); }
function clearStatus() { try { fs.unlinkSync(STATUS_PATH); } catch (e) { /* never written */ } }

function readRequest() { return readJson(REQUEST_PATH); }
function writeRequest(request) { writeJson(REQUEST_PATH, request); }
function clearRequest() { try { fs.unlinkSync(REQUEST_PATH); } catch (e) { /* nothing pending */ } }

// Is an agent listening right now? Pure, so the server can test its own
// staleness rule without waiting on a clock.
function isLive(status, nowMs) {
	if (!status || !status.heartbeatAt) return false;
	const beat = Date.parse(status.heartbeatAt);
	if (!(beat >= 0)) return false;
	const age = nowMs - beat;
	// A clock skew between host and container can put the beat slightly in the
	// future; that is a live agent, not a dead one.
	return age < STALE_STATUS_MS;
}

module.exports = {
	DIR: DIR,
	REQUEST_PATH: REQUEST_PATH,
	STATUS_PATH: STATUS_PATH,
	LOG_PATH: LOG_PATH,
	LOCK_PATH: LOCK_PATH,
	STALE_STATUS_MS: STALE_STATUS_MS,
	ACTIONS: ACTIONS,
	ACTION_SUMMARY: ACTION_SUMMARY,
	readStatus: readStatus,
	writeStatus: writeStatus,
	clearStatus: clearStatus,
	readRequest: readRequest,
	writeRequest: writeRequest,
	clearRequest: clearRequest,
	isLive: isLive
};

'use strict';

// Harness-level warnings — a scenario reaching past the DojoWorld facade into
// the raw server, and anything else the harness wants to flag.
//
// They have to reach TWO places. The terminal, in colour, so they read as
// warnings rather than as another line of log; and the scenario console, which
// is what the GUI shows and what a recording keeps. A warning that only ever
// reaches the container's stdout is a warning nobody sees: running from the GUI
// there is no terminal to look at.

const YELLOW = '[33m';
const BOLD = '[1m';
const RESET = '[0m';

// The scenario console is plain text (the GUI colours the line itself, the
// recorder stores it verbatim), so it gets a marker instead of ANSI codes —
// the same '⚠' the runner already uses for bot errors.
const CONSOLE_PREFIX = '⚠ DOJO WARNING: ';

const pending = [];
const seen = new Set();
let suspended = 0;

function colour(text) {
	return process.env.NO_COLOR ? text : YELLOW + text + RESET;
}

// Emits a warning, at most once per `key` — a loop that pokes the db 500 times
// should say so once, not bury the run's output.
function warnOnce(key, message) {
	if (seen.has(key)) return false;
	seen.add(key);
	warn(message);
	return true;
}

function warn(message) {
	console.warn(colour(BOLD + '⚠ DOJO WARNING' + RESET + YELLOW + '  ' + message));
	pending.push(CONSOLE_PREFIX + message);
}

// Drains what has accumulated since the last call; the runner folds these into
// the scenario console so they land in the GUI, the stream and the recording.
function take() {
	if (!pending.length) return [];
	const drained = pending.slice();
	pending.length = 0;
	return drained;
}

// The engine writes to the same collections we watch, and in the fast
// in-process mode it does so in this very process — so checks are suspended
// while the engine runs a tick. Nothing a scenario does happens in that window,
// and it keeps a hot path free of stack captures.
function suspend() { suspended += 1; }
function resume() { if (suspended > 0) suspended -= 1; }
function isSuspended() { return suspended > 0; }

// Test seam: a fresh world should start with a clean slate.
function reset() {
	pending.length = 0;
	seen.clear();
	suspended = 0;
}

module.exports = {
	warn: warn,
	warnOnce: warnOnce,
	take: take,
	suspend: suspend,
	resume: resume,
	isSuspended: isSuspended,
	reset: reset,
	CONSOLE_PREFIX: CONSOLE_PREFIX
};

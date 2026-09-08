'use strict';

// Saying something while npm says nothing.
//
// npm prints NOTHING for minutes at a time while it fetches and compiles —
// there is no terminal for it to draw a progress bar on. Measured on a real
// rebuild: 293 seconds of silence, and the last thing on screen was a
// deprecation warning, so a healthy install looked like it had died on that
// warning. The only fix is to say something ourselves, and to say how long it
// has been going.
//
// Shared by the host agent (which streams a rebuild into the GUI) and the
// in-container installer (which streams a first-run or repair install into the
// setup screen). They had the same problem; only one of them had the answer.
const QUIET_BEFORE_HEARTBEAT_MS = 25 * 1000;
const HEARTBEAT_TICK_MS = 10 * 1000;
const NEWLINE = String.fromCharCode(10);

// null while output is still flowing; a line to print once it has gone quiet.
// Pure, so the thing the user actually reads is covered by a test.
function heartbeatLine(quietMs, elapsedMs) {
	if (quietMs < QUIET_BEFORE_HEARTBEAT_MS) return null;
	const mins = Math.round(elapsedMs / 60000);
	return '  …still working (' + (mins < 1 ? 'under a minute' : mins + ' min') + ' so far)' + NEWLINE;
}

// Wires the above to a running child: calls emit(line) whenever output has gone
// quiet. Returns a stop function, and a bump() to call on every chunk received.
function startHeartbeat(emit) {
	const startedAt = Date.now();
	let lastOutputAt = Date.now();
	const timer = setInterval(function () {
		const line = heartbeatLine(Date.now() - lastOutputAt, Date.now() - startedAt);
		if (line) emit(line);
	}, HEARTBEAT_TICK_MS);
	if (timer.unref) timer.unref();   // never hold a process open on its own account
	return {
		bump: function () { lastOutputAt = Date.now(); },
		stop: function () { clearInterval(timer); }
	};
}

module.exports = {
	QUIET_BEFORE_HEARTBEAT_MS: QUIET_BEFORE_HEARTBEAT_MS,
	HEARTBEAT_TICK_MS: HEARTBEAT_TICK_MS,
	heartbeatLine: heartbeatLine,
	startHeartbeat: startHeartbeat
};

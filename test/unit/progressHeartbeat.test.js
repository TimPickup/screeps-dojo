'use strict';

// The line someone stares at when npm has gone quiet. Measured on a real
// rebuild: 293 seconds of silence, and the last thing on screen was one of
// npm's deprecation warnings — so a healthy install read as having died on that
// warning. Both the host agent and the in-container installer print this now.
const assert = require('assert');
const { heartbeatLine, startHeartbeat, QUIET_BEFORE_HEARTBEAT_MS } = require('../../src/progressHeartbeat');

describe('progress heartbeat', function () {
	it('says nothing while output is still flowing', function () {
		assert.strictEqual(heartbeatLine(0, 60000), null);
		assert.strictEqual(heartbeatLine(QUIET_BEFORE_HEARTBEAT_MS - 1, 60000), null);
	});

	it('speaks up once the output has gone quiet, and says how long', function () {
		const line = heartbeatLine(QUIET_BEFORE_HEARTBEAT_MS + 1, 3 * 60000);
		assert.match(line, /still working/);
		assert.match(line, /3 min so far/);
	});

	it('avoids saying "0 min" in the first minute', function () {
		// Rounding elapsed time gives "0 min so far", which reads as a stall
		// rather than as progress.
		assert.match(heartbeatLine(QUIET_BEFORE_HEARTBEAT_MS + 1, 20000), /under a minute/);
	});

	it('ends the line, so it cannot glue itself to the next chunk of npm output', function () {
		assert.ok(heartbeatLine(QUIET_BEFORE_HEARTBEAT_MS + 1, 60000).endsWith('\n'));
	});

	it('stops cleanly and holds nothing open', function () {
		const emitted = [];
		const hb = startHeartbeat(function (line) { emitted.push(line); });
		hb.bump();
		hb.stop();
		assert.deepStrictEqual(emitted, [], 'nothing yet: output was flowing');
	});
});

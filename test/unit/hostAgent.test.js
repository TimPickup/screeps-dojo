'use strict';

// The agent's REFUSALS are the security boundary, so they are what this pins
// down: an action outside the allow-list, a replayed id, a stale request, and a
// burst all have to be dropped without ever reaching a command.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const hostChannel = require('../../src/hostChannel');
const hostAgent = require('../../scripts/hostAgent');

describe('hostChannel', function () {
	describe('isLive', function () {
		const beat = function (msAgo) { return { heartbeatAt: new Date(1000000 - msAgo).toISOString() }; };

		it('is live while the heartbeat is fresh', function () {
			assert.strictEqual(hostChannel.isLive(beat(1000), 1000000), true);
		});

		it('goes dead once the heartbeat ages out', function () {
			assert.strictEqual(hostChannel.isLive(beat(hostChannel.STALE_STATUS_MS + 1), 1000000), false);
		});

		it('tolerates a beat slightly in the future — host and container clocks differ', function () {
			assert.strictEqual(hostChannel.isLive(beat(-2000), 1000000), true);
		});

		it('treats a missing or malformed status as no agent', function () {
			assert.strictEqual(hostChannel.isLive(null, 1000000), false);
			assert.strictEqual(hostChannel.isLive({}, 1000000), false);
			assert.strictEqual(hostChannel.isLive({ heartbeatAt: 'nonsense' }, 1000000), false);
		});
	});

	it('offers no action that runs an arbitrary command', function () {
		// The point of the allow-list. If this ever grows an escape hatch, it
		// should be a deliberate, reviewed change — not a quiet one.
		assert.deepStrictEqual(hostChannel.ACTIONS.slice().sort(), ['recreate', 'restart', 'update']);
	});
});

describe('hostAgent', function () {
	let clock, ran;

	beforeEach(function () {
		clock = 10 * 60 * 1000;   // comfortably past MIN_ACTION_INTERVAL_MS from zero
		ran = [];
		hostChannel.clearRequest();
		hostChannel.clearStatus();
	});

	after(function () {
		hostChannel.clearRequest();
		hostChannel.clearStatus();
		try { fs.rmSync(hostChannel.DIR, { recursive: true, force: true }); } catch (e) { /* leave it */ }
	});

	function makeAgent() {
		return hostAgent.createAgent({
			now: function () { return clock; },
			run: function (action) { ran.push(action); return { ok: true, message: null }; }
		});
	}

	function request(fields) {
		hostChannel.writeRequest(Object.assign(
			{ id: 'id-1', action: 'restart', requestedAt: new Date(clock).toISOString() }, fields));
	}

	it('runs an allowed action and consumes the request', async function () {
		const agent = makeAgent();
		request({});
		assert.deepStrictEqual(await agent.tick(), { handled: true, reason: 'ok', action: 'restart' });
		assert.deepStrictEqual(ran, ['restart']);
		assert.strictEqual(fs.existsSync(hostChannel.REQUEST_PATH), false, 'the request must be consumed');
	});

	it('refuses an action outside the allow-list', async function () {
		const agent = makeAgent();
		request({ action: 'rm -rf /' });
		assert.strictEqual((await agent.tick()).reason, 'not-allowed');
		assert.deepStrictEqual(ran, []);
	});

	it('refuses a request that smuggles its own command', async function () {
		// Nothing but `action` is ever read, so extra fields are inert.
		const agent = makeAgent();
		request({ action: 'restart', command: 'shutdown /s', args: ['--now'] });
		(await agent.tick());
		assert.deepStrictEqual(ran, ['restart'], 'only the named action may run');
	});

	it('handles an id at most once, even if the file comes back', async function () {
		const agent = makeAgent();
		request({ id: 'same' });
		(await agent.tick());
		clock += hostAgent.MIN_ACTION_INTERVAL_MS + 1;
		request({ id: 'same' });
		assert.strictEqual((await agent.tick()).reason, 'duplicate');
		assert.deepStrictEqual(ran, ['restart']);
	});

	it('drops a request made while no agent was listening', async function () {
		const agent = makeAgent();
		request({ requestedAt: new Date(clock - hostAgent.MAX_REQUEST_AGE_MS - 1).toISOString() });
		assert.strictEqual((await agent.tick()).reason, 'stale');
		assert.deepStrictEqual(ran, []);
	});

	it('drops a request with an unusable timestamp', async function () {
		const agent = makeAgent();
		request({ requestedAt: 'whenever' });
		assert.strictEqual((await agent.tick()).reason, 'stale');
		assert.deepStrictEqual(ran, []);
	});

	it('rate-limits a burst so a wedged server cannot spin the host', async function () {
		const agent = makeAgent();
		request({ id: 'a' });
		(await agent.tick());
		request({ id: 'b' });
		assert.strictEqual((await agent.tick()).reason, 'rate-limited');
		clock += hostAgent.MIN_ACTION_INTERVAL_MS + 1;
		request({ id: 'c' });
		assert.strictEqual((await agent.tick()).reason, 'ok');
		assert.deepStrictEqual(ran, ['restart', 'restart']);
	});

	it('consumes unparseable bytes instead of warning about them every second', async function () {
		const agent = makeAgent();
		fs.mkdirSync(hostChannel.DIR, { recursive: true });
		fs.writeFileSync(hostChannel.REQUEST_PATH, '{ not json', 'utf8');
		assert.strictEqual((await agent.tick()).reason, 'idle');
		assert.strictEqual(fs.existsSync(hostChannel.REQUEST_PATH), false);
	});

	it('refuses a request with no id or no action', async function () {
		const agent = makeAgent();
		request({ id: undefined });
		assert.strictEqual((await agent.tick()).reason, 'malformed');
		request({ action: undefined });
		assert.strictEqual((await agent.tick()).reason, 'malformed');
		assert.deepStrictEqual(ran, []);
	});

	it('publishes a heartbeat the server can read', function () {
		const agent = makeAgent();
		agent.writeStatus();
		const status = hostChannel.readStatus();
		assert.strictEqual(status.pid, process.pid);
		assert.deepStrictEqual(status.actions.slice().sort(), ['recreate', 'restart', 'update']);
		assert.strictEqual(hostChannel.isLive(status, clock), true);
	});

	it('keeps beating through a long action, so the GUI does not give up on it', async function () {
		// A synchronous spawn blocked the loop for the whole action: the heartbeat
		// stopped, and after 15s the GUI decided the agent had died and hid the
		// button that started the update still running.
		let release;
		const agent = hostAgent.createAgent({
			now: function () { return clock; },
			run: function () { return new Promise(function (resolve) { release = resolve; }); }
		});
		request({});
		const running = agent.tick();
		await new Promise(function (r) { setImmediate(r); });

		assert.strictEqual(hostChannel.readStatus().busy, true, 'status should say busy while it works');
		clock += 60 * 1000;
		agent.writeStatus();   // what the heartbeat interval does; the loop is free to run it
		assert.strictEqual(hostChannel.isLive(hostChannel.readStatus(), clock), true);

		// a poll landing mid-action must back off rather than start a second one
		request({ id: 'while-busy' });
		assert.strictEqual((await agent.tick()).reason, 'busy');

		release({ ok: true, message: null });
		assert.strictEqual((await running).reason, 'ok');
	});

	it('reports a failed action rather than claiming success', async function () {
		const agent = hostAgent.createAgent({
			now: function () { return clock; },
			run: function () { return { ok: false, message: 'docker exited 1' }; }
		});
		request({});
		assert.strictEqual((await agent.tick()).reason, 'failed');
		assert.strictEqual(hostChannel.readStatus().lastResult.ok, false);
		assert.match(hostChannel.readStatus().lastResult.message, /docker exited 1/);
	});

	describe('single instance', function () {
		it('sees no agent when nothing has written a status', function () {
			hostChannel.clearStatus();
			assert.strictEqual(hostAgent.liveAgent(), null);
		});

		it('ignores a fresh heartbeat whose process is gone', function () {
			// A force-killed agent leaves status.json behind with a heartbeat that
			// is still inside the staleness window. Trusting it alone would refuse
			// a legitimate restart for the next 15 seconds.
			hostChannel.writeStatus({ pid: 0x7ffffffe, heartbeatAt: new Date().toISOString(), actions: hostChannel.ACTIONS });
			assert.strictEqual(hostAgent.liveAgent(), null);
			hostChannel.clearStatus();
		});

		it('does not mistake its own process for a second agent', function () {
			hostChannel.writeStatus({ pid: process.pid, heartbeatAt: new Date().toISOString(), actions: hostChannel.ACTIONS });
			assert.strictEqual(hostAgent.liveAgent(), null);
			hostChannel.clearStatus();
		});

		it('reports this process as alive and an absurd pid as not', function () {
			assert.strictEqual(hostAgent.pidAlive(process.pid), true);
			assert.strictEqual(hostAgent.pidAlive(0x7ffffffe), false);
			assert.strictEqual(hostAgent.pidAlive(0), false);
		});

		it('stopRunning clears a status whose process is already gone', function () {
			hostChannel.writeStatus({ pid: 0x7ffffffe, heartbeatAt: new Date().toISOString(), actions: hostChannel.ACTIONS });
			assert.strictEqual(hostAgent.stopRunning(), false);
			assert.strictEqual(hostChannel.readStatus(), null);
		});
	});

	it('maps every allowed action to a fixed argv, never to request content', function () {
		for (const name of hostChannel.ACTIONS) {
			const action = hostAgent.ACTIONS[name];
			assert.ok(action, name + ' is offered but has no steps');
			for (const step of action.steps) {
				assert.strictEqual(typeof step[0], 'string');
				assert.ok(Array.isArray(step[1]), name + ' args must be an array, not a string to be split by a shell');
				for (const arg of step[1]) assert.strictEqual(typeof arg, 'string');
			}
		}
	});
});

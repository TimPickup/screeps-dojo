'use strict';

const assert = require('assert');
const warnings = require('../../src/harnessWarnings');

describe('harnessWarnings', function () {
	beforeEach(function () {
		warnings.reset();
	});

	after(function () {
		warnings.reset();
	});

	// The warning has to survive the trip to the GUI, which never sees stdout.
	it('queues each warning as a console line for the runner to drain', function () {
		warnings.warn('something raw happened');
		const drained = warnings.take();
		assert.deepStrictEqual(drained, [warnings.CONSOLE_PREFIX + 'something raw happened']);
		assert.deepStrictEqual(warnings.take(), [], 'draining twice must not repeat the line');
	});

	// The '⚠' prefix is what the GUI keys its amber styling off, and what the
	// runner already uses for bot errors.
	it('marks console lines so they can be spotted and styled', function () {
		warnings.warn('x');
		assert.ok(warnings.take()[0].startsWith('⚠'), 'a warning line must be visibly marked');
	});

	// A loop that pokes the db 500 times should say so once.
	it('warnOnce reports a given key only once', function () {
		assert.strictEqual(warnings.warnOnce('site-a', 'first'), true);
		assert.strictEqual(warnings.warnOnce('site-a', 'first'), false);
		assert.strictEqual(warnings.warnOnce('site-b', 'second'), true);
		assert.strictEqual(warnings.take().length, 2);
	});

	// The engine writes to the guarded collections itself, so checks stand down
	// while it runs a tick — nested, because start() and tick() can overlap.
	it('suspends and resumes in nesting pairs', function () {
		assert.strictEqual(warnings.isSuspended(), false);
		warnings.suspend();
		warnings.suspend();
		warnings.resume();
		assert.strictEqual(warnings.isSuspended(), true, 'still suspended until every suspend is matched');
		warnings.resume();
		assert.strictEqual(warnings.isSuspended(), false);
	});

	it('reset clears queued lines and the once-per-key memory', function () {
		warnings.warnOnce('site', 'msg');
		warnings.reset();
		assert.deepStrictEqual(warnings.take(), []);
		assert.strictEqual(warnings.warnOnce('site', 'msg'), true, 'a fresh run warns again');
	});
});

'use strict';

// The engine driver factory (src/drivers.js): name -> world implementation.
// Deliberately tiny — these tests pin the selection precedence (explicit arg,
// then DOJO_ENGINE, then the mockup default) and that an unknown engine fails
// loudly at selection time instead of exploding somewhere inside a run.
// Needs the engine (instances are compared against DojoWorld), so it runs
// in-container like the other engine tests.
const assert = require('assert');
const { createWorld } = require('../../src/drivers');
const DojoWorld = require('../../src/dojoWorld');

describe('drivers', function () {
	// docker-compose injects DOJO_ENGINE=mockup into the container, which would
	// mask the DEFAULT branch of the precedence chain — clear it before each
	// test, and restore the original value afterwards so nothing later in this
	// mocha process sees a stripped environment.
	let savedEngine;
	before(function () { savedEngine = process.env.DOJO_ENGINE; });
	beforeEach(function () { delete process.env.DOJO_ENGINE; });
	after(function () {
		if (savedEngine === undefined) delete process.env.DOJO_ENGINE;
		else process.env.DOJO_ENGINE = savedEngine;
	});

	it('defaults to the mockup engine', function () {
		assert.ok(createWorld() instanceof DojoWorld);
	});

	it('selects an engine by explicit name', function () {
		assert.ok(createWorld('mockup') instanceof DojoWorld);
	});

	it('honors DOJO_ENGINE when no explicit name is given', function () {
		process.env.DOJO_ENGINE = 'mockup';
		assert.ok(createWorld() instanceof DojoWorld);
	});

	it('rejects an unknown engine with a clear error', function () {
		assert.throws(function () { createWorld('bogus'); }, /unknown engine 'bogus'/);
		process.env.DOJO_ENGINE = 'bogus';
		assert.throws(function () { createWorld(); }, /unknown engine 'bogus'/);
	});

	it('rejects inherited object keys, not just missing ones', function () {
		// 'constructor' is a truthy lookup on any plain object — it must still
		// fail at selection time, not as a confusing crash inside `new World()`
		assert.throws(function () { createWorld('constructor'); }, /unknown engine 'constructor'/);
	});
});

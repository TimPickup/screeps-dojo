'use strict';

// Engine driver factory (the seam from issue #1): engine name -> world
// implementation. The runner constructs its world here instead of hard-wiring
// `new DojoWorld()`, so an alternative engine backend is just another entry
// implementing the driver contract documented atop src/dojoWorld.js.
//
// Each entry is a thunk, not a require: a driver's dependencies must never
// load unless that engine is actually selected (a future engine may ship as
// an optional dependency, or not be installed at all).
const drivers = {
	mockup: function () { return require('./dojoWorld'); }
};

// Selection precedence: explicit name (runScenario's options.engine), then
// DOJO_ENGINE from the environment (.env — same pattern as DOJO_BOT_PATH),
// then the mockup default.
function createWorld(engine) {
	const name = engine || process.env.DOJO_ENGINE || 'mockup';
	// own-property check, not a truthy lookup: an inherited key like
	// 'constructor' must fail loudly here too, not deep inside `new World()`
	if (!Object.prototype.hasOwnProperty.call(drivers, name)) {
		throw new Error("unknown engine '" + name + "' (available: "
			+ Object.keys(drivers).join(', ') + ') — check DOJO_ENGINE in .env, or the engine option');
	}
	const World = drivers[name]();
	return new World();
}

module.exports = { createWorld: createWorld };

'use strict';

// The engine driver seam (issue #1): DojoWorld is one class, and the code that
// touches a specific engine's server/storage internals lives in a driver that
// is required only when a world is actually constructed. The point of the
// late require is the future in-process engine, which must be able to run
// OUTSIDE the container — so merely loading the shared runner path must not
// pull in screeps-server-mockup (or anything else engine-specific).
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

// Requires `moduleId` in a fresh node process and reports which engine-side
// modules ended up in require.cache. A fresh process, not require.cache
// surgery here: mocha has long since loaded the mockup for the other suites.
function engineModulesLoadedBy(moduleId) {
	const probe = 'require(' + JSON.stringify(moduleId) + ');'
		+ 'const hits = Object.keys(require.cache).filter(function (id) {'
		+ 'return id.includes("screeps-server-mockup") || id.includes("/@screeps/") || id.endsWith("serverBoot.js");'
		+ '});'
		+ 'console.log(JSON.stringify(hits));';
	const result = spawnSync(process.execPath, ['-e', probe], { cwd: ROOT, encoding: 'utf8' });
	assert.strictEqual(result.status, 0, 'probe process failed:\n' + result.stderr);
	return JSON.parse(result.stdout);
}

describe('engine driver seam', function () {
	it('requiring dojoWorld loads no engine', function () {
		assert.deepStrictEqual(engineModulesLoadedBy('./src/dojoWorld'), []);
	});

	it('requiring the scenario runner loads no engine', function () {
		assert.deepStrictEqual(engineModulesLoadedBy('./src/scenarioRunner'), []);
	});

	it('an unknown engine fails with a clear error, before any require', function () {
		const DojoWorld = require('../../src/dojoWorld');
		assert.throws(function () {
			new DojoWorld({ engine: 'martian' });
		}, /unknown engine 'martian'.*mockup/);
	});
});

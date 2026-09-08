'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mods = require('../../src/mods');

// A synthetic catalog for the rules that the real one (a single mod) cannot
// exercise: ordering, dependencies and conflicts.
function fakeRegistry() {
	const entry = function (id, order, extra) {
		return Object.assign({
			id: id, name: id, description: id, module: 'lodash', version: '0',
			source: 'test', order: order, requires: [], conflicts: [],
			supported: [], unavailable: [], probes: []
		}, extra || {});
	};
	return mods.createRegistry([
		entry('zebra', 10),
		entry('alpha', 20, { requires: ['zebra'] }),
		entry('omega', 20, { conflicts: ['zebra'] })
	]);
}

describe('mods registry', function () {
	describe('catalog', function () {
		it('lists season5 with what does and does not work here', function () {
			const list = mods.catalog();
			assert.deepStrictEqual(list.map(function (m) { return m.id; }), ['season5']);
			assert.strictEqual(list[0].name, 'Season 5');
			assert.ok(list[0].supported.length > 0, 'supported mechanics are listed for the UI');
			assert.ok(list[0].unavailable.some(function (line) { return /generation/i.test(line); }),
				'the UI must be able to say world generation is not included');
		});

		it('hands out copies, so a caller cannot edit the catalog', function () {
			mods.catalog()[0].supported.push('nonsense');
			assert.ok(mods.catalog()[0].supported.indexOf('nonsense') === -1);
		});
	});

	describe('validate', function () {
		it('treats a missing or empty list as vanilla', function () {
			assert.deepStrictEqual(mods.validate(undefined), []);
			assert.deepStrictEqual(mods.validate(null), []);
			assert.deepStrictEqual(mods.validate([]), []);
		});

		it('normalizes case and drops duplicates', function () {
			assert.deepStrictEqual(mods.validate(['Season5', 'season5', ' SEASON5 ']), ['season5']);
		});

		it('rejects an unknown mod and names what is available', function () {
			assert.throws(function () { mods.validate(['season4'], 'x/settings.json'); },
				/x\/settings\.json: unknown mod "season4" \(available: season5\)/);
		});

		it('rejects a non-array, empty entries and non-strings', function () {
			assert.throws(function () { mods.validate('season5'); }, /"mods" must be an array/);
			assert.throws(function () { mods.validate(['']); }, /non-empty mod IDs/);
			assert.throws(function () { mods.validate([{ id: 'season5' }]); }, /non-empty mod IDs/);
		});

		it('rejects anything that looks like a path or a URL', function () {
			// The point of the catalog: scenario input can never name a module.
			assert.throws(function () { mods.validate(['../../evil']); }, /invalid mod ID/);
			assert.throws(function () { mods.validate(['/etc/passwd']); }, /invalid mod ID/);
			assert.throws(function () { mods.validate(['github:screeps/mod-season5']); }, /invalid mod ID/);
		});

		it('orders by the catalog, not by the order they were listed', function () {
			const registry = fakeRegistry();
			assert.deepStrictEqual(registry.validate(['alpha', 'zebra']), ['zebra', 'alpha']);
			assert.deepStrictEqual(registry.validate(['zebra', 'alpha']), ['zebra', 'alpha']);
		});

		it('enforces dependencies and conflicts', function () {
			const registry = fakeRegistry();
			assert.throws(function () { registry.validate(['alpha']); }, /mod "alpha" requires "zebra"/);
			assert.throws(function () { registry.validate(['omega', 'zebra']); }, /cannot be used together/);
			assert.deepStrictEqual(registry.validate(['omega']), ['omega']);
		});
	});

	describe('resolveModules', function () {
		it('resolves the catalog module name, never the caller\'s string', function () {
			const resolved = mods.resolveModules(['season5']);
			assert.strictEqual(resolved.length, 1);
			assert.ok(path.isAbsolute(resolved[0]), 'the engine reads mods.json from a different cwd');
			assert.ok(resolved[0].indexOf('mod-season5') !== -1, resolved[0]);
		});

		it('says the package is missing rather than throwing MODULE_NOT_FOUND', function () {
			const registry = mods.createRegistry([{
				id: 'ghost', name: 'g', description: 'g', module: '@screeps/mod-does-not-exist',
				version: '0', source: 'nowhere', order: 1, requires: [], conflicts: [],
				supported: [], unavailable: [], probes: []
			}]);
			assert.throws(function () { registry.resolveModules(['ghost']); },
				/mod "ghost" is not installed.*rebuild the container image/s);
		});
	});

	describe('createModFile', function () {
		it('writes absolute module paths in the shape the engine reads', function () {
			const handle = mods.createModFile(['season5']);
			try {
				const written = JSON.parse(fs.readFileSync(handle.path, 'utf8'));
				assert.deepStrictEqual(Object.keys(written).sort(), ['bots', 'mods']);
				assert.deepStrictEqual(written.bots, {});
				assert.strictEqual(written.mods.length, 1);
				assert.ok(path.isAbsolute(written.mods[0]));
				assert.strictEqual(path.basename(handle.path), 'mods.json');
			} finally {
				handle.cleanup();
			}
		});

		it('removes the file on cleanup, twice safely', function () {
			const handle = mods.createModFile(['season5']);
			handle.cleanup();
			handle.cleanup();
			assert.strictEqual(fs.existsSync(handle.path), false);
		});

		it('writes into a caller-supplied directory without removing it', function () {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-modfile-'));
			const handle = mods.createModFile(['season5'], { dir: dir });
			assert.strictEqual(handle.path, path.join(dir, 'mods.json'));
			handle.cleanup();
			assert.strictEqual(fs.existsSync(dir), true);
			fs.rmdirSync(dir);
		});

		it('writes nothing for a vanilla run', function () {
			assert.strictEqual(mods.createModFile([]), null);
			assert.strictEqual(mods.createModFile(undefined), null);
		});
	});

	describe('objectDefaults', function () {
		it('is empty for a vanilla run and for untouched types', function () {
			assert.deepStrictEqual(mods.objectDefaults([], 'reactor', {}), {});
			assert.deepStrictEqual(mods.objectDefaults(['season5'], 'spawn', {}), {});
		});

		it('gives a reactor a store the processor can read', function () {
			assert.deepStrictEqual(mods.objectDefaults(['season5'], 'reactor', {}),
				{ store: {}, storeCapacityResource: { T: 1000 } });
		});

		it('gives a Thorium mineral an amount, so Season 5 does not delete it', function () {
			assert.deepStrictEqual(mods.objectDefaults(['season5'], 'mineral', { mineralType: 'T' }),
				{ density: 3, mineralAmount: 45000 });
			assert.deepStrictEqual(mods.objectDefaults(['season5'], 'mineral', { mineralType: 'T', density: 1 }),
				{ density: 1, mineralAmount: 10000 });
		});

		it('leaves ordinary minerals alone', function () {
			assert.deepStrictEqual(mods.objectDefaults(['season5'], 'mineral', { mineralType: 'H' }), {});
		});

		it('gives an invader core a deposit type, since the cronjob never runs', function () {
			assert.deepStrictEqual(mods.objectDefaults(['season5'], 'invaderCore', {}), { depositType: 'normal' });
		});
	});

	describe('importTypes', function () {
		it('lists the object types a mod adds to the room importer', function () {
			assert.deepStrictEqual(mods.importTypes(['season5']), ['reactor']);
			assert.deepStrictEqual(mods.importTypes([]), []);
			assert.deepStrictEqual(mods.importTypes(undefined), []);
		});
	});

	describe('suppressesRegen', function () {
		it('marks Season 5 Thorium as finite', function () {
			assert.strictEqual(mods.suppressesRegen(['season5'], 'mineral', { mineralType: 'T' }), true);
		});

		it('leaves every other mineral, and vanilla, alone', function () {
			assert.strictEqual(mods.suppressesRegen(['season5'], 'mineral', { mineralType: 'H' }), false);
			assert.strictEqual(mods.suppressesRegen(['season5'], 'source', {}), false);
			assert.strictEqual(mods.suppressesRegen([], 'mineral', { mineralType: 'T' }), false);
			assert.strictEqual(mods.suppressesRegen(['season5'], 'mineral', undefined), false);
		});
	});

	describe('probe', function () {
		const healthy = {
			constants: { RESOURCE_THORIUM: 'T', RESOURCES_ALL: ['energy', 'T'], FIND_REACTORS: 10051, LOOK_REACTORS: 'reactor' },
			strongholds: { coreRewards: { normal: [], nuked: [] } },
			customObjectPrototypes: [{ objectType: 'reactor' }, { objectType: 'dummy' }],
			customIntentTypes: { claimReactor: { id: 'string' } }
		};

		it('passes on a fully loaded mod', function () {
			const passed = mods.probe(['season5'], healthy);
			assert.strictEqual(passed.length, 6);
		});

		it('does nothing for a vanilla run', function () {
			assert.deepStrictEqual(mods.probe([], null), []);
		});

		it('names the failed check, the package and the run when the mod half-loaded', function () {
			const broken = Object.assign({}, healthy, { customObjectPrototypes: [] });
			assert.throws(function () {
				mods.probe(['season5'], broken, { scenario: 'reactor-demo', modFile: '/tmp/x/mods.json', engineMode: 'in-process' });
			}, function (e) {
				assert.ok(/did not load correctly/.test(e.message), e.message);
				assert.ok(/reactor.*custom prototype/.test(e.message), e.message);
				assert.ok(/mod-season5@1\.0\.3/.test(e.message), e.message);
				assert.ok(/reactor-demo/.test(e.message), e.message);
				assert.ok(/in-process/.test(e.message), e.message);
				return true;
			});
		});

		it('reports a probe that throws instead of crashing the run', function () {
			assert.throws(function () { mods.probe(['season5'], { constants: {} }); },
				/probe threw|did not load correctly/);
		});
	});
});

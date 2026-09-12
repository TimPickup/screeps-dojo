'use strict';

// world.loadMap / world.loadMaps read a scenario's own map.*.json files, so a
// scenario.js never has to hand-roll fs+path map loading. Pure file reading —
// no server is booted here (loadAllMaps, which also seeds the world, is
// covered in test/integration).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DojoWorld = require('../../src/dojoWorld');

function tmpScenario(files) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-maps-'));
	for (const name of Object.keys(files)) {
		fs.writeFileSync(path.join(dir, name), JSON.stringify(files[name]));
	}
	return dir;
}

// DojoWorld's constructor boots no server until reset(), so building one just
// to read files is cheap.
function worldIn(dir) {
	return new DojoWorld({ scenarioDir: dir });
}

describe('world.loadMap / world.loadMaps', function () {
	const dirs = [];
	function scenario(files) {
		const dir = tmpScenario(files);
		dirs.push(dir);
		return dir;
	}

	after(function () {
		for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
	});

	it('loadMap reads map.<room>.json from the scenario dir', function () {
		const dir = scenario({ 'map.W1N1.json': { room: 'W1N1', terrain: ['.'] } });
		assert.deepStrictEqual(worldIn(dir).loadMap('W1N1'), { room: 'W1N1', terrain: ['.'] });
	});

	it('loadMap names the maps that DO exist when one is missing', function () {
		const dir = scenario({ 'map.W1N1.json': { room: 'W1N1' } });
		assert.throws(function () { worldIn(dir).loadMap('W9N9'); },
			/map\.W9N9\.json[\s\S]*map\.W1N1\.json/);
	});

	it('loadMaps returns every map in the dir, sorted by file name', function () {
		const dir = scenario({
			'map.W1N1.json': { room: 'W1N1' },
			'map.W0N1.json': { room: 'W0N1' },
			'map.W2N1.json': { room: 'W2N1' }
		});
		assert.deepStrictEqual(worldIn(dir).loadMaps().map(function (m) { return m.room; }),
			['W0N1', 'W1N1', 'W2N1']);
	});

	it('loadMaps reads a bare map.json too', function () {
		const dir = scenario({ 'map.json': { room: 'W5N5' } });
		assert.deepStrictEqual(worldIn(dir).loadMaps().map(function (m) { return m.room; }), ['W5N5']);
	});

	it('loadMaps ignores non-map json in the dir', function () {
		const dir = scenario({
			'map.W1N1.json': { room: 'W1N1' },
			'raw.W1N1.json': { junk: true },
			'memory.json': {},
			'segments.json': {},
			'settings.json': {}
		});
		assert.deepStrictEqual(worldIn(dir).loadMaps().map(function (m) { return m.room; }), ['W1N1']);
	});

	// An editor/download duplicate like `map.E27S23 (1).json` loads the same
	// room twice, which builds a broken world in ways that surface much later.
	it('loadMaps rejects two maps for the same room', function () {
		const dir = scenario({
			'map.E27S23.json': { room: 'E27S23' },
			'map.E27S23 (1).json': { room: 'E27S23' }
		});
		assert.throws(function () { worldIn(dir).loadMaps(); },
			/E27S23[\s\S]*map\.E27S23 \(1\)\.json/);
	});

	it('loadMaps reports an empty scenario dir rather than loading nothing', function () {
		const dir = scenario({});
		assert.throws(function () { worldIn(dir).loadMaps(); }, /no map\.\*\.json/);
	});

	it('a bad map file names itself in the error', function () {
		const dir = scenario({});
		fs.writeFileSync(path.join(dir, 'map.W1N1.json'), '{ not json');
		assert.throws(function () { worldIn(dir).loadMaps(); }, /map\.W1N1\.json/);
	});

	it('explains itself when the world has no scenario dir', function () {
		assert.throws(function () { new DojoWorld().loadMap('W1N1'); }, /scenarioDir/);
		assert.throws(function () { new DojoWorld().loadMaps(); }, /scenarioDir/);
	});
});

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { expandRoomSpecs } = require('../../src/import/roomSpecs');
const { parseArgs, mapFileName } = require('../../scripts/importRoom');

describe('room import specifications', function () {
	it('keeps individual room lists working', function () {
		assert.deepStrictEqual(expandRoomSpecs(['W7N4', 'W6N2']), ['W7N4', 'W6N2']);
	});

	it('expands an inclusive rectangular block', function () {
		assert.deepStrictEqual(expandRoomSpecs(['W7N4:W6N2']), [
			'W7N4', 'W6N4',
			'W7N3', 'W6N3',
			'W7N2', 'W6N2'
		]);
	});

	it('works in either endpoint order and across world axes', function () {
		assert.deepStrictEqual(expandRoomSpecs(['E0S0:W0N0']), ['W0N0', 'E0N0', 'W0S0', 'E0S0']);
		assert.deepStrictEqual(expandRoomSpecs(['W6N2:W7N4']), [
			'W7N4', 'W6N4', 'W7N3', 'W6N3', 'W7N2', 'W6N2'
		]);
	});

	it('deduplicates overlapping entries', function () {
		assert.deepStrictEqual(expandRoomSpecs(['W7N4:W6N4', 'W7N4']), ['W7N4', 'W6N4']);
	});

	it('rejects malformed and excessive selections', function () {
		assert.throws(function () { expandRoomSpecs(['W7N4:nope']); }, /bad room or range/);
		assert.throws(function () { expandRoomSpecs(['W9N9:W0N0'], 10); }, /exceeds 10 rooms/);
	});

	it('keeps memory and segments opt-in in CLI parsing', function () {
		const defaults = parseArgs(['node', 'importRoom.js', 'demo', 'W7N4:W6N2']);
		assert.strictEqual(defaults.includeMemory, false);
		assert.strictEqual(defaults.includeSegments, false);
		assert.strictEqual(defaults.includeMyCreeps, true);
		assert.strictEqual(defaults.includeMyStructures, true);
		assert.strictEqual(defaults.overwrite, false);

		const selected = parseArgs([
			'node', 'importRoom.js', 'demo', 'W1N1',
			'--segments', '--memory', '--no-creeps', '--no-structures', '--overwrite'
		]);
		assert.strictEqual(selected.includeMemory, true);
		assert.strictEqual(selected.includeSegments, true);
		assert.strictEqual(selected.includeMyCreeps, false);
		assert.strictEqual(selected.includeMyStructures, false);
		assert.strictEqual(selected.overwrite, true);
		assert.deepStrictEqual(selected.rooms, ['W1N1']);
	});

	it('only replaces the canonical map file when overwrite is selected', function () {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-import-name-'));
		try {
			fs.writeFileSync(path.join(dir, 'map.W1N1.json'), '{}');
			fs.writeFileSync(path.join(dir, 'map.W1N1 (1).json'), '{}');
			assert.strictEqual(mapFileName(dir, 'W1N1', false), 'map.W1N1 (2).json');
			assert.strictEqual(mapFileName(dir, 'W1N1', true), 'map.W1N1.json');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

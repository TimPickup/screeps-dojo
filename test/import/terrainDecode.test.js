'use strict';

const assert = require('assert');
const { decodeTerrain } = require('../../src/import/terrainDecode');

describe('decodeTerrain', function () {
	it('decodes a 2500-char encoded string to 50 rows of 50 chars', function () {
		const encoded = '0'.repeat(2500);
		const rows = decodeTerrain(encoded);
		assert.strictEqual(rows.length, 50);
		assert.ok(rows.every(function (r) { return r.length === 50; }));
		assert.strictEqual(rows[0], '.'.repeat(50));
	});

	it('maps 0->plain . , 1->wall # , 2->swamp ~ in row-major order', function () {
		// (x=1,y=0) wall, (x=0,y=1) swamp, rest plain
		const chars = '0'.repeat(2500).split('');
		chars[0 * 50 + 1] = '1';
		chars[1 * 50 + 0] = '2';
		const rows = decodeTerrain(chars.join(''));
		assert.strictEqual(rows[0][1], '#');
		assert.strictEqual(rows[1][0], '~');
		assert.strictEqual(rows[0][0], '.');
	});

	it('throws on wrong length', function () {
		assert.throws(function () { decodeTerrain('012'); }, /2500/);
	});
});

'use strict';

const assert = require('assert');
const {
	parseTerrain, serializeFlags, parseFlags,
	roomNameToXY, validateEdges, autoMirror
} = require('../../src/mapFormat');

// Build a 50x50 terrain row array: fill char everywhere, then apply edits
// [{x, y, char}].
function makeTerrain(fill, edits) {
	const rows = [];
	for (let y = 0; y < 50; y++) rows.push(fill.repeat(50));
	for (const edit of edits || []) {
		rows[edit.y] = rows[edit.y].slice(0, edit.x) + edit.char + rows[edit.y].slice(edit.x + 1);
	}
	return rows;
}

describe('mapFormat', function () {
	describe('parseTerrain', function () {
		it('returns only non-plain tiles with type names', function () {
			const rows = makeTerrain('.', [{ x: 3, y: 7, char: '#' }, { x: 10, y: 20, char: '~' }]);
			const tiles = parseTerrain(rows);
			assert.deepStrictEqual(tiles, [
				{ x: 3, y: 7, type: 'wall' },
				{ x: 10, y: 20, type: 'swamp' }
			]);
		});

		it('rejects wrong row count', function () {
			assert.throws(function () { parseTerrain(['.'.repeat(50)]); }, /50 rows/);
		});

		it('rejects wrong row length', function () {
			const rows = makeTerrain('.');
			rows[5] = '.'.repeat(49);
			assert.throws(function () { parseTerrain(rows); }, /row 5/);
		});

		it('rejects unknown characters', function () {
			const rows = makeTerrain('.', [{ x: 2, y: 2, char: 'X' }]);
			assert.throws(function () { parseTerrain(rows); }, /unknown char 'X'/);
		});
	});

	describe('flag serialization', function () {
		it('round-trips name, colors, and position', function () {
			const flags = [
				{ name: 'goal', color: 1, secondaryColor: 1, x: 45, y: 25 },
				{ name: 'rally', color: 3, secondaryColor: 5, x: 2, y: 48 }
			];
			assert.strictEqual(serializeFlags(flags), 'goal~1~1~45~25|rally~3~5~2~48');
			assert.deepStrictEqual(parseFlags(serializeFlags(flags)), flags);
		});

		it('defaults colors to white (1)', function () {
			assert.strictEqual(serializeFlags([{ name: 'a', x: 1, y: 2 }]), 'a~1~1~1~2');
		});

		it('escapes separator characters in names', function () {
			const flags = [{ name: 'a|b~c', color: 1, secondaryColor: 1, x: 0, y: 0 }];
			const data = serializeFlags(flags);
			assert.ok(data.indexOf('$VLINE$') !== -1 && data.indexOf('$TILDE$') !== -1);
			assert.deepStrictEqual(parseFlags(data), flags);
		});

		it('parses empty data to no flags', function () {
			assert.deepStrictEqual(parseFlags(''), []);
		});

		it('rejects flag names containing reserved sequence $VLINE$', function () {
			assert.throws(
				function () { serializeFlags([{ name: 'a$VLINE$b', color: 1, secondaryColor: 1, x: 0, y: 0 }]); },
				/reserved sequence/
			);
		});

		it('rejects flag names containing reserved sequence $TILDE$', function () {
			assert.throws(
				function () { serializeFlags([{ name: 'x$TILDE$y', color: 1, secondaryColor: 1, x: 0, y: 0 }]); },
				/reserved sequence/
			);
		});

		it('uses nullish defaulting so color 0 is preserved', function () {
			// color=0 and secondaryColor=0 must NOT be replaced by the default of 1
			assert.strictEqual(serializeFlags([{ name: 'z', color: 0, secondaryColor: 0, x: 5, y: 6 }]), 'z~0~0~5~6');
		});

		it('parseFlags throws on malformed flag entry (wrong field count)', function () {
			// 'foo~1~2~3' has only 4 fields — must throw
			assert.throws(
				function () { parseFlags('foo~1~2~3'); },
				/malformed flag entry/
			);
		});
	});

	describe('roomNameToXY', function () {
		it('maps the four quadrants', function () {
			assert.deepStrictEqual(roomNameToXY('E0S0'), { x: 0, y: 0 });
			assert.deepStrictEqual(roomNameToXY('W0N0'), { x: -1, y: -1 });
			assert.deepStrictEqual(roomNameToXY('E5N2'), { x: 5, y: -3 });
			assert.deepStrictEqual(roomNameToXY('W3S7'), { x: -4, y: 7 });
		});

		it('rejects invalid names', function () {
			assert.throws(function () { roomNameToXY('sim'); }, /invalid room name/);
		});

		it('handles multi-digit coordinates', function () {
			assert.deepStrictEqual(roomNameToXY('W10S20'), { x: -11, y: 20 });
			assert.deepStrictEqual(roomNameToXY('E12N3'), { x: 12, y: -4 });
		});
	});

	describe('validateEdges', function () {
		it('accepts matching east-west edges', function () {
			const west = { room: 'W1N0', terrain: makeTerrain('.', [{ x: 49, y: 25, char: '#' }]) };
			const east = { room: 'W0N0', terrain: makeTerrain('.', [{ x: 0, y: 25, char: '#' }]) };
			assert.deepStrictEqual(validateEdges([west, east]), []);
		});

		it('reports a mismatched edge tile', function () {
			const west = { room: 'W1N0', terrain: makeTerrain('.', [{ x: 49, y: 25, char: '#' }]) };
			const east = { room: 'W0N0', terrain: makeTerrain('.') };
			const mismatches = validateEdges([west, east]);
			assert.strictEqual(mismatches.length, 1);
			assert.deepStrictEqual(mismatches[0], { rooms: ['W1N0', 'W0N0'], edge: 'east', index: 25 });
		});

		it('checks north-south pairs too', function () {
			const north = { room: 'W0N1', terrain: makeTerrain('.', [{ x: 30, y: 49, char: '#' }]) };
			const south = { room: 'W0N0', terrain: makeTerrain('.') };
			const mismatches = validateEdges([north, south]);
			assert.strictEqual(mismatches.length, 1);
			assert.deepStrictEqual(mismatches[0], { rooms: ['W0N1', 'W0N0'], edge: 'south', index: 30 });
		});

		it('rejects duplicate room names', function () {
			const a = { room: 'W0N0', terrain: makeTerrain('.') };
			const b = { room: 'W0N0', terrain: makeTerrain('.') };
			assert.throws(
				function () { validateEdges([a, b]); },
				/duplicate room/
			);
		});
	});

	describe('autoMirror', function () {
		it('copies wall status onto the neighbour edge', function () {
			const west = { room: 'W1N0', terrain: makeTerrain('.', [{ x: 49, y: 25, char: '#' }]) };
			const east = { room: 'W0N0', terrain: makeTerrain('.', [{ x: 0, y: 30, char: '#' }]) };
			autoMirror([west, east]);
			assert.strictEqual(east.terrain[25][0], '#');  // wall copied across
			assert.strictEqual(east.terrain[30][0], '.');  // walkable copied across
			assert.deepStrictEqual(validateEdges([west, east]), []);
		});

		it('normalises swamp border to plain on the neighbour side', function () {
			// west room: col 49, row 25 is swamp ('~'); east room: col 0, row 25 is wall
			const west = { room: 'W1N0', terrain: makeTerrain('.', [{ x: 49, y: 25, char: '~' }]) };
			const east = { room: 'W0N0', terrain: makeTerrain('.', [{ x: 0, y: 25, char: '#' }]) };
			autoMirror([west, east]);
			// swamp is walkable, so neighbour border must become '.' (plain, not '#')
			assert.strictEqual(east.terrain[25][0], '.');
			assert.deepStrictEqual(validateEdges([west, east]), []);
		});

		it('copies wall status for north-south pairs', function () {
			// north room: row 49, col 30 is wall; south room: row 0, col 30 is plain
			const north = { room: 'W0N1', terrain: makeTerrain('.', [{ x: 30, y: 49, char: '#' }]) };
			const south = { room: 'W0N0', terrain: makeTerrain('.') };
			autoMirror([north, south]);
			assert.strictEqual(south.terrain[0][30], '#');  // wall copied from north's south border
			assert.deepStrictEqual(validateEdges([north, south]), []);
		});
	});
});

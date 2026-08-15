'use strict';

// Encoded room terrain (2500 chars, row-major index = y*50 + x) uses bitmasks:
// 0 plain, 1 wall, 2 swamp, 3 wall+swamp. A wall always wins because the tile
// is impassable regardless of the swamp bit.

const CHAR_BY_DIGIT = { '0': '.', '1': '#', '2': '~', '3': '#' };

function decodeTerrain(encoded) {
	if (typeof encoded !== 'string' || encoded.length !== 2500) {
		throw new Error('encoded terrain must be a 2500-char string, got ' + (encoded && encoded.length));
	}
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) {
			const digit = encoded[y * 50 + x];
			const char = CHAR_BY_DIGIT[digit];
			if (char === undefined) throw new Error('unknown terrain mask ' + JSON.stringify(digit) + ' at ' + x + ',' + y);
			row += char;
		}
		rows.push(row);
	}
	return rows;
}

module.exports = { decodeTerrain: decodeTerrain };

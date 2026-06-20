'use strict';

// Encoded room terrain (2500 chars, row-major index = y*50 + x; 0 plain,
// 1 wall, 2 swamp) -> 50 strings of 50 chars in the map.json alphabet.

const CHAR_BY_DIGIT = { '0': '.', '1': '#', '2': '~' };

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
			row += char === undefined ? '.' : char;
		}
		rows.push(row);
	}
	return rows;
}

module.exports = { decodeTerrain: decodeTerrain };

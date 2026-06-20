'use strict';

// Generates the hand-made maps once; outputs are committed. Border walls all
// around (no exits needed for single-room scenarios).
const fs = require('fs');
const path = require('path');

function makeTerrain(isWall) {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) {
			const border = x === 0 || x === 49 || y === 0 || y === 49;
			row += border || isWall(x, y) ? '#' : '.';
		}
		rows.push(row);
	}
	return rows;
}

function writeMap(relativePath, map) {
	const target = path.join(__dirname, '..', relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, JSON.stringify(map, null, '\t') + '\n');
	console.log('wrote ' + relativePath);
}

// Scout-flee arena: vertical wall at x=25 from the top down to y=39, leaving a
// gap at the bottom (y 40..48). Scout starts west, goal flag east, chaser east.
writeMap('scenarios/scout-flee/map.json', {
	room: 'W0N0',
	terrain: makeTerrain(function (x, y) { return x === 25 && y <= 39; }),
	structures: [],
	flags: [{ name: 'goal', x: 45, y: 25 }]
});

// Walk-to-flag arena: empty room, goal flag east.
writeMap('scenarios/walk-to-flag/map.json', {
	room: 'W0N0',
	terrain: makeTerrain(function () { return false; }),
	structures: [],
	flags: [{ name: 'goal', x: 40, y: 25 }]
});

// Cross-room scenario: two adjacent rooms.
// W1N0 (west room): full border walls EXCEPT east border open at y=23..27.
// W0N0 (east room): full border walls EXCEPT west border open at y=23..27.
// validateEdges requires east col-49 of W1N0 and west col-0 of W0N0 to match.
// Flag goal placed in W0N0 at (40,25).
// isOpenBorder(x, y) returns true for tiles that are on the border but should
// be walkable (exit openings). This overrides the default "all border = wall".
function makeTerrainWithExits(isOpenBorder) {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) {
			const border = x === 0 || x === 49 || y === 0 || y === 49;
			const open = border && isOpenBorder(x, y);
			row += (border && !open) ? '#' : '.';
		}
		rows.push(row);
	}
	return rows;
}

const OPENING_Y1 = 23;
const OPENING_Y2 = 27;

writeMap('scenarios/cross-room/mapWest.json', {
	room: 'W1N0',
	terrain: makeTerrainWithExits(function (x, y) {
		// East border open at y=23..27
		return x === 49 && y >= OPENING_Y1 && y <= OPENING_Y2;
	}),
	structures: [],
	flags: []
});

writeMap('scenarios/cross-room/mapEast.json', {
	room: 'W0N0',
	terrain: makeTerrainWithExits(function (x, y) {
		// West border open at y=23..27 (mirrors W1N0 east opening)
		return x === 0 && y >= OPENING_Y1 && y <= OPENING_Y2;
	}),
	structures: [],
	flags: [{ name: 'goal', x: 40, y: 25 }]
});

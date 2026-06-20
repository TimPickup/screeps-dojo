'use strict';

// Pure map-format logic (spec §5): terrain strings, flag wire format
// (engine: name~color~secondaryColor~x~y joined by '|'), room-name math,
// multi-room edge validation. No server dependencies.

const ROOM_SIZE = 50;
const TERRAIN_CHARS = { '.': 'plain', '~': 'swamp', '#': 'wall' };
const ROOM_NAME_PATTERN = /^([WE])(\d+)([NS])(\d+)$/;

function parseTerrain(rows) {
	if (!Array.isArray(rows) || rows.length !== ROOM_SIZE) {
		throw new Error('terrain must be ' + ROOM_SIZE + ' rows');
	}
	const tiles = [];
	for (let y = 0; y < ROOM_SIZE; y++) {
		const row = rows[y];
		if (typeof row !== 'string' || row.length !== ROOM_SIZE) {
			throw new Error('terrain row ' + y + ' must be a ' + ROOM_SIZE + '-char string');
		}
		for (let x = 0; x < ROOM_SIZE; x++) {
			const type = TERRAIN_CHARS[row[x]];
			if (type === undefined) {
				throw new Error('terrain row ' + y + " col " + x + ": unknown char '" + row[x] + "'");
			}
			if (type !== 'plain') tiles.push({ x: x, y: y, type: type });
		}
	}
	return tiles;
}

function escapeFlagName(name) {
	return name.replace(/\|/g, '$VLINE$').replace(/~/g, '$TILDE$');
}

function unescapeFlagName(name) {
	return name.replace(/\$VLINE\$/g, '|').replace(/\$TILDE\$/g, '~');
}

function serializeFlags(flags) {
	return flags.map(function (flag) {
		if (flag.name.indexOf('$VLINE$') !== -1 || flag.name.indexOf('$TILDE$') !== -1) {
			throw new Error('flag name contains reserved sequence: ' + flag.name);
		}
		const color = flag.color != null ? flag.color : 1;
		const secondaryColor = flag.secondaryColor != null ? flag.secondaryColor : color;
		return [escapeFlagName(flag.name), color, secondaryColor, flag.x, flag.y].join('~');
	}).join('|');
}

function parseFlags(data) {
	if (!data) return [];
	return data.split('|').filter(Boolean).map(function (entry) {
		const fields = entry.split('~');
		if (fields.length !== 5) throw new Error('malformed flag entry: ' + entry);
		return {
			name: unescapeFlagName(fields[0]),
			color: Number(fields[1]),
			secondaryColor: Number(fields[2]),
			x: Number(fields[3]),
			y: Number(fields[4])
		};
	});
}

function roomNameToXY(name) {
	const match = ROOM_NAME_PATTERN.exec(name);
	if (!match) throw new Error('invalid room name: ' + name);
	const x = match[1] === 'W' ? -Number(match[2]) - 1 : Number(match[2]);
	const y = match[3] === 'N' ? -Number(match[4]) - 1 : Number(match[4]);
	return { x: x, y: y };
}

function mapsByCoordinate(maps) {
	const byCoord = new Map();
	for (const map of maps) {
		const pos = roomNameToXY(map.room);
		const key = pos.x + ',' + pos.y;
		if (byCoord.has(key)) throw new Error('duplicate room: ' + map.room);
		byCoord.set(key, map);
	}
	return byCoord;
}

// For every adjacent pair, border tiles (excluding corners) must agree on
// walkability: east col 49 vs neighbour col 0, south row 49 vs neighbour row 0.
function validateEdges(maps) {
	const byCoord = mapsByCoordinate(maps);
	const mismatches = [];
	for (const map of maps) {
		const pos = roomNameToXY(map.room);
		const east = byCoord.get((pos.x + 1) + ',' + pos.y);
		if (east) {
			for (let y = 1; y < ROOM_SIZE - 1; y++) {
				if ((map.terrain[y][49] === '#') !== (east.terrain[y][0] === '#')) {
					mismatches.push({ rooms: [map.room, east.room], edge: 'east', index: y });
				}
			}
		}
		const south = byCoord.get(pos.x + ',' + (pos.y + 1));
		if (south) {
			for (let x = 1; x < ROOM_SIZE - 1; x++) {
				if ((map.terrain[49][x] === '#') !== (south.terrain[0][x] === '#')) {
					mismatches.push({ rooms: [map.room, south.room], edge: 'south', index: x });
				}
			}
		}
	}
	return mismatches;
}

function setTerrainChar(rows, x, y, char) {
	rows[y] = rows[y].slice(0, x) + char + rows[y].slice(x + 1);
}

// Copies wall/walkable status from each room's east and south borders onto the
// neighbour's matching border. Mutates the terrain arrays in place.
// Note: mirrored walkable tiles are written as plain ('.') — swamp on a border
// is normalized to plain on the neighbour side.
function autoMirror(maps) {
	const byCoord = mapsByCoordinate(maps);
	for (const map of maps) {
		const pos = roomNameToXY(map.room);
		const east = byCoord.get((pos.x + 1) + ',' + pos.y);
		if (east) {
			for (let y = 1; y < ROOM_SIZE - 1; y++) {
				const wall = map.terrain[y][49] === '#';
				if (wall !== (east.terrain[y][0] === '#')) {
					setTerrainChar(east.terrain, 0, y, wall ? '#' : '.');
				}
			}
		}
		const south = byCoord.get(pos.x + ',' + (pos.y + 1));
		if (south) {
			for (let x = 1; x < ROOM_SIZE - 1; x++) {
				const wall = map.terrain[49][x] === '#';
				if (wall !== (south.terrain[0][x] === '#')) {
					setTerrainChar(south.terrain, x, 0, wall ? '#' : '.');
				}
			}
		}
	}
}

module.exports = {
	ROOM_SIZE: ROOM_SIZE,
	parseTerrain: parseTerrain,
	serializeFlags: serializeFlags,
	parseFlags: parseFlags,
	roomNameToXY: roomNameToXY,
	validateEdges: validateEdges,
	autoMirror: autoMirror
};

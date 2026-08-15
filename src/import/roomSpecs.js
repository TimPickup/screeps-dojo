'use strict';

const { roomNameToXY } = require('../mapFormat');

const ROOM_NAME = /^[WE]\d+[NS]\d+$/;
const DEFAULT_MAX_ROOMS = 100;

function xyToRoomName(x, y) {
	return (x < 0 ? 'W' + (-x - 1) : 'E' + x)
		+ (y < 0 ? 'N' + (-y - 1) : 'S' + y);
}

// Expand ROOM or ROOM:ROOM specifications into an inclusive rectangle.
// Duplicates are removed while preserving first-seen order.
function expandRoomSpecs(specs, maxRooms) {
	if (!Array.isArray(specs) || specs.length === 0) throw new Error('rooms[] required');
	const limit = maxRooms || DEFAULT_MAX_ROOMS;
	const out = [];
	const seen = new Set();

	function add(room) {
		if (!seen.has(room)) { seen.add(room); out.push(room); }
		if (out.length > limit) throw new Error('room selection exceeds ' + limit + ' rooms');
	}

	for (const spec of specs) {
		const parts = String(spec).split(':');
		if ((parts.length !== 1 && parts.length !== 2) || parts.some(function (room) { return !ROOM_NAME.test(room); })) {
			throw new Error('bad room or range: ' + spec);
		}
		if (parts.length === 1) { add(parts[0]); continue; }

		const a = roomNameToXY(parts[0]);
		const b = roomNameToXY(parts[1]);
		for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
			for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) add(xyToRoomName(x, y));
		}
	}
	return out;
}

module.exports = { expandRoomSpecs: expandRoomSpecs, xyToRoomName: xyToRoomName };

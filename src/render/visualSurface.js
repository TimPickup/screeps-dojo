'use strict';

// Minimal RoomVisual-compatible collection surface used by lib/RoomVisual.js.
// It records plain drawing commands and is independent of any output renderer.
function normalizePoints(points) {
	return points.map(function (point) {
		return Array.isArray(point) ? [point[0], point[1]] : [point.x, point.y];
	});
}

class FakeRoomVisual {
	constructor(roomName) {
		this.roomName = roomName;
		this.elements = [];
	}

	line(x1, y1, x2, y2, style) {
		this.elements.push({ kind: 'line', x1: x1, y1: y1, x2: x2, y2: y2, style: style || {} });
		return this;
	}

	circle(x, y, style) {
		this.elements.push({ kind: 'circle', x: x, y: y, style: style || {} });
		return this;
	}

	rect(x, y, width, height, style) {
		this.elements.push({ kind: 'rect', x: x, y: y, width: width, height: height, style: style || {} });
		return this;
	}

	poly(points, style) {
		this.elements.push({ kind: 'poly', points: normalizePoints(points), style: style || {} });
		return this;
	}

	text(text, x, y, style) {
		this.elements.push({ kind: 'text', text: String(text), x: x, y: y, style: style || {} });
		return this;
	}

	clear() {
		this.elements = [];
		this.roads = undefined;
		return this;
	}
}

module.exports = { FakeRoomVisual: FakeRoomVisual };

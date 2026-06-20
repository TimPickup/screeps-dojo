'use strict';

// Implements the RoomVisual drawing surface (spec §8): the five primitives
// plus clear(), collecting plain element objects. SVG conversion lives in
// frameRenderer; this class stays renderer-agnostic so the same drawing code
// can back the browser editor later.
const { installVisualGlobals } = require('./visualGlobals');
const { FakeRoomVisual } = require('./svgPrimitives');

let libraryInstalled = false;

// Loads lib/RoomVisual.js on top of FakeRoomVisual exactly once per process.
function installRoomVisualLibrary() {
	installVisualGlobals(FakeRoomVisual);
	if (!libraryInstalled) {
		libraryInstalled = true;
		require('../../lib/RoomVisual');
	}
}

module.exports = { FakeRoomVisual: FakeRoomVisual, installRoomVisualLibrary: installRoomVisualLibrary };

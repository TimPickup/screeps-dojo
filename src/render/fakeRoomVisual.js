'use strict';

// Installs lib/RoomVisual.js on a renderer-independent command surface.
const { installVisualGlobals } = require('./visualGlobals');
const { FakeRoomVisual } = require('./visualSurface');

let libraryInstalled = false;

function installRoomVisualLibrary() {
	installVisualGlobals(FakeRoomVisual);
	if (!libraryInstalled) {
		libraryInstalled = true;
		require('../../lib/RoomVisual');
	}
}

module.exports = { FakeRoomVisual: FakeRoomVisual, installRoomVisualLibrary: installRoomVisualLibrary };

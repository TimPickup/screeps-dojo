'use strict';

// Stand-in for a second bot codebase, mounted as the "beta" bot profile.
module.exports.loop = function () {
	RawMemory.set('');
	console.log('bot:beta');
};

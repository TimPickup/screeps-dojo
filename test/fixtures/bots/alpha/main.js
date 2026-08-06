'use strict';

// Stand-in for a real bot codebase, mounted as the "alpha" bot profile. Prints
// its own name every tick so a test can tell WHICH codebase actually ran.
module.exports.loop = function () {
	RawMemory.set('');
	console.log('bot:alpha');
};

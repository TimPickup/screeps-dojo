'use strict';

module.exports.loop = function () {
	// This example bot keeps no Memory; drop the next line if your bot uses it.
	RawMemory.set('');
	const creep = Game.creeps.T;
	if (!creep) return;
	const flag = Game.flags.goal;
	if (!flag) return;
	creep.moveTo(flag);
};

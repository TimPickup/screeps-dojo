'use strict';

// Self-contained bot for the tiny test fixture: one creep 'T' walks to flag 'goal'.
module.exports.loop = function () {
	RawMemory.set('');
	const creep = Game.creeps.T;
	if (!creep) return;
	const flag = Game.flags.goal;
	if (!flag) return;
	creep.moveTo(flag);
};

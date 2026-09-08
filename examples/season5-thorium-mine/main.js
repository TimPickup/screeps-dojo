'use strict';

// Mining Season 5 Thorium.
//
// Thorium is an ordinary mineral as far as the engine is concerned, so it is
// mined the ordinary way: an EXTRACTOR on the deposit, a creep with WORK parts
// standing next to it, and `harvest`. What makes it Thorium is `mineralType`
// and the fact that Season 5 never regenerates it — what you mine is all there
// will ever be.
module.exports.loop = function () {
	const miner = Game.creeps.miner;
	if (!miner) return;

	const mineral = miner.room.find(FIND_MINERALS)[0];
	const container = miner.room.find(FIND_STRUCTURES, {
		filter: function (s) { return s.structureType === STRUCTURE_CONTAINER; }
	})[0];
	if (!mineral) return;

	const carried = miner.store[RESOURCE_THORIUM] || 0;
	// Drop a load off once there is a worthwhile amount, rather than filling up
	// and stalling on the extractor's cooldown with nowhere to put the next one.
	if (container && (carried >= 20 || miner.store.getFreeCapacity() === 0)) {
		if (miner.transfer(container, RESOURCE_THORIUM) === ERR_NOT_IN_RANGE) miner.moveTo(container);
	} else if (miner.harvest(mineral) === ERR_NOT_IN_RANGE) {
		miner.moveTo(mineral);
	}

	if (Game.time % 5 === 0) {
		console.log('mineral ' + mineral.mineralType + ' left=' + mineral.mineralAmount
			+ ' regen=' + mineral.ticksToRegeneration
			+ ' | miner carries ' + carried
			+ ' | container ' + (container ? (container.store[RESOURCE_THORIUM] || 0) : 'none'));
	}
};

'use strict';

// The whole Season 5 Thorium chain, in one loop:
//
//   miner    extractor -> its own store -> the container beside the deposit
//   hauler   container -> across the room -> the reactor
//   claimer  takes the reactor, which is what makes it burn and pay score
//
// Score lands on the reactor's OWNER, not on the room, which is why the claimer
// matters at all: an unclaimed reactor full of Thorium scores nothing.
module.exports.loop = function () {
	const room = Game.rooms.W0N0;
	if (!room) return;

	const reactor = room.find(FIND_REACTORS)[0];
	const mineral = room.find(FIND_MINERALS)[0];
	const container = room.find(FIND_STRUCTURES, {
		filter: function (s) { return s.structureType === STRUCTURE_CONTAINER; }
	})[0];
	if (!reactor) return;

	const claimer = Game.creeps.claimer;
	if (claimer && !reactor.my) {
		if (claimer.claimReactor(reactor) === ERR_NOT_IN_RANGE) claimer.moveTo(reactor);
	}

	const miner = Game.creeps.miner;
	if (miner && mineral) {
		const carried = miner.store[RESOURCE_THORIUM] || 0;
		if (container && (carried >= 20 || miner.store.getFreeCapacity() === 0)) {
			if (miner.transfer(container, RESOURCE_THORIUM) === ERR_NOT_IN_RANGE) miner.moveTo(container);
		} else if (miner.harvest(mineral) === ERR_NOT_IN_RANGE) {
			miner.moveTo(mineral);
		}
	}

	const hauler = Game.creeps.hauler;
	if (hauler) {
		const carrying = hauler.store[RESOURCE_THORIUM] || 0;
		// Deliver once it is worth the walk, or as soon as it is full.
		const delivering = hauler.memory.delivering && carrying > 0;
		if (!delivering && hauler.store.getFreeCapacity() > 0) {
			if (container && (container.store[RESOURCE_THORIUM] || 0) > 0) {
				if (hauler.withdraw(container, RESOURCE_THORIUM) === ERR_NOT_IN_RANGE) hauler.moveTo(container);
			} else if (carrying > 0) {
				hauler.memory.delivering = true;
			}
		} else {
			hauler.memory.delivering = true;
			// Thorium goes INTO a reactor freely; taking it back out is the thing
			// Season 5 forbids (it cancels a withdraw aimed at a reactor).
			const result = hauler.transfer(reactor, RESOURCE_THORIUM);
			if (result === ERR_NOT_IN_RANGE) hauler.moveTo(reactor);
			else if (result === OK) hauler.memory.delivering = false;
		}
	}

	if (Game.time % 10 === 0) {
		console.log('deposit=' + (mineral ? mineral.mineralAmount : '-')
			+ ' container=' + (container ? (container.store[RESOURCE_THORIUM] || 0) : '-')
			+ ' hauler=' + (hauler ? (hauler.store[RESOURCE_THORIUM] || 0) : '-')
			+ ' reactor=' + (reactor.store[RESOURCE_THORIUM] || 0)
			+ ' mine=' + reactor.my + ' work=' + reactor.continuousWork);
	}
};

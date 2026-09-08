'use strict';

// A minimal Season 5 bot: claim the room's reactor, then keep it fed with
// Thorium from the container next to it.
//
// RESOURCE_THORIUM, FIND_REACTORS and Creep.claimReactor() exist only because
// the scenario's settings.json selects the season5 mod — run this without it
// and the loop below throws on the first line that names one.
module.exports.loop = function () {
	const room = Game.rooms.W0N0;
	if (!room) return;

	const reactor = room.find(FIND_REACTORS)[0];
	if (!reactor) return;

	// A CLAIM part next to the reactor is all it takes. Ownership is what makes
	// the reactor burn Thorium and pay score; an unowned one just sits there.
	const claimer = Game.creeps.claimer;
	if (claimer && !reactor.my) {
		if (claimer.claimReactor(reactor) === ERR_NOT_IN_RANGE) claimer.moveTo(reactor);
	}

	const hauler = Game.creeps.hauler;
	if (hauler) {
		const container = room.find(FIND_STRUCTURES, {
			filter: function (s) { return s.structureType === STRUCTURE_CONTAINER; }
		})[0];
		if ((hauler.store[RESOURCE_THORIUM] || 0) === 0) {
			// Thorium can be taken OUT of a container, but never out of a reactor:
			// Season 5 cancels that withdraw intent.
			if (container && hauler.withdraw(container, RESOURCE_THORIUM) === ERR_NOT_IN_RANGE) {
				hauler.moveTo(container);
			}
		} else if (hauler.transfer(reactor, RESOURCE_THORIUM) === ERR_NOT_IN_RANGE) {
			hauler.moveTo(reactor);
		}
	}

	if (Game.time % 10 === 0) {
		console.log('reactor mine=' + reactor.my
			+ ' T=' + ((reactor.store && reactor.store[RESOURCE_THORIUM]) || 0)
			+ ' continuousWork=' + reactor.continuousWork);
	}
};

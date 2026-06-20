'use strict';

module.exports.loop = function () {
    const spawn = Object.values(Game.spawns)[0];
    if (!spawn) return;

    const creeps = Object.values(Game.creeps);
    const upgraders = creeps.filter(c => c.memory.role !== 'attacker');
    const attackers = creeps.filter(c => c.memory.role === 'attacker');

    // Spawn three upgraders, then one attacker
    if (!spawn.spawning) {
        if (upgraders.length < 2) {
            spawn.spawnCreep(
                [WORK, CARRY, MOVE],
                `upgrader${Game.time}`,
                { memory: { role: 'upgrader' } }
            );
        } else if (attackers.length < 1) {
            spawn.spawnCreep(
                [RANGED_ATTACK, MOVE],
                `attacker${Game.time}`,
                { memory: { role: 'attacker' } }
            );
        }
    }

    for (const creep of creeps) {
        if (creep.memory.role !== 'attacker') {
            // Harvest until full
            if (
                creep.memory.task !== 'upgrade' &&
                creep.store.getFreeCapacity() > 0
            ) {
                creep.memory.task = 'harvest';

                const source = creep.pos.findClosestByPath(FIND_SOURCES);
                if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(source);
                }
            } else {
                // Upgrade until empty
                creep.memory.task = 'upgrade';

                const controller = creep.room.controller;
                if (
                    controller &&
                    creep.upgradeController(controller) === ERR_NOT_IN_RANGE
                ) {
                    creep.moveTo(controller);
                }

                if (creep.store.getUsedCapacity() === 0) {
                    creep.memory.task = 'harvest';
                }
            }
        }

        if (creep.memory.role === 'attacker') {
            // Travel to the target room
            if (creep.room.name !== 'W0N1') {
                creep.moveTo(new RoomPosition(25, 25, 'W0N1'));
                continue;
            }

            const hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
            if (!hostile) continue;

            // Move within ranged-attack distance
            if (creep.pos.getRangeTo(hostile) > 3) {
                creep.moveTo(hostile, { range: 3 });
                continue;
            }

            // Alternate attack type each tick
            if (Game.time % 2 === 0) {
                creep.rangedMassAttack();
            } else {
                creep.rangedAttack(hostile);
            }
        }
    }
};
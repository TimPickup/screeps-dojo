'use strict';

const assert = require('assert');
const { playerSummary } = require('../../scripts/importRoom');

// The line an import prints for every room that has other players in it. It is
// how you learn which labels exist, so you can assign one a bot codebase in the
// scenario's settings.json — nothing else in the flow surfaces them.
describe('playerSummary', function () {
	it('says nothing when no other player owns anything', function () {
		assert.strictEqual(playerSummary({}, { structures: [], creeps: [] }), '');
	});

	it('says nothing for a player whose counts are all zero', function () {
		// resolveOwners seeds a counts entry for every player seen anywhere in the
		// import, including ones who own nothing in THIS room.
		const counts = { tigga: { structures: 0, creeps: 0 } };
		assert.strictEqual(playerSummary(counts, { structures: [], creeps: [] }), '');
	});

	it('lists each player with their structure and creep counts', function () {
		const counts = {
			almaravarion: { structures: 34, creeps: 12 },
			tigga: { structures: 0, creeps: 3 }
		};
		const map = { structures: [], creeps: [] };
		assert.strictEqual(
			playerSummary(counts, map),
			'\n  players: almaravarion (34 structures, 12 creeps), tigga (0 structures, 3 creeps)'
		);
	});

	it('flags the player whose spawn the import caught', function () {
		// A spawn in the room is the difference between a base you can bind a
		// working bot to and a handful of creeps that will die of old age.
		const counts = { almaravarion: { structures: 2, creeps: 0 } };
		const map = {
			structures: [
				{ type: 'spawn', x: 1, y: 1, owner: 'almaravarion' },
				{ type: 'tower', x: 2, y: 2, owner: 'almaravarion' }
			],
			creeps: []
		};
		assert.strictEqual(
			playerSummary(counts, map),
			'\n  players: almaravarion (SPAWN, 2 structures, 0 creeps)'
		);
	});

	it('does not credit a spawn of mine to another player', function () {
		const counts = { tigga: { structures: 0, creeps: 1 } };
		const map = { structures: [{ type: 'spawn', x: 1, y: 1, owner: 'me' }], creeps: [] };
		assert.strictEqual(playerSummary(counts, map), '\n  players: tigga (0 structures, 1 creeps)');
	});
});

// The closing line of an import: the exact settings.json edit that turns a
// labelled player into a bot-driven one.
describe('settingsHint', function () {
	const { settingsHint } = require('../../scripts/importRoom');

	it('says nothing when the import found no other players', function () {
		assert.strictEqual(settingsHint([], 'season-block'), '');
	});

	it('names every player and shows the edit that assigns one code', function () {
		assert.strictEqual(
			settingsHint(['tigga', 'almaravarion'], 'season-block'),
			'players in this import: almaravarion, tigga\n'
			+ 'to give one a bot codebase, add it to scenarios/season-block/settings.json:\n'
			+ '  { "bots": { "almaravarion": "default" } }'
		);
	});
});

'use strict';

const assert = require('assert');
const { roomToMap, KNOWN_STRUCTURES } = require('../../src/import/roomToMap');

const terrainRows = Array.from({ length: 50 }, function () { return '.'.repeat(50); });

// classifier: 'mine' is me, 'inv' is invader, 'sk' is source keeper; a real
// player resolves to their username label (see src/import/ownerLabels.js),
// and an id we could not classify at all stays null.
function classifyOwner(userId) {
	if (userId === 'mine') return 'me';
	if (userId === 'inv') return 'invader';
	if (userId === 'sk') return 'sourceKeeper';
	if (userId === 'p1') return 'almaravarion';
	if (userId === 'p2') return 'tigga';
	return null;
}

function build(objects, options) {
	return roomToMap(Object.assign(
		{ roomName: 'W1N1', objects: objects, terrainRows: terrainRows, classifyOwner: classifyOwner },
		options || {}
	));
}

describe('roomToMap', function () {
	it('keeps my structures with owner tag and store', function () {
		const result = build([
			{ type: 'tower', x: 10, y: 10, user: 'mine', store: { energy: 500 }, hits: 3000, hitsMax: 3000 }
		]);
		assert.deepStrictEqual(result.map.structures, [
			{ type: 'tower', x: 10, y: 10, owner: 'me', store: { energy: 500 }, hits: 3000, hitsMax: 3000 }
		]);
	});

	it('keeps neutral structures without an owner field', function () {
		const result = build([{ type: 'container', x: 5, y: 5, store: { energy: 200 } }]);
		assert.deepStrictEqual(result.map.structures, [{ type: 'container', x: 5, y: 5, store: { energy: 200 } }]);
	});

	it('keeps another players structures under their username label', function () {
		const result = build([{ type: 'tower', x: 1, y: 1, user: 'p1', hits: 3000, hitsMax: 3000 }]);
		assert.deepStrictEqual(result.map.structures, [
			{ type: 'tower', x: 1, y: 1, owner: 'almaravarion', hits: 3000, hitsMax: 3000 }
		]);
	});

	it('keeps another players creeps under their username label', function () {
		const result = build([{
			type: 'creep', x: 2, y: 2, user: 'p1', name: 'badguy',
			body: [{ type: 'attack' }, { type: 'move' }], hits: 200, hitsMax: 200
		}]);
		assert.deepStrictEqual(result.map.creeps, [
			{ name: 'badguy', x: 2, y: 2, owner: 'almaravarion', body: ['attack', 'move'],
			  hits: 200, hitsMax: 200 }
		]);
	});

	it('keeps invader creeps, which are not mine but are not another player either', function () {
		const result = build([{
			type: 'creep', x: 7, y: 7, user: 'inv', name: 'invader_1',
			body: [{ type: 'ranged_attack' }, { type: 'move' }], hits: 300, hitsMax: 300
		}]);
		assert.deepStrictEqual(result.map.creeps, [
			{ name: 'invader_1', x: 7, y: 7, owner: 'invader',
			  body: ['ranged_attack', 'move'], hits: 300, hitsMax: 300 }
		]);
	});

	it('drops another players creep while it is still spawning', function () {
		const result = build([{
			type: 'creep', x: 3, y: 3, user: 'p1', name: 'theirNewborn', spawning: true,
			body: [{ type: 'move' }], hits: 100, hitsMax: 100
		}]);
		assert.deepStrictEqual(result.map.creeps, []);
	});

	it('drops an object whose owner could not be classified at all', function () {
		// classifyOwner returning null means we never resolved the id — placing
		// the object would give it an owner that cannot exist in the sim.
		const result = build([{ type: 'tower', x: 1, y: 1, user: 'whoIsThis' }]);
		assert.deepStrictEqual(result.map.structures, []);
	});

	it('omitting MY creeps and structures leaves another players alone', function () {
		const result = build([
			{ type: 'tower', x: 4, y: 4, user: 'mine' },
			{ type: 'creep', x: 3, y: 3, user: 'mine', name: 'worker', body: [{ type: 'move' }] },
			{ type: 'tower', x: 1, y: 1, user: 'p1' },
			{ type: 'creep', x: 2, y: 2, user: 'p1', name: 'badguy', body: [{ type: 'move' }] }
		], { includeMyCreeps: false, includeMyStructures: false });
		assert.deepStrictEqual(result.map.structures, [{ type: 'tower', x: 1, y: 1, owner: 'almaravarion' }]);
		assert.deepStrictEqual(result.map.creeps.map(function (c) { return c.owner; }), ['almaravarion']);
	});

	it('writes a users table for the labels the room actually uses', function () {
		const users = {
			almaravarion: { id: 'p1', username: 'Almaravarion' },
			tigga: { id: 'p2', username: 'Tigga' }
		};
		const result = build([{ type: 'tower', x: 1, y: 1, user: 'p1' }], { users: users });
		// tigga owns nothing here, so this room's map does not name them: the
		// label -> id mapping is what survives a username change on the live
		// server, and it is only meaningful for owners present in the file.
		assert.deepStrictEqual(result.map.users, { almaravarion: { id: 'p1', username: 'Almaravarion' } });
	});

	it('omits the users table when no other player owns anything', function () {
		const result = build([{ type: 'tower', x: 1, y: 1, user: 'mine' }], {
			users: { almaravarion: { id: 'p1', username: 'Almaravarion' } }
		});
		assert.strictEqual(result.map.users, undefined);
	});

	it('names another players controller with their label at its real RCL', function () {
		const result = build([{ type: 'controller', x: 20, y: 20, user: 'p1', level: 6 }]);
		assert.deepStrictEqual(result.map.controller, { x: 20, y: 20, level: 6, owner: 'almaravarion' });
	});

	it('keeps only my creeps with body as type strings', function () {
		const result = build([
			{ type: 'creep', x: 3, y: 3, user: 'mine', name: 'worker1',
			  body: [{ type: 'work', hits: 100 }, { type: 'carry', hits: 100 }, { type: 'move', hits: 100 }],
			  hits: 300, hitsMax: 300, store: { energy: 50 } }
		]);
		assert.deepStrictEqual(result.map.creeps, [
			{ name: 'worker1', x: 3, y: 3, owner: 'me', body: ['work', 'carry', 'move'],
			  hits: 300, hitsMax: 300, store: { energy: 50 } }
		]);
	});

	it('drops my creep while it is still spawning', function () {
		const result = build([{
			type: 'creep', x: 3, y: 3, user: 'mine', name: 'notBornYet', spawning: true,
			body: [{ type: 'move', hits: 100 }], hits: 100, hitsMax: 100
		}]);
		assert.deepStrictEqual(result.map.creeps, []);
	});

	it('can omit my creeps and structures without dropping neutral or NPC structures', function () {
		const result = build([
			{ type: 'creep', x: 3, y: 3, user: 'mine', name: 'worker', body: [{ type: 'move' }] },
			{ type: 'tower', x: 4, y: 4, user: 'mine' },
			{ type: 'container', x: 5, y: 5 },
			{ type: 'keeperLair', x: 6, y: 6, user: 'sk' }
		], { includeMyCreeps: false, includeMyStructures: false });
		assert.deepStrictEqual(result.map.creeps, []);
		assert.deepStrictEqual(result.map.structures.map(function (s) { return s.type; }), ['container', 'keeperLair']);
	});

	it('keeps invader and sourceKeeper structures with their tags', function () {
		const result = build([
			{ type: 'invaderCore', x: 25, y: 25, user: 'inv', level: 1 },
			{ type: 'keeperLair', x: 40, y: 40, user: 'sk' }
		]);
		const types = result.map.structures.map(function (s) { return [s.type, s.owner]; });
		assert.deepStrictEqual(types, [['invaderCore', 'invader'], ['keeperLair', 'sourceKeeper']]);
	});

	it('routes controller, sources, minerals to their own fields', function () {
		const result = build([
			{ type: 'controller', x: 20, y: 20, user: 'mine', level: 4 },
			{ type: 'source', x: 30, y: 30, energy: 3000 },
			{ type: 'mineral', x: 35, y: 35, mineralType: 'H', density: 3 }
		]);
		assert.deepStrictEqual(result.map.controller, { x: 20, y: 20, level: 4, owner: 'me' });
		assert.deepStrictEqual(result.map.sources, [{ x: 30, y: 30 }]);
		assert.deepStrictEqual(result.map.minerals, [{ x: 35, y: 35, mineralType: 'H', density: 3 }]);
		assert.deepStrictEqual(result.map.structures, []);
	});

	it('preserves controller ownership (owned base loads claimed, not RCL 0)', function () {
		const owned = build([{ type: 'controller', x: 20, y: 20, user: 'mine', level: 5 }]);
		assert.deepStrictEqual(owned.map.controller, { x: 20, y: 20, level: 5, owner: 'me' });
		// An unowned controller carries no owner field.
		const unowned = build([{ type: 'controller', x: 20, y: 20, level: 0 }]);
		assert.deepStrictEqual(unowned.map.controller, { x: 20, y: 20, level: 0 });
		// An unclassifiable owner carries no owner field rather than becoming 'me'.
		const unknown = build([{ type: 'controller', x: 20, y: 20, user: 'whoIsThis', level: 6 }]);
		assert.deepStrictEqual(unknown.map.controller, { x: 20, y: 20, level: 6 });
	});

	it('records how much of a mineral is LEFT, not a fresh one', function () {
		// Without this a half-mined mineral imports as full — and Season 5
		// Thorium is finite, so there is no "full" to rewind it to.
		const result = build([
			{ type: 'mineral', x: 35, y: 35, mineralType: 'T', density: 3, mineralAmount: 12345 }
		]);
		assert.deepStrictEqual(result.map.minerals, [
			{ x: 35, y: 35, mineralType: 'T', density: 3, mineralAmount: 12345 }
		]);
	});

	it('records a mineral that has been mined out', function () {
		const result = build([{ type: 'mineral', x: 1, y: 1, mineralType: 'H', density: 1, mineralAmount: 0 }]);
		assert.strictEqual(result.map.minerals[0].mineralAmount, 0);
	});

	it('drops a mod object type by default, and keeps it when the mod is selected', function () {
		const reactor = { type: 'reactor', x: 25, y: 25, user: 'mine', store: { T: 40 } };
		const vanilla = build([reactor]);
		assert.deepStrictEqual(vanilla.map.structures, []);
		assert.deepStrictEqual(vanilla.skipped, { reactor: 1 });

		const season5 = build([reactor], { extraStructureTypes: ['reactor'] });
		assert.deepStrictEqual(season5.skipped, {});
		assert.deepStrictEqual(season5.map.structures, [
			{ type: 'reactor', x: 25, y: 25, owner: 'me', store: { T: 40 } }
		]);
	});

	it('drops the live-server launchTime from a reactor', function () {
		// It is an absolute tick on the source server; here it would make
		// gameTime - launchTime negative and the mod's score formula NaN.
		const result = build([
			{ type: 'reactor', x: 25, y: 25, user: 'mine', store: { T: 40 }, launchTime: 48123456 }
		], { extraStructureTypes: ['reactor'] });
		assert.strictEqual(result.map.structures[0].launchTime, undefined);
	});

	// A power bank is a neutral, unowned structure the live API reports like any
	// other. Before it was listed as known it fell through to the unknown-type
	// branch, so importing the one room it was in produced a map without it.
	it('keeps a power bank with its power, hits and remaining lifetime', function () {
		// Shape taken verbatim from a live season E30S21 snapshot.
		const result = build([{
			_id: '6aa08296cb612e298351a872', type: 'powerBank', x: 36, y: 26, room: 'E30S21',
			store: { power: 8727 }, hits: 2000000, hitsMax: 2000000, decayTime: 264175
		}], { gameTime: 263943 });
		assert.deepStrictEqual(result.skipped, {});
		assert.deepStrictEqual(result.map.structures, [{
			type: 'powerBank', x: 36, y: 26, hits: 2000000, hitsMax: 2000000,
			ticksToDecay: 232, store: { power: 8727 }
		}]);
	});

	// decayTime is an absolute tick on the SOURCE server (~264k on season). Copied
	// as-is into a sim that starts near 0 it sits millions of ticks away, so the
	// bank never decays — and its 5000-tick clock is the whole mechanic.
	it('rebases an absolute decay deadline onto the sim clock', function () {
		const result = build([
			{ type: 'powerBank', x: 20, y: 20, store: { power: 3000 }, decayTime: 500000 }
		], { gameTime: 499100 });
		assert.strictEqual(result.map.structures[0].decayTime, undefined);
		assert.strictEqual(result.map.structures[0].ticksToDecay, 900);
	});

	// A bank on its last tick must still import as a live object, not one the
	// loader deletes on sight (a non-positive lifetime does exactly that).
	it('floors a rebased lifetime at one tick', function () {
		const result = build([
			{ type: 'powerBank', x: 20, y: 20, store: { power: 10 }, decayTime: 1000 }
		], { gameTime: 1200 });
		assert.strictEqual(result.map.structures[0].ticksToDecay, 1);
	});

	// No source tick means no reference point, so an absolute deadline is
	// meaningless — drop it and let the loader seed a full fresh lifetime.
	it('drops an absolute decay deadline when the source tick is unknown', function () {
		const result = build([
			{ type: 'powerBank', x: 20, y: 20, store: { power: 3000 }, decayTime: 500000 }
		]);
		assert.strictEqual(result.map.structures[0].decayTime, undefined);
		assert.strictEqual(result.map.structures[0].ticksToDecay, undefined);
	});

	// A constructedWall's decayTime means a temporary newbie/respawn wall, NOT a
	// decay clock — rebasing it would turn every wall in an imported base into
	// something that expires.
	it('leaves a constructed wall decayTime alone', function () {
		const result = build([
			{ type: 'constructedWall', x: 20, y: 20, hits: 100, hitsMax: 100, decayTime: 500000 }
		], { gameTime: 499100 });
		assert.strictEqual(result.map.structures[0].decayTime, 500000);
		assert.strictEqual(result.map.structures[0].ticksToDecay, undefined);
	});

	it('preserves source and mineral ids when present', function () {
		const result = build([
			{ type: 'source', x: 10, y: 10, _id: 'src123' },
			{ type: 'mineral', x: 11, y: 11, mineralType: 'H', density: 3, _id: 'min456' }
		]);
		assert.deepStrictEqual(result.map.sources, [{ x: 10, y: 10, id: 'src123' }]);
		assert.deepStrictEqual(result.map.minerals, [{ x: 11, y: 11, mineralType: 'H', density: 3, id: 'min456' }]);
	});

	it('drops unknown custom types and counts them in skipped', function () {
		const result = build([
			{ type: 'score', x: 12, y: 12, user: 'mine' },
			{ type: 'score', x: 13, y: 13 }
		]);
		assert.deepStrictEqual(result.map.structures, []);
		assert.deepStrictEqual(result.skipped, { score: 2 });
	});

	it('emits room name and terrain rows unchanged', function () {
		const result = build([]);
		assert.strictEqual(result.map.room, 'W1N1');
		assert.strictEqual(result.map.terrain.length, 50);
		assert.ok(KNOWN_STRUCTURES.has('tower'));
	});
});

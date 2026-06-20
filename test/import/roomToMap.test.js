'use strict';

const assert = require('assert');
const { roomToMap, KNOWN_STRUCTURES } = require('../../src/import/roomToMap');

const terrainRows = Array.from({ length: 50 }, function () { return '.'.repeat(50); });

// classifier: 'mine' is me, 'inv' is invader, 'sk' is source keeper, others null
function classifyOwner(userId) {
	if (userId === 'mine') return 'me';
	if (userId === 'inv') return 'invader';
	if (userId === 'sk') return 'sourceKeeper';
	return null;
}

function build(objects) {
	return roomToMap({ roomName: 'W1N1', objects: objects, terrainRows: terrainRows, classifyOwner: classifyOwner });
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

	it('drops other players structures and creeps', function () {
		const result = build([
			{ type: 'tower', x: 1, y: 1, user: 'enemy' },
			{ type: 'creep', x: 2, y: 2, user: 'enemy', name: 'badguy', body: [{ type: 'move' }] }
		]);
		assert.deepStrictEqual(result.map.structures, []);
		assert.deepStrictEqual(result.map.creeps, []);
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
		assert.deepStrictEqual(result.map.controller, { x: 20, y: 20, level: 4 });
		assert.deepStrictEqual(result.map.sources, [{ x: 30, y: 30 }]);
		assert.deepStrictEqual(result.map.minerals, [{ x: 35, y: 35, mineralType: 'H', density: 3 }]);
		assert.deepStrictEqual(result.map.structures, []);
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

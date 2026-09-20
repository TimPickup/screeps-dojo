import { describe, expect, it } from 'vitest';
import {
	countByType, makeEditableObject, mapRcl, nextCreepName, parseEditableMap,
	selectionRank, serializeEditableMap, structureLayer, type EditableMap,
} from '../mapModel';

const terrain = Array.from({ length: 50 }, () => '.'.repeat(50));
const base = (extra: Record<string, unknown> = {}) => ({ room: 'W1N1', terrain, structures: [], flags: [], ...extra });

describe('creeps in the editable model', () => {
	it('models a positioned creep as a tile object instead of hiding it in passthrough', () => {
		const parsed = parseEditableMap(base({
			creeps: [{ name: 'harvester1', x: 12, y: 34, owner: 'me', body: ['work', 'move'], store: { energy: 40 } }],
		}));
		const creep = parsed.map!.structures.find((object) => object.type === 'creep');
		expect(creep).toMatchObject({ type: 'creep', name: 'harvester1', x: 12, y: 34, owner: 'me' });
	});

	it('writes creeps back into the file\'s own creeps array', () => {
		const parsed = parseEditableMap(base({
			creeps: [{ name: 'a', x: 1, y: 2, owner: 'invader', body: ['attack'], hits: 100, hitsMax: 100 }],
		}));
		const output = JSON.parse(serializeEditableMap(parsed.map!));
		expect(output.creeps).toEqual([
			{ name: 'a', x: 1, y: 2, body: ['attack'], owner: 'invader', hits: 100, hitsMax: 100 },
		]);
		expect(output.structures).toEqual([]);
	});

	it('keeps a boosts map and any field the editor has no control for', () => {
		const parsed = parseEditableMap(base({
			creeps: [{
				name: 'boosted', x: 5, y: 5, body: ['work'], boosts: { work: 'XUH2O' },
				ticksToLive: 900, fatigue: 3, id: 'abc123', saying: 'hi',
			}],
		}));
		const output = JSON.parse(serializeEditableMap(parsed.map!));
		expect(output.creeps[0]).toMatchObject({
			boosts: { work: 'XUH2O' }, ticksToLive: 900, fatigue: 3, id: 'abc123', saying: 'hi',
		});
	});

	it('preserves a creep entry that has no position rather than dropping it', () => {
		// Not placeable on a tile, but it is the user's data.
		const parsed = parseEditableMap(base({ creeps: [{ name: 'noPosition' }] }));
		expect(parsed.map!.structures.filter((o) => o.type === 'creep')).toHaveLength(0);
		const output = JSON.parse(serializeEditableMap(parsed.map!));
		expect(output.creeps).toEqual([{ name: 'noPosition' }]);
	});

	it('gives an unnamed creep a name the engine will accept', () => {
		const parsed = parseEditableMap(base({ creeps: [{ x: 1, y: 1, body: ['move'] }] }));
		const output = JSON.parse(serializeEditableMap(parsed.map!));
		expect(output.creeps[0].name).toMatch(/^creep\d+$/);
	});

	it('picks a free creep name', () => {
		expect(nextCreepName([{ type: 'creep', x: 0, y: 0, name: 'creep1' }])).toBe('creep2');
		expect(nextCreepName([])).toBe('creep1');
	});

	it('gives a new creep a body and an owner, since addCreep requires both', () => {
		const creep = makeEditableObject('creep', 3, 4);
		expect(creep).toMatchObject({ type: 'creep', x: 3, y: 4, owner: 'me', body: ['move'] });
		expect(creep.name).toMatch(/^creep\d+$/);
	});
});

describe('structure ids', () => {
	// The engine ties objects together by id — a keeper is named after its
	// lair's id — so dropping them on save quietly breaks an imported room.
	it('keeps an imported structure id through a round trip', () => {
		const parsed = parseEditableMap(base({
			structures: [{ type: 'keeperLair', x: 10, y: 10, id: 'deadbeef0000000000000001' }],
		}));
		const output = JSON.parse(serializeEditableMap(parsed.map!));
		expect(output.structures[0].id).toBe('deadbeef0000000000000001');
	});
});

describe('loose objects', () => {
	it('round-trips a dropped resource, tombstone and ruin through structures[]', () => {
		const parsed = parseEditableMap(base({
			structures: [
				{ type: 'energy', x: 5, y: 5, resourceType: 'energy', amount: 800 },
				{ type: 'tombstone', x: 6, y: 5, store: { energy: 20 }, ticks: { decayTime: 40 } },
				{ type: 'ruin', x: 7, y: 5, structureType: 'storage', store: {} },
			],
		}));
		const output = JSON.parse(serializeEditableMap(parsed.map!));
		expect(output.structures).toHaveLength(3);
		expect(output.structures[0]).toMatchObject({ type: 'energy', resourceType: 'energy', amount: 800 });
		expect(output.structures[1]).toMatchObject({ type: 'tombstone', ticks: { decayTime: 40 } });
		expect(output.structures[2]).toMatchObject({ type: 'ruin', structureType: 'storage' });
	});

	it('gives a new dropped pile the amount/resourceType the loader converts', () => {
		expect(makeEditableObject('energy', 1, 1)).toMatchObject({ type: 'energy', resourceType: 'energy', amount: 500 });
	});
});

describe('tile layers', () => {
	it('stacks the way the game does', () => {
		expect(structureLayer('road')).toBe('floor');
		expect(structureLayer('rampart')).toBe('overlay');
		expect(structureLayer('creep')).toBe('unit');
		expect(structureLayer('energy')).toBe('loose');
		expect(structureLayer('tombstone')).toBe('loose');
		expect(structureLayer('storage')).toBe('main');
	});

	it('offers a creep before a structure before a road in the picker', () => {
		expect(selectionRank('creep')).toBeLessThan(selectionRank('energy'));
		expect(selectionRank('energy')).toBeLessThan(selectionRank('storage'));
		expect(selectionRank('storage')).toBeLessThan(selectionRank('rampart'));
		expect(selectionRank('rampart')).toBeLessThan(selectionRank('road'));
	});
});

describe('room RCL', () => {
	const map = (controller: Record<string, unknown> | null): EditableMap => ({
		room: 'W1N1', terrain, flags: [], strayCreeps: [], extra: {},
		structures: controller ? [{ type: 'controller', x: 25, y: 25, ...controller }] : [],
	});

	it('is the owned controller\'s level', () => {
		expect(mapRcl(map({ owner: 'me', level: 6 }))).toBe(6);
	});

	it('is 0 for an unclaimed or missing controller', () => {
		expect(mapRcl(map({ level: 6 }))).toBe(0);
		expect(mapRcl(map({ owner: 'unclaimed', level: 6 }))).toBe(0);
		expect(mapRcl(map(null))).toBe(0);
	});

	it('clamps a nonsense level', () => {
		expect(mapRcl(map({ owner: 'me', level: 99 }))).toBe(8);
	});
});

describe('counts for the build panel', () => {
	it('counts every type plus flags', () => {
		const parsed = parseEditableMap(base({
			structures: [{ type: 'extension', x: 1, y: 1 }, { type: 'extension', x: 2, y: 1 }, { type: 'tower', x: 3, y: 1 }],
			flags: [{ name: 'f', x: 9, y: 9 }],
			creeps: [{ name: 'c', x: 4, y: 4, body: ['move'] }],
		}));
		expect(countByType(parsed.map!)).toMatchObject({ extension: 2, tower: 1, creep: 1, flag: 1 });
	});
});

describe('flags', () => {
	it('keeps colours and any other field through a round trip', () => {
		const parsed = parseEditableMap(base({ flags: [{ name: 'rally', x: 8, y: 9, color: 5, secondaryColor: 2 }] }));
		const output = JSON.parse(serializeEditableMap(parsed.map!));
		expect(output.flags[0]).toEqual({ name: 'rally', x: 8, y: 9, color: 5, secondaryColor: 2 });
	});
});

import { describe, expect, it } from 'vitest';
import { parseEditableMap, serializeEditableMap } from '../mapModel';

// Opening a map in the visual editor must not change it. The editor
// re-serializes on load, and EditTab compares the result against the file to
// decide whether you have unsaved changes — so any field the serializer
// silently drops shows up as a file that is "edited" the moment you look at
// it, AND is genuinely lost the moment you save.
//
// These cases are taken from real scenario maps that regressed: an imported
// lab, a stronghold's invader core, and an unclaimed controller.

const terrain = Array.from({ length: 50 }, () => '.'.repeat(50));
const roundTrip = (input: Record<string, unknown>) => {
	const parsed = parseEditableMap({ room: 'W1N1', terrain, ...input });
	expect(parsed.error).toBeNull();
	return JSON.parse(serializeEditableMap(parsed.map!));
};

describe('a map survives being opened', () => {
	it('keeps a lab\'s mineralType and mineralAmount', () => {
		// These used to be stripped: the serializer treated them as fields only
		// a `mineral` object could own.
		const lab = {
			type: 'lab', x: 10, y: 26, owner: 'me', hits: 500, hitsMax: 500,
			mineralType: 'GO', mineralAmount: 3000, cooldown: 0,
			storeCapacity: 5000, storeCapacityResource: { energy: 2000 },
			store: { energy: 2000, GO: 3000 },
		};
		expect(roundTrip({ structures: [lab] }).structures[0]).toEqual(lab);
	});

	it('keeps level 0 on a structure and on the controller', () => {
		// A stronghold's invader core sits at level 0 until it deploys, and an
		// unclaimed controller IS level 0 — both were being dropped.
		const core = { type: 'invaderCore', x: 9, y: 26, owner: 'invader', level: 0, hits: 100000, hitsMax: 100000 };
		const out = roundTrip({ structures: [core], controller: { x: 25, y: 25, level: 0 } });
		expect(out.structures[0]).toEqual(core);
		expect(out.controller).toEqual({ x: 25, y: 25, level: 0 });
	});

	it('keeps a structure\'s id, energy and every unmodelled field', () => {
		const structure = {
			type: 'keeperLair', x: 5, y: 5, id: 'deadbeef0000000000000001',
			nextSpawnTime: null, energy: 12, energyCapacity: 100, density: 2,
			effects: [{ effect: 1001, ticksRemaining: 50 }],
		};
		expect(roundTrip({ structures: [structure] }).structures[0]).toEqual(structure);
	});

	it('still migrates the legacy shape, which IS a repair worth saving', () => {
		// sources/minerals/controller inside structures[] move to the top level
		// and gain ids. That is a real change, and the editor should report the
		// file as edited so it gets written back.
		const out = roundTrip({ structures: [{ type: 'source', x: 3, y: 2 }, { type: 'controller', x: 26, y: 28 }] });
		expect(out.structures).toEqual([]);
		expect(out.sources[0]).toMatchObject({ x: 3, y: 2 });
		expect(out.sources[0].id).toMatch(/^[a-f0-9]{24}$/);
		expect(out.controller).toEqual({ x: 26, y: 28 });
	});
});

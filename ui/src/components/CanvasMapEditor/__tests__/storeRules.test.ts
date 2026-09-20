import { describe, expect, it } from 'vitest';
import {
	addableResources, choiceResource, creepCapacity, explicitCapacityFor, extensionCapacity,
	maxAmountFor, storeModel, storeSummary, unexpectedResources,
} from '../storeRules';
import { allResources } from '../gameData';

const every = allResources(undefined);

// A fixed store's slots ARE the structure: there is nothing to add or remove,
// so the editor must not offer a resource the structure cannot legally hold.
describe('fixed stores', () => {
	it('gives a spawn exactly one energy slot, capped at SPAWN_ENERGY_CAPACITY', () => {
		const model = storeModel({ type: 'spawn' }, 8);
		expect(model).toEqual({ kind: 'fixed', slots: [{ kind: 'resource', resource: 'energy', capacity: 300 }] });
		expect(addableResources(model, {}, every)).toEqual([]);
		expect(maxAmountFor(model, {}, 'energy')).toBe(300);
	});

	it('gives a nuker exactly energy and G, each with its own ceiling', () => {
		const model = storeModel({ type: 'nuker' }, 8);
		expect(model).toEqual({
			kind: 'fixed',
			slots: [
				{ kind: 'resource', resource: 'energy', capacity: 300000 },
				{ kind: 'resource', resource: 'G', capacity: 5000 },
			],
		});
		// The two ceilings are independent: filling one does not shrink the other.
		expect(maxAmountFor(model, { energy: 300000 }, 'G')).toBe(5000);
		expect(addableResources(model, {}, every)).toEqual([]);
	});

	it('gives a power spawn energy and power', () => {
		const model = storeModel({ type: 'powerSpawn' }, 8);
		expect(model.kind).toBe('fixed');
		expect(maxAmountFor(model, {}, 'energy')).toBe(5000);
		expect(maxAmountFor(model, {}, 'power')).toBe(100);
	});

	it('gives a tower and a link one energy slot each', () => {
		expect(maxAmountFor(storeModel({ type: 'tower' }, 8), {}, 'energy')).toBe(1000);
		expect(maxAmountFor(storeModel({ type: 'link' }, 8), {}, 'energy')).toBe(800);
	});

	it('gives a power bank a single power slot with no ceiling', () => {
		// Season banks routinely exceed POWER_BANK_CAPACITY_MAX.
		const model = storeModel({ type: 'powerBank', store: { power: 9000 } }, 0);
		expect(model).toEqual({ kind: 'fixed', slots: [{ kind: 'resource', resource: 'power', capacity: null }] });
		expect(maxAmountFor(model, { power: 9000 }, 'power')).toBeNull();
	});

	it('scales an extension with the RCL', () => {
		expect(extensionCapacity(2)).toBe(50);
		expect(extensionCapacity(7)).toBe(100);
		expect(extensionCapacity(8)).toBe(200);
		expect(maxAmountFor(storeModel({ type: 'extension' }, 8), {}, 'energy')).toBe(200);
	});
});

describe('a lab', () => {
	const model = storeModel({ type: 'lab' }, 8);

	it('has an energy slot and ONE pick-a-mineral slot', () => {
		expect(model.kind).toBe('fixed');
		if (model.kind !== 'fixed') return;
		expect(model.slots).toHaveLength(2);
		expect(model.slots[0]).toEqual({ kind: 'resource', resource: 'energy', capacity: 2000 });
		expect(model.slots[1]).toMatchObject({ kind: 'choice', label: 'mineral', capacity: 3000 });
		// The mineral slot offers every non-energy resource, and only those.
		if (model.slots[1].kind !== 'choice') return;
		expect(model.slots[1].options).toContain('XUHO2');
		expect(model.slots[1].options).not.toContain('energy');
	});

	it('offers nothing to "add" — the slots are the whole store', () => {
		expect(addableResources(model, {}, every)).toEqual([]);
		expect(addableResources(model, { GO: 100 }, every)).toEqual([]);
	});

	it('reads the chosen mineral out of the store', () => {
		if (model.kind !== 'fixed') return;
		expect(choiceResource(model.slots, { energy: 500, GO: 3000 })).toBe('GO');
		expect(choiceResource(model.slots, { energy: 500 })).toBeUndefined();
	});

	it('caps energy at 2,000 and the mineral at 3,000, independently', () => {
		expect(maxAmountFor(model, { energy: 2000, GO: 100 }, 'energy')).toBe(2000);
		expect(maxAmountFor(model, { energy: 2000, GO: 100 }, 'GO')).toBe(3000);
	});

	it('ignores the storeCapacityResource an imported lab carries', () => {
		// roomToMap copies `{ energy: 2000 }` off the live doc. Trusting it
		// would strip the mineral slot the lab exists for.
		const imported = storeModel({ type: 'lab', storeCapacityResource: { energy: 2000 }, store: { GO: 3000 } }, 8);
		expect(imported.kind).toBe('fixed');
		if (imported.kind !== 'fixed') return;
		expect(imported.slots).toHaveLength(2);
		expect(imported.slots[1].kind).toBe('choice');
	});

	it('reports a second mineral as unexpected rather than hiding it', () => {
		// Not reachable through the UI, but a hand-written map can say it.
		expect(unexpectedResources(model, { energy: 10, GO: 100, LO: 200 })).toEqual(['LO']);
		expect(unexpectedResources(model, { energy: 10, GO: 100 })).toEqual([]);
	});
});

describe('free stores', () => {
	it('gives a storage one shared pool that any resource can use', () => {
		const model = storeModel({ type: 'storage', store: { energy: 900000 } }, 8);
		expect(model).toEqual({ kind: 'free', capacity: 1000000 });
		// What energy may grow to is what the OTHER resources have not taken.
		expect(maxAmountFor(model, { energy: 900000, H: 50000 }, 'energy')).toBe(950000);
		expect(maxAmountFor(model, { energy: 900000, H: 50000 }, 'H')).toBe(100000);
		expect(addableResources(model, { energy: 1 }, every)).not.toContain('energy');
		expect(addableResources(model, { energy: 1 }, every)).toContain('G');
	});

	it('sizes a creep off its body', () => {
		expect(storeModel({ type: 'creep', body: ['carry', 'carry', 'move'] }, 0)).toEqual({ kind: 'free', capacity: 100 });
	});

	it('leaves a tombstone and a ruin uncapped', () => {
		expect(storeModel({ type: 'tombstone' }, 8)).toEqual({ kind: 'free', capacity: null });
		expect(maxAmountFor(storeModel({ type: 'ruin' }, 8), { energy: 10 }, 'energy')).toBeNull();
	});
});

describe('no store at all', () => {
	it('covers roads, walls, controllers and dropped piles', () => {
		// A dropped pile is a resource + an amount on the object, not an inventory.
		for (const type of ['road', 'constructedWall', 'controller', 'observer', 'extractor', 'energy']) {
			expect(storeModel({ type }, 8).kind, type).toBe('none');
		}
	});

	it('falls back to an unknown type\'s own declared capacity', () => {
		expect(storeModel({ type: 'somethingModded', storeCapacity: 9999 }, 8)).toEqual({ kind: 'free', capacity: 9999 });
		expect(storeModel({ type: 'somethingModded', storeCapacityResource: { XYZ: 10 } }, 8))
			.toEqual({ kind: 'fixed', slots: [{ kind: 'resource', resource: 'XYZ', capacity: 10 }] });
	});
});

describe('creep capacity', () => {
	it('is 50 per CARRY part', () => {
		expect(creepCapacity(['carry', 'carry', 'move'])).toBe(100);
		expect(creepCapacity(['work', 'move'])).toBe(0);
	});

	it('honours a carry boost from either body shape', () => {
		expect(creepCapacity(['carry', 'carry'], { carry: 'XKH2O' })).toBe(400);
		expect(creepCapacity([{ type: 'carry', boost: 'KH' }, { type: 'carry' }])).toBe(150);
	});
});

describe('store summary', () => {
	it('flags a free store that is over capacity', () => {
		const model = storeModel({ type: 'container' }, 8);
		expect(storeSummary(model, { energy: 2000 })).toEqual({ used: 2000, capacity: 2000, over: false });
		expect(storeSummary(model, { energy: 2500 })).toEqual({ used: 2500, capacity: 2000, over: true });
	});

	it('flags a fixed store that is over ONE of its ceilings', () => {
		const model = storeModel({ type: 'nuker' }, 8);
		expect(storeSummary(model, { energy: 10, G: 6000 }).over).toBe(true);
		expect(storeSummary(model, { energy: 10, G: 5000 }).over).toBe(false);
	});

	it('flags a resource the structure cannot hold', () => {
		expect(storeSummary(storeModel({ type: 'lab' }, 8), { GO: 1, LO: 1 }).over).toBe(true);
	});
});

describe('capacity written onto the map', () => {
	it('spells out what the loader\'s default would get wrong', () => {
		// The loader defaults every extension to energy 50 and every lab to
		// energy-only, so a high-RCL extension and a lab holding a mineral both
		// need their capacity stated explicitly.
		expect(explicitCapacityFor({ type: 'extension' }, 5)).toBeNull();
		expect(explicitCapacityFor({ type: 'extension' }, 8)).toEqual({ energy: 200 });
		expect(explicitCapacityFor({ type: 'lab', store: { energy: 100 } }, 8)).toBeNull();
		expect(explicitCapacityFor({ type: 'lab', store: { energy: 100, UH: 5 } }, 8))
			.toEqual({ energy: 2000, UH: 3000 });
	});
});

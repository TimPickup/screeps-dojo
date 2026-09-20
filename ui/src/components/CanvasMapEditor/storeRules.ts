// What a given object's store may legally hold, and how much of it.
//
// Screeps stores come in two shapes, and conflating them is how an editor ends
// up letting you put Ghodium in a spawn:
//
//   FIXED   a known set of slots. A nuker holds energy and G, nothing else,
//           with a separate ceiling on each. A lab holds energy plus ONE
//           mineral of your choosing. There is nothing to add or remove — the
//           slots are the structure.
//   FREE    one shared pool that takes anything (storage, terminal, container,
//           factory, a creep, a tombstone). Here adding and removing resources
//           is the whole interaction.
//
// Capacities mirror the defaults the dojo loader applies
// (src/dojoWorld.js structureDefaults) so what the editor shows is what the run
// will get.

import { CARRY_CAPACITY, carryBoostMultiplier, nonEnergyResources } from './gameData';

// A slot holding one named resource. `capacity` null means no ceiling the
// editor can enforce (a power bank: season banks routinely exceed
// POWER_BANK_CAPACITY_MAX).
export interface FixedSlot {
	kind: 'resource';
	resource: string;
	capacity: number | null;
}

// A slot whose resource the user picks — a lab's mineral. Exactly one resource
// at a time; choosing a different one moves the amount across.
export interface ChoiceSlot {
	kind: 'choice';
	label: string;
	options: string[];
	capacity: number;
}

export type StoreSlot = FixedSlot | ChoiceSlot;

export type StoreModel =
	| { kind: 'fixed'; slots: StoreSlot[] }
	| { kind: 'free'; capacity: number | null }
	| { kind: 'none' };

export interface StoreObjectLike {
	type: string;
	store?: Record<string, number>;
	body?: unknown;
	boosts?: Record<string, string>;
	level?: number;
	storeCapacity?: number;
	storeCapacityResource?: Record<string, number>;
}

// EXTENSION_ENERGY_CAPACITY, by RCL. The dojo loader defaults every extension
// to 50, so the editor writes an explicit storeCapacityResource whenever the
// RCL-derived cap is bigger — see explicitCapacityFor.
const EXTENSION_ENERGY_CAPACITY = [50, 50, 50, 50, 50, 50, 50, 100, 200];

export function extensionCapacity(rcl: number): number {
	return EXTENSION_ENERGY_CAPACITY[Math.max(0, Math.min(8, Math.floor(rcl)))];
}

export function extensionNeedsExplicitCapacity(rcl: number): boolean {
	return extensionCapacity(rcl) > 50;
}

export const LAB_ENERGY_CAPACITY = 2000;
export const LAB_MINERAL_CAPACITY = 3000;

// Total carry capacity of a body, honouring carry boosts (CARRY_CAPACITY 50,
// ×2/×3/×4 for KH/KH2O/XKH2O). Accepts both body shapes the engine takes: a
// list of part names with a separate `boosts` map, or a list of
// { type, boost } entries.
export function creepCapacity(body: unknown, boosts?: Record<string, string>): number {
	if (!Array.isArray(body)) return 0;
	let total = 0;
	for (const part of body) {
		if (typeof part === 'string') {
			if (part === 'carry') total += CARRY_CAPACITY * carryBoostMultiplier(boosts?.carry);
			continue;
		}
		if (part && typeof part === 'object') {
			const entry = part as { type?: string; boost?: string };
			if (entry.type === 'carry') {
				total += CARRY_CAPACITY * carryBoostMultiplier(entry.boost ?? boosts?.carry);
			}
		}
	}
	return total;
}

// Structures with one shared pool, and its size (structureDefaults).
const FREE_CAPACITY: Record<string, number> = {
	storage: 1000000,
	terminal: 300000,
	container: 2000,
	factory: 50000,
	// Season 5. The mod's processor reads whatever is in here; the editor has
	// no authority to say a reactor may only hold Thorium, so it stays free.
	reactor: 1000,
};

// Structures whose store is a fixed set of named resources, with a ceiling on
// each (structureDefaults storeCapacityResource).
const FIXED_CAPS: Record<string, Record<string, number>> = {
	spawn: { energy: 300 },
	tower: { energy: 1000 },
	link: { energy: 800 },
	nuker: { energy: 300000, G: 5000 },
	powerSpawn: { energy: 5000, power: 100 },
};

function named(resource: string, capacity: number | null): FixedSlot {
	return { kind: 'resource', resource, capacity };
}

export function storeModel(object: StoreObjectLike, rcl: number, mods?: string[]): StoreModel {
	const type = object.type;

	// --- the types the editor knows the rules for -------------------------
	// These come FIRST, ahead of any storeCapacityResource on the object: an
	// imported lab carries `{ energy: 2000 }` and nothing else, and trusting
	// that would strip the mineral slot the lab is for.
	if (type === 'lab') {
		return {
			kind: 'fixed',
			slots: [
				named('energy', LAB_ENERGY_CAPACITY),
				{ kind: 'choice', label: 'mineral', options: nonEnergyResources(mods), capacity: LAB_MINERAL_CAPACITY },
			],
		};
	}
	if (type === 'extension') return { kind: 'fixed', slots: [named('energy', extensionCapacity(rcl))] };
	if (type === 'powerBank') return { kind: 'fixed', slots: [named('power', null)] };
	if (FIXED_CAPS[type]) {
		return { kind: 'fixed', slots: Object.keys(FIXED_CAPS[type]).map((r) => named(r, FIXED_CAPS[type][r])) };
	}
	// A dropped pile is ONE resource and an amount, not an inventory — the
	// engine keeps it as `energy: 500` on the object itself, and the panel
	// edits it with the resource + amount fields instead.
	if (type === 'energy' || type === 'resource') return { kind: 'none' };
	if (type === 'creep' || type === 'powerCreep') {
		return { kind: 'free', capacity: creepCapacity(object.body, object.boosts) };
	}
	// No ceiling the editor can know.
	if (type === 'tombstone' || type === 'ruin') return { kind: 'free', capacity: null };
	if (FREE_CAPACITY[type] !== undefined) return { kind: 'free', capacity: FREE_CAPACITY[type] };

	// --- a type the editor has no rule for (a mod's own structure) --------
	// Its own declared capacity is the only thing to go on.
	if (object.storeCapacityResource && Object.keys(object.storeCapacityResource).length) {
		const caps = object.storeCapacityResource;
		return { kind: 'fixed', slots: Object.keys(caps).map((r) => named(r, caps[r])) };
	}
	if (typeof object.storeCapacity === 'number' && object.storeCapacity > 0) {
		return { kind: 'free', capacity: object.storeCapacity };
	}
	return { kind: 'none' };
}

export function hasStore(object: StoreObjectLike, rcl: number, mods?: string[]): boolean {
	return storeModel(object, rcl, mods).kind !== 'none';
}

export function storeUsed(store: Record<string, number> | undefined): number {
	if (!store) return 0;
	let total = 0;
	for (const key of Object.keys(store)) total += Number(store[key]) || 0;
	return total;
}

// Which resource currently occupies a choice slot: the one thing in the store
// that no fixed slot claims. undefined when the slot is empty.
export function choiceResource(
	slots: readonly StoreSlot[],
	store: Record<string, number> | undefined,
): string | undefined {
	const claimed = new Set(slots.filter((s): s is FixedSlot => s.kind === 'resource').map((s) => s.resource));
	return Object.keys(store || {}).find((resource) => !claimed.has(resource));
}

// Anything in the store that no slot accounts for. Should be empty, but an
// imported or hand-written object can carry a resource the structure cannot
// legally hold — and quietly hiding it would be worse than showing it.
export function unexpectedResources(
	model: StoreModel,
	store: Record<string, number> | undefined,
): string[] {
	if (model.kind !== 'fixed') return [];
	const keys = Object.keys(store || {});
	const claimed = new Set(model.slots.filter((s): s is FixedSlot => s.kind === 'resource').map((s) => s.resource));
	const choices = model.slots.filter((s) => s.kind === 'choice').length;
	const unclaimed = keys.filter((resource) => !claimed.has(resource));
	// The first `choices` unclaimed resources sit in the choice slots.
	return unclaimed.slice(choices);
}

// The largest legal amount for `resource`, given what else is in the store.
// null means no ceiling the editor can enforce.
export function maxAmountFor(
	model: StoreModel,
	store: Record<string, number> | undefined,
	resource: string,
): number | null {
	if (model.kind === 'none') return 0;
	if (model.kind === 'free') {
		if (model.capacity === null) return null;
		// One shared pool: this resource may grow into whatever the others are
		// not using.
		const others = storeUsed(store) - (Number(store?.[resource]) || 0);
		return Math.max(0, model.capacity - others);
	}
	for (const slot of model.slots) {
		if (slot.kind === 'resource' && slot.resource === resource) return slot.capacity;
	}
	// Whatever is in a choice slot is bounded by that slot.
	const choice = model.slots.find((slot): slot is ChoiceSlot => slot.kind === 'choice');
	return choice ? choice.capacity : 0;
}

// Header summary: what is in there against what fits, and whether any single
// ceiling has been exceeded.
export function storeSummary(
	model: StoreModel,
	store: Record<string, number> | undefined,
): { used: number; capacity: number | null; over: boolean } {
	const used = storeUsed(store);
	if (model.kind === 'none') return { used, capacity: null, over: false };
	if (model.kind === 'free') {
		return { used, capacity: model.capacity, over: model.capacity !== null && used > model.capacity };
	}
	let capacity = 0;
	let unbounded = false;
	for (const slot of model.slots) {
		if (slot.kind === 'choice') capacity += slot.capacity;
		else if (slot.capacity === null) unbounded = true;
		else capacity += slot.capacity;
	}
	let over = false;
	for (const resource of Object.keys(store || {})) {
		const max = maxAmountFor(model, store, resource);
		if (max !== null && (Number(store![resource]) || 0) > max) over = true;
	}
	if (unexpectedResources(model, store).length) over = true;
	return { used, capacity: unbounded ? null : capacity, over };
}

// Which resources may be ADDED to a FREE store right now.
export function addableResources(
	model: StoreModel,
	store: Record<string, number> | undefined,
	everyResource: string[],
): string[] {
	if (model.kind !== 'free') return [];
	const present = new Set(Object.keys(store || {}));
	return everyResource.filter((resource) => !present.has(resource));
}

// A lab holding a mineral needs its storeCapacityResource spelled out on the
// map: the loader's own default for a lab is `{ energy: 2000 }` only, so a lab
// loaded with a mineral would have NO capacity for it in the sim. Same story
// for a high-RCL extension, whose loader default is a flat 50.
export function explicitCapacityFor(object: StoreObjectLike, rcl: number): Record<string, number> | null {
	if (object.type === 'lab') {
		const store = object.store || {};
		const mineral = Object.keys(store).find((resource) => resource !== 'energy');
		if (!mineral) return null;
		return { energy: LAB_ENERGY_CAPACITY, [mineral]: LAB_MINERAL_CAPACITY };
	}
	if (object.type === 'extension' && extensionNeedsExplicitCapacity(rcl)) {
		return { energy: extensionCapacity(rcl) };
	}
	return null;
}

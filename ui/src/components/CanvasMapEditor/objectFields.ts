// Which properties the panel offers for a given object, and as which control.
//
// The panel renders these generically, so adding a field to a structure type is
// a one-line change here rather than a new branch in JSX. Anything NOT listed
// still shows in the panel's raw "Advanced" block, so no field is ever hidden —
// the schema decides what gets a nice control, not what is editable.

import { mineralTypes, allResources } from './gameData';
import type { EditableObject } from './mapModel';

export type Field =
	| { kind: 'text'; key: string; label: string; hint?: string; placeholder?: string }
	| { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; hint?: string; suffix?: string }
	| { kind: 'slider'; key: string; label: string; min: number; max: number; step?: number; hint?: string }
	| { kind: 'select'; key: string; label: string; options: Array<{ value: string; label: string }>; hint?: string }
	| { kind: 'toggle'; key: string; label: string; hint?: string }
	// A relative clock that the loader turns into an absolute deadline via
	// `ticks: { <field>: n }` (src/dojoWorld.js applyClocks).
	| { kind: 'ticks'; key: string; label: string; hint?: string }
	| { kind: 'position'; key: string; label: string; hint?: string };

export interface FieldContext {
	mods?: string[];
	rcl: number;
}

const options = (values: readonly (string | number)[], labels?: Record<string, string>) =>
	values.map((value) => ({ value: String(value), label: labels?.[String(value)] ?? String(value) }));

// Structures a construction site can be building.
const BUILDABLE = [
	'spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab', 'factory',
	'nuker', 'powerSpawn', 'observer', 'extractor', 'container', 'road', 'rampart', 'constructedWall',
];

const DEPOSIT_TYPES = ['silicon', 'metal', 'biomass', 'mist'];

// Structures the engine stores a `notifyWhenAttacked` flag on.
const NOTIFIABLE = new Set([
	'spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab', 'factory',
	'nuker', 'powerSpawn', 'observer', 'extractor', 'container', 'road', 'rampart',
	'constructedWall',
]);

// COLOR_* constants.
export const FLAG_COLORS: Array<{ value: number; label: string; css: string }> = [
	{ value: 1, label: 'red', css: '#ff0000' },
	{ value: 2, label: 'purple', css: '#ff00ff' },
	{ value: 3, label: 'blue', css: '#0000ff' },
	{ value: 4, label: 'cyan', css: '#00ffff' },
	{ value: 5, label: 'green', css: '#00ff00' },
	{ value: 6, label: 'yellow', css: '#ffff00' },
	{ value: 7, label: 'orange', css: '#ff8000' },
	{ value: 8, label: 'brown', css: '#804000' },
	{ value: 9, label: 'grey', css: '#808080' },
	{ value: 10, label: 'white', css: '#ffffff' },
];

export function fieldsFor(object: EditableObject, context: FieldContext): Field[] {
	const fields: Field[] = [];
	switch (object.type) {
		case 'controller':
			fields.push({ kind: 'slider', key: 'level', label: 'level (RCL)', min: 0, max: 8,
				hint: 'Unclaimed is 0.' });
			fields.push({ kind: 'number', key: 'progress', label: 'progress', min: 0 });
			break;

		case 'source': {
			const capacity = Number(object.energyCapacity) || 3000;
			fields.push({ kind: 'number', key: 'energyCapacity', label: 'energy capacity', min: 0, step: 500 });
			fields.push({ kind: 'slider', key: 'energy', label: 'energy', min: 0, max: capacity });
			fields.push({ kind: 'ticks', key: 'ticksToRegeneration', label: 'regenerates in' });
			break;
		}

		case 'mineral':
			fields.push({ kind: 'select', key: 'mineralType', label: 'mineral', options: options(mineralTypes(context.mods)) });
			fields.push({ kind: 'select', key: 'density', label: 'density',
				options: options([1, 2, 3, 4], { 1: '1 — low', 2: '2 — moderate', 3: '3 — high', 4: '4 — ultra' }) });
			fields.push({ kind: 'number', key: 'mineralAmount', label: 'amount left', min: 0, step: 1000 });
			break;

		case 'deposit':
			fields.push({ kind: 'select', key: 'depositType', label: 'deposit type', options: options(DEPOSIT_TYPES) });
			fields.push({ kind: 'number', key: 'cooldown', label: 'harvest cooldown', min: 0, suffix: 'ticks' });
			fields.push({ kind: 'ticks', key: 'decayTime', label: 'decays in' });
			break;

		case 'powerBank':
			fields.push({ kind: 'ticks', key: 'decayTime', label: 'decays in' });
			break;

		case 'spawn':
			fields.push({ kind: 'text', key: 'name', label: 'name',
				hint: 'The bot owns Spawn1.' });
			break;

		case 'lab':
			fields.push({ kind: 'number', key: 'cooldown', label: 'cooldown', min: 0, suffix: 'ticks' });
			break;

		case 'factory':
			fields.push({ kind: 'slider', key: 'level', label: 'level', min: 0, max: 5,
				hint: '0 = basic commodities only.' });
			fields.push({ kind: 'number', key: 'cooldown', label: 'cooldown', min: 0, suffix: 'ticks' });
			break;

		case 'link':
		case 'nuker':
		case 'powerSpawn':
		case 'observer':
		case 'extractor':
			fields.push({ kind: 'number', key: 'cooldown', label: 'cooldown', min: 0, suffix: 'ticks' });
			break;

		case 'keeperLair':
			fields.push({ kind: 'ticks', key: 'nextSpawnTime', label: 'next keeper in',
				hint: 'Blank = 5 ticks after load.' });
			break;

		case 'invaderCore':
			fields.push({ kind: 'slider', key: 'level', label: 'stronghold level', min: 0, max: 5 });
			fields.push({ kind: 'ticks', key: 'deployTime', label: 'deploys in' });
			fields.push({ kind: 'ticks', key: 'nextExpandTime', label: 'expands in' });
			break;

		case 'road':
		case 'container':
		case 'rampart':
			fields.push({ kind: 'ticks', key: 'decayTime', label: 'decays in',
				hint: 'Blank = a full lifetime.' });
			break;

		case 'constructionSite':
			fields.push({ kind: 'select', key: 'structureType', label: 'building', options: options(BUILDABLE) });
			fields.push({ kind: 'number', key: 'progressTotal', label: 'total work', min: 1 });
			fields.push({ kind: 'slider', key: 'progress', label: 'progress', min: 0,
				max: Math.max(1, Number(object.progressTotal) || 1) });
			break;

		case 'energy':
			fields.push({ kind: 'select', key: 'resourceType', label: 'resource', options: options(allResources(context.mods)) });
			fields.push({ kind: 'number', key: 'amount', label: 'amount', min: 1 });
			break;

		case 'tombstone':
			fields.push({ kind: 'text', key: 'creepName', label: 'creep name' });
			fields.push({ kind: 'ticks', key: 'decayTime', label: 'decays in' });
			break;

		case 'ruin':
			fields.push({ kind: 'select', key: 'structureType', label: 'was a', options: options(BUILDABLE) });
			fields.push({ kind: 'ticks', key: 'decayTime', label: 'decays in' });
			break;

		case 'portal':
			fields.push({ kind: 'position', key: 'destination', label: 'destination' });
			fields.push({ kind: 'ticks', key: 'decayTime', label: 'decays in',
				hint: 'Blank = permanent.' });
			break;

		case 'creep':
			fields.push({ kind: 'text', key: 'name', label: 'name',
				hint: 'Must be unique world-wide.' });
			fields.push({ kind: 'number', key: 'ticksToLive', label: 'ticks to live', min: 1,
				hint: 'Blank = a full lifetime.' });
			fields.push({ kind: 'number', key: 'fatigue', label: 'fatigue', min: 0 });
			break;

		case 'reactor':
			fields.push({ kind: 'number', key: 'cooldown', label: 'cooldown', min: 0, suffix: 'ticks' });
			break;

		default:
			break;
	}

	// Only a damageable, owned-or-neutral STRUCTURE carries this flag; a source,
	// a dropped pile or a portal has nothing to notify about.
	if (NOTIFIABLE.has(object.type)) {
		fields.push({ kind: 'toggle', key: 'notifyWhenAttacked', label: 'notify when attacked' });
	}
	return fields;
}

// Fields the panel renders itself (position, owner, hits, store, body) plus the
// ones above — everything else drops into the Advanced raw block.
export function handledKeys(object: EditableObject, context: FieldContext): Set<string> {
	const handled = new Set(['type', 'x', 'y', 'owner', 'store', 'body', 'boosts', 'hits', 'hitsMax', 'id', 'ticks']);
	for (const field of fieldsFor(object, context)) handled.add(field.key);
	return handled;
}

// A `ticks: { field: n }` value, or undefined when this object has no such
// clock pending. The loader consumes the whole `ticks` object.
export function ticksValue(object: EditableObject, key: string): number | undefined {
	// The dojo also accepts the two shorthand clocks directly on the object.
	if (key === 'decayTime' && typeof object.ticksToDecay === 'number') return object.ticksToDecay;
	if (key === 'ticksToRegeneration' && typeof object.ticksToRegeneration === 'number') return object.ticksToRegeneration;
	const ticks = object.ticks as Record<string, unknown> | undefined;
	const value = ticks && typeof ticks === 'object' ? ticks[key] : undefined;
	return typeof value === 'number' ? value : undefined;
}

export function withTicks(object: EditableObject, key: string, value: number | null): EditableObject {
	const next = { ...object };
	// `ticksToDecay` / `ticksToRegeneration` are the loader's own shorthand and
	// are written in preference to the generic bag, because applyClocks reads
	// them directly and an import already uses them.
	if (key === 'decayTime' || key === 'ticksToRegeneration') {
		const shorthand = key === 'decayTime' ? 'ticksToDecay' : 'ticksToRegeneration';
		if (value === null) delete next[shorthand];
		else next[shorthand] = value;
		const ticks = { ...(next.ticks as Record<string, unknown> | undefined) };
		delete ticks[key];
		if (Object.keys(ticks).length) next.ticks = ticks; else delete next.ticks;
		return next;
	}
	const ticks = { ...(next.ticks as Record<string, unknown> | undefined) };
	if (value === null) delete ticks[key];
	else ticks[key] = value;
	if (Object.keys(ticks).length) next.ticks = ticks; else delete next.ticks;
	return next;
}

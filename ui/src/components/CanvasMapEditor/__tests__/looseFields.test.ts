import { describe, expect, it } from 'vitest';
import { fieldsFor, ticksValue } from '../objectFields';
import { makeEditableObject, parseEditableMap, serializeEditableMap } from '../mapModel';

const terrain = Array.from({ length: 50 }, () => '.'.repeat(50));
const keysOf = (object: Record<string, unknown>) => fieldsFor(object as never, { rcl: 8 }).map((f) => f.key);

// The panel must edit the fields the engine reads — and the ones an import writes.
describe('deposit fields', () => {
	it('edit cooldownTime (a clock) and harvested, never a bare cooldown', () => {
		expect(keysOf({ type: 'deposit', x: 1, y: 1 })).toEqual(['depositType', 'cooldownTime', 'harvested', 'decayTime']);
		expect(makeEditableObject('deposit', 1, 1).cooldown).toBeUndefined();
	});

	it('read an imported deposit\'s clocks', () => {
		const imported = { type: 'deposit', x: 5, y: 5, depositType: 'mist', harvested: 1200, ticks: { cooldownTime: 30 }, ticksToDecay: 49000 };
		expect(ticksValue(imported, 'cooldownTime')).toBe(30);
		expect(ticksValue(imported, 'decayTime')).toBe(49000);
	});

	it('move an old editor cooldown onto the clock', () => {
		const parsed = parseEditableMap({ room: 'W1N1', terrain, structures: [{ type: 'deposit', x: 1, y: 1, depositType: 'silicon', cooldown: 25 }] });
		const deposit = parsed.map!.structures[0];
		expect(deposit.cooldown).toBeUndefined();
		expect(ticksValue(deposit, 'cooldownTime')).toBe(25);
	});
});

describe('imported nuke', () => {
	it('shows its landing clock and origin, and survives a round trip', () => {
		const nuke = { type: 'nuke', x: 20, y: 20, id: 'n', launchRoomName: 'E20S20', ticks: { landTime: 49000 } };
		expect(keysOf(nuke)).toEqual(['launchRoomName', 'landTime']);
		expect(ticksValue(nuke, 'landTime')).toBe(49000);
		const parsed = parseEditableMap({ room: 'W1N1', terrain, structures: [nuke] });
		expect(JSON.parse(serializeEditableMap(parsed.map!)).structures[0]).toEqual(nuke);
	});
});

describe('imported tombstone and construction site', () => {
	it('round-trip unchanged', () => {
		const tombstone = {
			type: 'tombstone', x: 7, y: 35, id: 't', owner: 'me', creepId: 'c', creepName: 'E27S23_lamb',
			creepTicksToLive: 1499, creepBody: ['work'], ticks: { deathTime: -12 }, ticksToDecay: 3, store: { energy: 299 },
		};
		const site = { type: 'constructionSite', x: 32, y: 45, id: 's', owner: 'p1', structureType: 'road', progress: 0, progressTotal: 300 };
		const parsed = parseEditableMap({ room: 'W1N1', terrain, structures: [tombstone, site] });
		expect(JSON.parse(serializeEditableMap(parsed.map!)).structures).toEqual([tombstone, site]);
		expect(ticksValue(tombstone, 'decayTime')).toBe(3);
	});
});

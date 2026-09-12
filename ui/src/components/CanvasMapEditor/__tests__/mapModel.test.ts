import { describe, expect, it } from 'vitest';
import { makeEditableObject, parseEditableMap, serializeEditableMap } from '../mapModel';

const terrain = Array.from({ length: 50 }, () => '.'.repeat(50));

describe('canvas map editor model', () => {
  it('folds canonical top-level objects into the editable model and restores them', () => {
    const input = {
      room: 'W1N1', terrain, structures: [{ type: 'spawn', x: 10, y: 10, owner: 'me', hits: 5000 }],
      sources: [{ x: 20, y: 20, id: 'a'.repeat(24), energy: 1500 }],
      minerals: [{ x: 30, y: 30, id: 'b'.repeat(24), mineralType: 'O', density: 2 }],
      controller: { x: 25, y: 25 }, flags: [{ name: 'target', x: 40, y: 40 }], creeps: [{ name: 'kept' }],
    };
    const parsed = parseEditableMap(JSON.stringify(input));
    expect(parsed.error).toBeNull();
    expect(parsed.map!.structures.map((object) => object.type)).toEqual(['spawn', 'source', 'mineral', 'controller']);
    const output = JSON.parse(serializeEditableMap(parsed.map!));
    expect(output.structures[0]).toMatchObject({ type: 'spawn', hits: 5000 });
    expect(output.sources[0]).toMatchObject({ id: 'a'.repeat(24), energy: 1500 });
    expect(output.minerals[0]).toMatchObject({ mineralType: 'O', density: 2 });
    expect(output.creeps).toEqual([{ name: 'kept' }]);
  });

  it('repairs missing source and mineral ids without changing unrelated metadata', () => {
    const parsed = parseEditableMap({ room: 'W1N1', terrain, structures: [], sources: [{ x: 1, y: 2 }], minerals: [{ x: 3, y: 4 }] });
    const output = JSON.parse(serializeEditableMap(parsed.map!));
    expect(output.sources[0].id).toMatch(/^[a-f0-9]{24}$/);
    expect(output.minerals[0].id).toMatch(/^[a-f0-9]{24}$/);
  });

  // A power bank's power lives in its store, and the engine reads it as
  // `store.power` — an editor-placed one without it crashes any bot creep that
  // inspects the bank, so the default has to carry a real haul.
  it('gives a new power bank a store the engine can read', () => {
    const bank = makeEditableObject('powerBank', 12, 13);
    expect(bank).toMatchObject({ type: 'powerBank', x: 12, y: 13, store: { power: 5000 } });
    expect(bank.owner).toBeUndefined();
  });

  it('round-trips a power bank store through parse and serialize', () => {
    const parsed = parseEditableMap({
      room: 'W1N1', terrain,
      structures: [{ type: 'powerBank', x: 36, y: 26, store: { power: 8727 }, ticksToDecay: 232 }],
    });
    const output = JSON.parse(serializeEditableMap(parsed.map!));
    expect(output.structures[0]).toEqual({ type: 'powerBank', x: 36, y: 26, ticksToDecay: 232, store: { power: 8727 } });
  });

  it('rejects malformed terrain without producing a partial model', () => {
    const parsed = parseEditableMap({ room: 'W1N1', terrain: ['.'], structures: [] });
    expect(parsed.map).toBeNull();
    expect(parsed.error).toMatch(/50 rows/);
  });
});

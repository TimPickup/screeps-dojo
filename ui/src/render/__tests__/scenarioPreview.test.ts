import { describe, expect, it } from 'vitest';
import type { ScenarioMapFile } from '../../api/types';
import { buildScenarioPreviewScene } from '../scenarioPreview';

const terrain = (fill = '.') => Array.from({ length: 50 }, () => fill.repeat(50));
const file = (path: string, room: string, extra: Record<string, unknown> = {}): ScenarioMapFile => ({
  path,
  map: { room, terrain: terrain(), structures: [], ...extra },
});

describe('buildScenarioPreviewScene', () => {
  it('combines rooms using Screeps world coordinates', () => {
    const scene = buildScenarioPreviewScene([file('map.W0N1.json', 'W0N1'), file('map.W1N1.json', 'W1N1')]);
    expect(scene).not.toBeNull();
    expect(scene!.layout.rooms).toEqual(['W0N1', 'W1N1']);
    expect(scene!.layout.offsets.W1N1).toEqual({ col: 0, row: 0 });
    expect(scene!.layout.offsets.W0N1).toEqual({ col: 1, row: 0 });
    expect(scene!.layout.width).toBe(1200);
  });

  it('normalizes legacy and top-level map objects into a replay frame', () => {
    const scene = buildScenarioPreviewScene([file('map.W1N1.json', 'W1N1', {
      structures: [{ type: 'spawn', x: 10, y: 11, owner: 'me' }],
      sources: [{ x: 20, y: 21 }],
      minerals: [{ x: 30, y: 31, mineralType: 'H' }],
      controller: { x: 25, y: 25, level: 2 },
      flags: [{ name: 'target', x: 40, y: 41 }],
    })]);
    expect(scene!.frame.objects.map((object) => object.type)).toEqual(['spawn', 'source', 'mineral', 'controller']);
    expect(scene!.frame.objects[0].user).toBe('me');
    expect(scene!.frame.objects[1]).toMatchObject({ energy: 3000, energyCapacity: 3000 });
    expect(scene!.frame.flags).toEqual([{ room: 'W1N1', name: 'target', x: 40, y: 41 }]);
  });

  it('uses one deterministic map for duplicate room coordinates and reports the duplicate', () => {
    const first = file('map.a.json', 'E1S1');
    const second = file('map.b.json', 'E1S1', { structures: [{ type: 'tower', x: 5, y: 6 }] });
    const scene = buildScenarioPreviewScene([first, second]);
    expect(scene!.duplicateRooms).toEqual(['E1S1']);
    expect(scene!.frame.objects).toHaveLength(1);
    expect(scene!.frame.objects[0].type).toBe('tower');
  });

  it('skips malformed maps and returns null when none are renderable', () => {
    const invalid: ScenarioMapFile = { path: 'map.bad.json', map: { room: 'not-a-room', terrain: [] } };
    expect(buildScenarioPreviewScene([invalid])).toBeNull();
  });
});

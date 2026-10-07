import { describe, expect, it } from 'vitest';
import { fieldsFor } from '../objectFields';
import { makeEditableObject, structureLayer } from '../mapModel';
import { PLACEABLES } from '../gameData';
import { sliderToTicks, ticksToSlider } from '../controls';

describe('placing a nuke', () => {
  it('is a room feature that shares its tile, launched from another room, 50,000 ticks out', () => {
    expect(PLACEABLES.find((p) => p.type === 'nuke')?.group).toBe('natural');
    expect(structureLayer('nuke')).toBe('loose');
    const nuke = makeEditableObject('nuke', 35, 20, { launchRoom: 'W1N1' });
    expect(nuke.launchRoomName).toBe('W1N1');
    expect(nuke.ticks).toEqual({ landTime: 50000 });
  });

  it('offers the scenario rooms, with "other" for any room outside them', () => {
    const field = fieldsFor({ type: 'nuke', x: 1, y: 1, launchRoomName: 'E5S5' }, { rcl: 0, rooms: ['W0N1', 'W1N1'] })
      .find((f) => f.key === 'launchRoomName');
    expect(field && field.kind === 'select' ? field.options.map((o) => o.value) : []).toEqual(['W0N1', 'W1N1']);
    expect(field && field.kind === 'select' && field.custom).toBeTruthy();
  });
});

describe('ticks slider', () => {
  it('maps both ends and round-trips sensibly on a log scale', () => {
    expect(sliderToTicks(0, 50000)).toBe(1);
    expect(sliderToTicks(1000, 50000)).toBe(50000);
    expect(sliderToTicks(ticksToSlider(100, 50000), 50000)).toBe(100);
    expect(ticksToSlider(50000, 50000)).toBe(1000);
  });
});

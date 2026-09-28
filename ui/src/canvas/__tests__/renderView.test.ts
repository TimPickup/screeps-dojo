import { describe, expect, it } from 'vitest';
import type { StageLayout } from '../../api/types';
import { detailLevel, lodLevels, pickLod, viewFromTransform, visibleRooms } from '../renderView';

const layout = { offsets: { A: { col: 0, row: 0 }, B: { col: 1, row: 0 }, C: { col: 0, row: 1 } } } as unknown as StageLayout;

describe('render view', () => {
  it('maps the canvas back to world tiles', () => {
    // CSS scale 2 px/tile, dpr 1.5 → 3 device px/tile; translated 10 css px right
    const v = viewFromTransform(300, 150, 2, 10, 0, 1.5);
    expect(v.pixelsPerTile).toBe(3);
    expect(v.minX).toBeCloseTo(-5);          // (0 - 10*1.5) / 3
    expect(v.maxX).toBeCloseTo(95);          // (300 - 15) / 3
    expect(v.minY).toBeCloseTo(0);
    expect(v.maxY).toBeCloseTo(50);
  });
  it('lists only rooms that overlap the view', () => {
    expect([...visibleRooms(layout, { minX: 10, minY: 10, maxX: 40, maxY: 40, pixelsPerTile: 20 })]).toEqual(['A']);
    expect(visibleRooms(layout, { minX: 49, minY: 49, maxX: 51, maxY: 51, pixelsPerTile: 20 }).size).toBe(3);
    expect(visibleRooms(layout, undefined).size).toBe(3);
  });
  it('halves LOD levels down to one pixel per tile', () => {
    expect(lodLevels(24)).toEqual([24, 12, 6, 3, 1.5]);
    expect(lodLevels(2)).toEqual([2, 1]);
  });
  it('picks the smallest sharp level', () => {
    const levels = lodLevels(24);
    expect(pickLod(levels, 0.4)).toBe(1.5);
    expect(pickLod(levels, 5)).toBe(6);
    expect(pickLod(levels, 6)).toBe(6);
    expect(pickLod(levels, 80)).toBe(24);
  });
  it('drops detail as zoom falls', () => {
    const at = (p: number) => detailLevel({ minX: 0, minY: 0, maxX: 1, maxY: 1, pixelsPerTile: p });
    expect(at(8)).toBe('full'); expect(at(7.9)).toBe('simple'); expect(at(3)).toBe('simple'); expect(at(2.9)).toBe('minimal');
    expect(detailLevel(undefined)).toBe('full');
  });
});

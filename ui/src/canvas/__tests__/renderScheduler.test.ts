import { describe, expect, it } from 'vitest';
import { needsRedraw, shouldAnimate, type DrawState } from '../renderScheduler';

const base: DrawState = {
  layers: {}, recording: {}, frameCount: 10, tick: 3, sub: null, scale: 1, tx: 0, ty: 0, dpr: 1, width: 800, height: 600, resizeEpoch: 0,
  selectedId: null, showVisuals: true, showMapVisuals: false, smoothTurns: true, modImages: null, powerImages: null, layersVersion: 1,
};

describe('render scheduler', () => {
  it('interpolates while playing unless the map is zoomed right out', () => {
    expect(shouldAnimate('full', true)).toBe(true);
    expect(shouldAnimate('simple', true)).toBe(true);
    expect(shouldAnimate('minimal', true)).toBe(false);
    expect(shouldAnimate('full', false)).toBe(false);
  });
  it('skips identical frames and redraws on any change', () => {
    expect(needsRedraw(null, base)).toBe(true);
    expect(needsRedraw(base, { ...base })).toBe(false);
    const changes: Partial<DrawState>[] = [
      { tick: 4 }, { sub: 0.5 }, { tx: 1 }, { dpr: 2 }, { layersVersion: 2 }, { frameCount: 11 }, { recording: {} },
      { layers: {} }, { width: 801 }, { resizeEpoch: 1 }, { selectedId: 'x' }, { smoothTurns: false }, { modImages: {} }, { powerImages: {} },
    ];
    for (const change of changes) expect(needsRedraw(base, { ...base, ...change })).toBe(true);
  });
  it('also redraws on the fields the brief list leaves implicit', () => {
    const changes: Partial<DrawState>[] = [
      { scale: 2 }, { ty: 1 }, { height: 601 }, { showVisuals: false }, { showMapVisuals: true }, { sub: 0 },
    ];
    for (const change of changes) expect(needsRedraw(base, { ...base, ...change })).toBe(true);
  });
});

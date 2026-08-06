import { describe, expect, it } from 'vitest';
import type { StageLayout } from '../../api/types';
import { SWAMP_RENDER_STYLE } from '../renderConstants';
import { AnimatedSwampRenderer, buildSwampIslands, drawSwampIslands } from '../terrainSwamps';
import { mockCtx } from './mockCtx';

function terrainWithSwamps(swamps: Array<[number, number]>): string[] {
  const rows = Array.from({ length: 50 }, () => '.'.repeat(50));
  for (const [x, y] of swamps) {
    rows[y] = `${rows[y].slice(0, x)}~${rows[y].slice(x + 1)}`;
  }
  return rows;
}

function mockPath(): Path2D {
  return {
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
  } as unknown as Path2D;
}

describe('terrain swamp islands', () => {
  it('uses the same cardinal island rules as terrain walls', () => {
    expect(buildSwampIslands(terrainWithSwamps([[5, 5], [6, 5], [6, 6]]))).toHaveLength(1);
    expect(buildSwampIslands(terrainWithSwamps([[5, 5], [6, 6]]))).toHaveLength(2);
  });

  it('draws the configured static texture repeat and adds one outline', () => {
    const { ctx, log } = mockCtx();
    drawSwampIslands(ctx, terrainWithSwamps([[5, 5], [6, 5]]), {} as CanvasImageSource);
    expect(log.filter((call) => call.op === 'drawImage')).toHaveLength(
      SWAMP_RENDER_STYLE.textureRepeatsPerRoom ** 2,
    );
    expect(log.filter((call) => call.op === 'stroke')).toHaveLength(1);
  });

  it('caches two patterns and translates both through the cached swamp path', () => {
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const texture = { width: 256, height: 256 } as unknown as CanvasImageSource;
    const renderer = new AnimatedSwampRenderer(
      { W0N0: terrainWithSwamps([[5, 5], [6, 5]]) },
      layout,
      [texture, texture],
      mockPath,
    );
    const { ctx, log } = mockCtx();
    renderer.draw(ctx, 1.5);
    renderer.draw(ctx, 2.5);
    expect(log.filter((call) => call.op === 'createPattern')).toHaveLength(2);
    expect(log.filter((call) => call.op === 'pattern.setTransform')).toHaveLength(4);
    expect(log.filter((call) => call.op === 'fill' && call.args.length === 1)).toHaveLength(4);
  });
});

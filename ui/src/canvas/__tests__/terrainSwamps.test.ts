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
    expect(log.filter((call) => call.op === 'clip')).toHaveLength(0);     // no walls, nothing to cut out
  });

  it('cuts the room walls out of the animated texture, following constructed walls', () => {
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const texture = { width: 256, height: 256 } as unknown as CanvasImageSource;
    const paths: Array<Array<[string, ...number[]]>> = [];
    const recordingPath = () => {
      const calls: Array<[string, ...number[]]> = [];
      paths.push(calls);
      const record = (op: string) => (...args: number[]) => { calls.push([op, ...args]); };
      return {
        moveTo: record('moveTo'), lineTo: record('lineTo'), quadraticCurveTo: record('quadraticCurveTo'),
        closePath: record('closePath'), rect: record('rect'), calls,
      } as unknown as Path2D;
    };
    const renderer = new AnimatedSwampRenderer(
      { W0N0: terrainWithSwamps([[5, 5], [6, 5]]) },
      layout,
      [texture, texture],
      recordingPath,
    );
    renderer.setConstructedWalls('W0N0', [{ x: 5, y: 5 }]);   // a wall built on a swamp tile
    const { ctx, log } = mockCtx();
    renderer.draw(ctx, 1);
    const clips = log.filter((call) => call.op === 'clip');
    expect(clips).toHaveLength(1);
    expect(clips[0].args[1]).toBe('evenodd');
    const clipCalls = (clips[0].args[0] as unknown as { calls: Array<[string, ...number[]]> }).calls;
    expect(clipCalls[0]).toEqual(['rect', 0, 0, 50, 50]);
    const xs = clipCalls.slice(1).flatMap((c) => [c[1], c[3]].filter((v) => v !== undefined));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(5);        // the hole is the wall tile (5..6)
    expect(Math.max(...xs)).toBeLessThanOrEqual(6);

    renderer.setConstructedWalls('W0N0', []);                 // wall destroyed: no hole left
    const after = mockCtx();
    renderer.draw(after.ctx, 1);
    expect(after.log.filter((call) => call.op === 'clip')).toHaveLength(0);
  });
});

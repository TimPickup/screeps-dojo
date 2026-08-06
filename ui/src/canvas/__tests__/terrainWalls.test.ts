import { describe, expect, it } from 'vitest';
import { RENDER_COLORS, WALL_RENDER_STYLE } from '../renderConstants';
import { buildWallIslands, drawWallIslands } from '../terrainWalls';
import { mockCtx } from './mockCtx';

function terrainWithWalls(walls: Array<[number, number]>): string[] {
  const rows = Array.from({ length: 50 }, () => '.'.repeat(50));
  for (const [x, y] of walls) {
    rows[y] = `${rows[y].slice(0, x)}#${rows[y].slice(x + 1)}`;
  }
  return rows;
}

describe('terrain wall islands', () => {
  it('joins cardinal neighbours but leaves diagonal walls as separate islands', () => {
    expect(buildWallIslands(terrainWithWalls([[5, 5], [6, 5], [6, 6]]))).toHaveLength(1);
    expect(buildWallIslands(terrainWithWalls([[5, 5], [6, 6]]))).toHaveLength(2);
  });

  it('joins constructed walls to terrain walls using cardinal connectivity', () => {
    const terrain = terrainWithWalls([[5, 5]]);
    expect(buildWallIslands(terrain, [{ x: 6, y: 5 }])).toHaveLength(1);
    expect(buildWallIslands(terrain, [{ x: 6, y: 6 }])).toHaveLength(2);
  });

  it('builds connected islands made entirely from constructed walls', () => {
    const islands = buildWallIslands(terrainWithWalls([]), [
      { x: 10, y: 10 },
      { x: 10, y: 11 },
      { x: 11, y: 11 },
    ]);
    expect(islands).toHaveLength(1);
    expect(islands[0].contours).toHaveLength(1);
  });

  it('traces enclosed openings as holes in the same island', () => {
    const walls: Array<[number, number]> = [];
    for (let y = 10; y <= 12; y++) {
      for (let x = 10; x <= 12; x++) {
        if (x !== 11 || y !== 11) walls.push([x, y]);
      }
    }
    const islands = buildWallIslands(terrainWithWalls(walls));
    expect(islands).toHaveLength(1);
    expect(islands[0].contours).toHaveLength(2);
  });

  it('rounds internal corners and leaves corners on room edges square', () => {
    const interior = mockCtx();
    drawWallIslands(interior.ctx, terrainWithWalls([[5, 5]]));
    expect(interior.log.filter((call) => call.op === 'quadraticCurveTo')).not.toHaveLength(0);

    const fullRoom = mockCtx();
    drawWallIslands(fullRoom.ctx, Array.from({ length: 50 }, () => '#'.repeat(50)));
    expect(fullRoom.log.filter((call) => call.op === 'quadraticCurveTo')).toHaveLength(0);
  });

  it('draws the supplied texture once per room at the configured opacity', () => {
    const { ctx, log } = mockCtx();
    const texture = {} as CanvasImageSource;
    drawWallIslands(ctx, terrainWithWalls([[5, 5]]), texture);
    expect(log.filter((call) => call.op === 'drawImage')).toHaveLength(1);
    expect(log.some((call) => call.op === 'set:globalAlpha'
      && call.args[0] === WALL_RENDER_STYLE.textureOpacity)).toBe(true);
    expect(log.some((call) => call.op === 'set:globalCompositeOperation'
      && call.args[0] === 'source-over')).toBe(true);
  });

  it('draws the two constructed-wall marker lines at the requested thirds', () => {
    const { ctx, log } = mockCtx();
    drawWallIslands(ctx, terrainWithWalls([]), undefined, [{ x: 10, y: 20 }]);

    const nearlyEqual = (left: unknown, right: number) => typeof left === 'number'
      && Math.abs(left - right) < 1e-9;
    const hasSegment = (startX: number, y: number, endX: number) => {
      const startIndex = log.findIndex((call) => call.op === 'moveTo'
        && nearlyEqual(call.args[0], startX) && nearlyEqual(call.args[1], y));
      const end = log[startIndex + 1];
      return startIndex >= 0 && end?.op === 'lineTo'
        && nearlyEqual(end.args[0], endX) && nearlyEqual(end.args[1], y);
    };
    expect(hasSegment(10.3, 20 + 1 / 3, 10.6)).toBe(true);
    expect(hasSegment(10.4, 20 + 2 / 3, 10.7)).toBe(true);
    expect(log.some((call) => call.op === 'set:strokeStyle'
      && call.args[0] === RENDER_COLORS.terrain.constructedWallMarker)).toBe(true);
    expect(log.some((call) => call.op === 'set:lineWidth'
      && call.args[0] === WALL_RENDER_STYLE.constructedMarkerWidth)).toBe(true);
  });
});

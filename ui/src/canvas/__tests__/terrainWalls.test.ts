import { describe, expect, it } from 'vitest';
import { WALL_RENDER_STYLE } from '../renderConstants';
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
});

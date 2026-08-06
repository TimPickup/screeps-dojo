import { describe, expect, it } from 'vitest';
import type { Frame, FrameObject, StageLayout } from '../../api/types';
import { RAMPART_RENDER_STYLE, RENDER_COLORS } from '../renderConstants';
import { buildRampartIslands, drawRamparts, partitionRamparts } from '../ramparts';
import { mockCtx } from './mockCtx';

const layout = {
  width: 600,
  height: 600,
  pixelsPerRoom: 600,
  offsets: { W1N1: { col: 0, row: 0 } },
} as unknown as StageLayout;

function rampart(
  id: string,
  x: number,
  y: number,
  my: boolean,
  isPublic = false,
  user = my ? 'me' : 'enemy',
): FrameObject {
  return { _id: id, type: 'rampart', room: 'W1N1', x, y, my, isPublic, user };
}

function frameWith(objects: FrameObject[]): Frame {
  return { gameTime: 1, flags: [], objects };
}

describe('rampart rendering', () => {
  it('separates own, other, and public ramparts before island building', () => {
    const groups = partitionRamparts([
      rampart('own-a', 5, 5, true),
      rampart('own-b', 6, 5, true),
      rampart('other-a', 10, 10, false, false, 'enemy-a'),
      rampart('other-b', 11, 10, false, false, 'enemy-b'),
      rampart('own-public', 20, 20, true, true),
      rampart('other-public', 21, 20, false, true),
    ]);

    expect(buildRampartIslands(groups.ownPrivate)).toHaveLength(1);
    expect(buildRampartIslands(groups.otherPrivate)).toHaveLength(1);
    expect(groups.ownPublic).toEqual([{ x: 20, y: 20 }]);
    expect(groups.otherPublic).toEqual([{ x: 21, y: 20 }]);
  });

  it('draws private own and opponent islands with configured fills and outlines', () => {
    const { ctx, log } = mockCtx();
    drawRamparts(ctx, frameWith([
      rampart('own-a', 5, 5, true),
      rampart('own-b', 6, 5, true),
      rampart('other-a', 10, 10, false),
      rampart('other-b', 11, 10, false),
    ]), layout);

    expect(log.filter((call) => call.op === 'fill')).toHaveLength(2);
    expect(log.filter((call) => call.op === 'set:fillStyle').map((call) => call.args[0]))
      .toEqual([RENDER_COLORS.rampart.own, RENDER_COLORS.rampart.other]);
    expect(log.filter((call) => call.op === 'set:globalAlpha').map((call) => call.args[0]))
      .toEqual([
        RAMPART_RENDER_STYLE.fillOpacity,
        RAMPART_RENDER_STYLE.outlineOpacity,
        RAMPART_RENDER_STYLE.fillOpacity,
        RAMPART_RENDER_STYLE.outlineOpacity,
      ]);
    expect(log.some((call) => call.op === 'drawImage')).toBe(false);
  });

  it('draws a public rampart individually as a semi-transparent plus', () => {
    const { ctx, log } = mockCtx();
    drawRamparts(ctx, frameWith([rampart('public', 10, 20, true, true)]), layout);
    const markerHalfLength = RAMPART_RENDER_STYLE.publicMarkerLength / 2;

    expect(log.filter((call) => call.op === 'fill')).toHaveLength(0);
    expect(log.some((call) => call.op === 'moveTo'
      && call.args[0] === 10.5 - markerHalfLength && call.args[1] === 20.5)).toBe(true);
    expect(log.some((call) => call.op === 'lineTo'
      && call.args[0] === 10.5 + markerHalfLength && call.args[1] === 20.5)).toBe(true);
    expect(log.some((call) => call.op === 'moveTo'
      && call.args[0] === 10.5 && call.args[1] === 20.5 - markerHalfLength)).toBe(true);
    expect(log.some((call) => call.op === 'lineTo'
      && call.args[0] === 10.5 && call.args[1] === 20.5 + markerHalfLength)).toBe(true);
    expect(log.some((call) => call.op === 'set:globalAlpha'
      && call.args[0] === RAMPART_RENDER_STYLE.publicMarkerOpacity)).toBe(true);
  });
});

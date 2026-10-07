import { describe, expect, it } from 'vitest';
import type { Frame, FrameObject, StageLayout } from '../../api/types.ts';
import { computeStageLayout } from '../../render/geometry.ts';
import { drawNukeFlight, drawNukeImpact, drawNukerFill, frameNukes, nukeFlight, nukeLandTime, nukeLandedBy, nukeLandsAfter, roomWorldOrigin, NUKE_LAND_TIME } from '../nukes.ts';
import { mockCtx } from './mockCtx.ts';

const layout: StageLayout = computeStageLayout(['W1N1', 'W0N1']);
const nuke = (landTime: number): FrameObject =>
  ({ _id: 'n1', type: 'nuke', room: 'W0N1', x: 35, y: 20, landTime, launchRoomName: 'W1N1' } as unknown as FrameObject);
const nuker = (energy: number, G: number): FrameObject =>
  ({ _id: 'k', type: 'nuker', room: 'W1N1', x: 30, y: 20, store: { energy, G },
    storeCapacityResource: { energy: 300000, G: 5000 } } as unknown as FrameObject);

describe('roomWorldOrigin', () => {
  it('uses the layout for recorded rooms and map coordinates for the rest', () => {
    expect(roomWorldOrigin('W1N1', layout)).toEqual({ x: 0, y: 0 });
    expect(roomWorldOrigin('W0N1', layout)).toEqual({ x: 50, y: 0 });
    // three rooms west of W1N1, one north
    expect(roomWorldOrigin('W4N2', layout)).toEqual({ x: -150, y: -50 });
    expect(roomWorldOrigin('sim', layout)).toBeNull();
  });
});

describe('nukeFlight', () => {
  it('runs from the nuker to the landing tile over NUKE_LAND_TIME ticks', () => {
    const launched = nukeFlight(nuke(1000 + NUKE_LAND_TIME), nuker(0, 0), layout, 1000)!;
    expect(launched.progress).toBe(0);
    expect(launched.sx).toBeCloseTo(30.5);
    expect(launched.tx).toBeCloseTo(85.5);
    expect(launched.ty).toBeCloseTo(20.5);
    // the arc bows toward the top of the screen
    expect(launched.qy).toBeLessThan(Math.min(launched.sy, launched.ty));
    expect(nukeFlight(nuke(1100), undefined, layout, 1000)!.progress).toBeCloseTo(1 - 100 / NUKE_LAND_TIME);
  });
  it('starts from the launch room centre once the nuker is gone', () => {
    const flight = nukeFlight(nuke(5000), undefined, layout, 1000)!;
    expect([flight.sx, flight.sy]).toEqual([25, 25]);
  });
});

describe('nukeLandsAfter', () => {
  const next = (gameTime: number, ids: string[]) => ({
    frame: { gameTime, objects: [] } as unknown as Frame,
    ids: new Map(ids.map((id) => [id, {} as FrameObject])),
  });
  it('is the tick the nuke vanishes having reached its landTime', () => {
    const landed = next(1100, []);
    expect(nukeLandsAfter(nuke(1100), landed.frame, landed.ids)).toBe(true);
    const still = next(1100, ['n1']);
    expect(nukeLandsAfter(nuke(1100), still.frame, still.ids)).toBe(false);
    const removedEarly = next(1050, []);
    expect(nukeLandsAfter(nuke(1100), removedEarly.frame, removedEarly.ids)).toBe(false);
    expect(nukeLandsAfter(nuke(1100), undefined, null)).toBe(false);
  });
});

describe('drawing', () => {
  it('fills the nuker only with what it holds', () => {
    const empty = mockCtx(); drawNukerFill(empty.ctx, nuker(0, 0), 0.5, 0.5);
    const full = mockCtx(); drawNukerFill(full.ctx, nuker(300000, 5000), 0.5, 0.5);
    expect(empty.log.length).toBe(0);
    expect(full.log.some((c) => c.op === 'fillRect')).toBe(true);
    expect(full.log.some((c) => c.op === 'fill')).toBe(true);
  });
  it('draws a flight and an impact', () => {
    const flight = mockCtx();
    drawNukeFlight(flight.ctx, nukeFlight(nuke(30000), nuker(0, 0), layout, 1000)!, 1000, 12);
    expect(flight.log.some((c) => c.op === 'quadraticCurveTo')).toBe(true);
    const impact = mockCtx();
    drawNukeImpact(impact.ctx, 85.5, 20.5, 50, 0, 0.1, 12, 'n1');
    expect(impact.log.some((c) => c.op === 'createRadialGradient')).toBe(true);
    expect(impact.log.filter((c) => c.op === 'clip').length).toBe(2);
  });
});

describe('nukeLandTime', () => {
  it('reads an absolute landTime, or a map\'s relative ticks.landTime', () => {
    expect(nukeLandTime(nuke(1100), 0)).toBe(1100);
    const fromMap = { _id: 'm', type: 'nuke', room: 'W0N1', x: 1, y: 1, ticks: { landTime: 100 } } as unknown as FrameObject;
    expect(nukeLandTime(fromMap, 0)).toBe(100);
    expect(nukeFlight({ ...fromMap, launchRoomName: 'W1N1' } as FrameObject, undefined, layout, 0)!.progress)
      .toBeCloseTo(1 - 100 / NUKE_LAND_TIME);
  });
});

describe('nukeLandedBy (the live view, with no next frame)', () => {
  it('is the first frame without the nuke, at or past its landTime', () => {
    const frame = { gameTime: 1100, objects: [] } as unknown as Frame;
    expect(nukeLandedBy(nuke(1100), frame, new Map())).toBe(true);
    expect(nukeLandedBy(nuke(1100), frame, new Map([['n1', {} as FrameObject]]))).toBe(false);
    expect(nukeLandedBy(nuke(1200), frame, new Map())).toBe(false);
  });
});

describe('frameNukes', () => {
  it('finds nukes and nukers once per frame', () => {
    const frame = { gameTime: 0, objects: [nuke(10), nuker(0, 0)] } as unknown as Frame;
    const first = frameNukes(frame);
    expect(first.nukes.length).toBe(1);
    expect(first.nukers.get('W1N1')?._id).toBe('k');
    expect(frameNukes(frame)).toBe(first);
  });
});

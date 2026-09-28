// ui/src/canvas/__tests__/drawFrame.lod.test.ts
import { describe, expect, it } from 'vitest';
import type { Recording, StageLayout } from '../../api/types';
import { drawFrame } from '../drawFrame';
import { fillCreepDots } from '../creeps';
import { RENDER_COLORS } from '../renderConstants';
import { fakeLayers, mockCtx } from './mockCtx';

const layout = { rooms: ['A', 'B'], offsets: { A: { col: 0, row: 0 }, B: { col: 1, row: 0 } }, pixelsPerRoom: 600, width: 1200, height: 600 } as StageLayout;
const recording = {
  meta: { botUserId: 'me' }, terrain: { A: [], B: [] },
  frames: [{ gameTime: 1, flags: [], objects: [
    { _id: 'c1', type: 'creep', room: 'A', x: 10, y: 10, user: 'me', body: [{ type: 'move', hits: 100 }], hits: 50, hitsMax: 100 },
    { _id: 'c2', type: 'creep', room: 'B', x: 10, y: 10, user: 'x', body: [], hits: 50, hitsMax: 100 },
    { _id: 'e', type: 'extension', room: 'A', x: 3, y: 3, store: { energy: 50 }, storeCapacityResource: { energy: 50 } },
  ] }],
} as unknown as Recording;
const layers = fakeLayers();
function run(pixelsPerTile: number, maxX = 100) {
  const drawn: string[] = [];
  const sprites = { draw: (_c: unknown, o: { _id: string }) => drawn.push(o._id) };
  const { ctx, log } = mockCtx();
  drawFrame(ctx, recording, 0, null, { sprites: sprites as never, layers: layers as never, layout, showVisuals: true,
    view: { minX: 0, minY: 0, maxX, maxY: 50, pixelsPerTile } });
  return { drawn, log };
}

describe('drawFrame level of detail', () => {
  it('draws full creeps only when on or near the screen', () => {
    expect(run(20, 40).drawn).toEqual(['c1']);            // c2 at world x 60 is beyond 40 + 2
  });
  it('draws creeps as dots below full detail', () => {
    const { drawn, log } = run(4);
    expect(drawn).toEqual([]);
    expect(log.filter((c) => c.op === 'arc').length).toBeGreaterThanOrEqual(2);
  });
  it('skips structure fills at minimal detail', () => {
    const simple = run(4).log.length;
    const minimal = run(1).log.length;
    expect(minimal).toBeLessThan(simple);
  });

  // A creep moving from x 43 (off screen: beyond 40 + 2) to x 41 (on screen).
  const moving = {
    meta: { botUserId: 'me' }, terrain: { A: [] },
    frames: [
      { gameTime: 1, flags: [], objects: [{ _id: 'm', type: 'creep', room: 'A', x: 43, y: 10, user: 'me', body: [] }] },
      { gameTime: 2, flags: [], objects: [{ _id: 'm', type: 'creep', room: 'A', x: 41, y: 10, user: 'me', body: [] }] },
    ],
  } as unknown as Recording;
  const oneRoom = { rooms: ['A'], offsets: { A: { col: 0, row: 0 } }, pixelsPerRoom: 600, width: 600, height: 600 } as StageLayout;
  function runMoving(subFrame: number | null, pixelsPerTile: number) {
    const drawn: Array<{ id: string; x: number }> = [];
    const sprites = { draw: (_c: unknown, o: { _id: string }, x: number) => drawn.push({ id: o._id, x }) };
    const { ctx, log } = mockCtx();
    drawFrame(ctx, moving, 0, subFrame, { sprites: sprites as never, layers: layers as never, layout: oneRoom, showVisuals: false,
      view: { minX: 0, minY: 0, maxX: 40, maxY: 50, pixelsPerTile } });
    return { drawn, arcs: log.filter((c) => c.op === 'arc') };
  }

  it('draws a creep whose next position is on screen though its base position is just off it', () => {
    expect(runMoving(0.5, 20).drawn.map((d) => d.id)).toEqual(['m']);
  });
  it('skips that creep when paused, since only its base position counts', () => {
    expect(runMoving(null, 20).drawn).toEqual([]);
  });
  it('draws dots at the interpolated position at simple detail', () => {
    const { arcs } = runMoving(0.99, 4);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].args[0] as number).toBeLessThan(43.5);
  });
  it('ignores interpolation at minimal detail', () => {
    // At minimal only the base position (x 43, off screen) counts.
    expect(runMoving(0.99, 1).arcs).toHaveLength(0);
  });
});

describe('fillCreepDots', () => {
  it('fills once per colour', () => {
    const { ctx, log } = mockCtx();
    fillCreepDots(ctx, [
      { x: 1, y: 1, my: true, npc: false },
      { x: 2, y: 1, my: false, npc: false },
      { x: 3, y: 1, my: true, npc: false },
      { x: 4, y: 1, my: false, npc: true },
    ], 0.45);
    expect(log.filter((c) => c.op === 'fill')).toHaveLength(3);
    expect(log.filter((c) => c.op === 'beginPath')).toHaveLength(3);
    expect(log.filter((c) => c.op === 'arc')).toHaveLength(4);
    const colours = log.filter((c) => c.op === 'set:fillStyle').map((c) => c.args[0]);
    expect(colours).toEqual([RENDER_COLORS.ownership.bot, RENDER_COLORS.ownership.opponent, RENDER_COLORS.creep.invaderBody]);
  });
  it('draws nothing for an empty colour group', () => {
    const { ctx, log } = mockCtx();
    fillCreepDots(ctx, [{ x: 1, y: 1, my: true, npc: false }], 0.6);
    expect(log.filter((c) => c.op === 'fill')).toHaveLength(1);
  });
});

// Real recordings store an idle action target as null, not undefined.
describe('drawFrame culling with null action targets', () => {
  const oneRoom = { rooms: ['A'], offsets: { A: { col: 0, row: 0 } }, pixelsPerRoom: 600, width: 600, height: 600 } as StageLayout;
  const offScreen = {
    link: { _id: 'l', type: 'link', room: 'A', x: 45, y: 10, store: { energy: 0 }, actionLog: { transferEnergy: null } },
    tower: { _id: 't', type: 'tower', room: 'A', x: 46, y: 10, store: { energy: 0 }, actionLog: { attack: null, heal: null, repair: null } },
  };
  for (const [kind, object] of Object.entries(offScreen)) {
    for (const pixelsPerTile of [20, 4]) {
      it(`does not throw for an off-screen ${kind} at ${pixelsPerTile} px/tile`, () => {
        const recording = { meta: { botUserId: 'me' }, terrain: { A: [] },
          frames: [{ gameTime: 1, flags: [], objects: [object] }] } as unknown as Recording;
        const { ctx } = mockCtx();
        expect(() => drawFrame(ctx, recording, 0, null, { sprites: { draw: () => undefined } as never, layers: layers as never,
          layout: oneRoom, showVisuals: false, view: { minX: 0, minY: 0, maxX: 20, maxY: 50, pixelsPerTile } })).not.toThrow();
      });
    }
  }
});

import { describe, expect, it } from 'vitest';
import type { Frame, FrameObject, StageLayout } from '../../api/types';
import { constructedWallsIn, drawMergedWalls, drawRoomStructureLayer, drawStaticStructures, flagsByRoom } from '../staticLayers';
import { drawWallIslands } from '../terrainWalls';
import { drawRamparts, drawRoomRamparts } from '../ramparts';
import { frameObjectsInDrawOrder } from '../renderOrder';
import { mockCtx, type Call } from './mockCtx';

const layout = {
  rooms: ['W1N1', 'W0N1'], pixelsPerRoom: 600, width: 1200, height: 600,
  offsets: { W1N1: { col: 0, row: 0 }, W0N1: { col: 1, row: 0 } },
} as unknown as StageLayout;
const rows = () => { const r = Array.from({ length: 50 }, () => '.'.repeat(50)); r[0] = '#'.repeat(50); return r; };
const terrain: Record<string, string[]> = { W1N1: rows(), W0N1: rows() };
const objects = [
  { _id: 'r1', type: 'road', room: 'W1N1', x: 5, y: 5 },
  { _id: 'r2', type: 'road', room: 'W1N1', x: 6, y: 5 },
  { _id: 'c', type: 'controller', room: 'W0N1', x: 0, y: 10, level: 3, user: 'u' },
  { _id: 'w', type: 'constructedWall', room: 'W0N1', x: 20, y: 20 },
  { _id: 'rp', type: 'rampart', room: 'W1N1', x: 7, y: 7, user: 'u' },
] as unknown as FrameObject[];
const frame = { gameTime: 1, flags: [], objects } as unknown as Frame;

// Geometry calls with their arguments, as a sorted multiset. The whole-map
// passes translate per room too, so room-local arguments compare directly.
const GEOMETRY = new Set(['moveTo', 'lineTo', 'arc', 'arcTo', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'fillRect', 'fill', 'stroke', 'fillText', 'drawImage']);
const geometry = (log: Call[]) => log.filter((c) => GEOMETRY.has(c.op)).map((c) => JSON.stringify([c.op, c.args])).sort();
const ordered = frameObjectsInDrawOrder(frame, layout);
const inRoom = (room: string) => ordered.filter((o) => o.room === room);

describe('room-local static drawing', () => {
  it('draws the same walls per room as the whole-map pass', () => {
    const whole = mockCtx(); drawMergedWalls(whole.ctx, terrain, frame, layout);
    const local = mockCtx();
    for (const room of Object.keys(layout.offsets)) drawWallIslands(local.ctx, terrain[room], undefined, constructedWallsIn(inRoom(room)));
    expect(geometry(local.log)).toEqual(geometry(whole.log));
  });

  it('draws the same structures per room as the whole-map pass, plus room names', () => {
    const whole = mockCtx(); drawStaticStructures(whole.ctx, frame, layout);
    const local = mockCtx();
    for (const room of Object.keys(layout.offsets)) drawRoomStructureLayer(local.ctx, room, inRoom(room), []);
    const names = new Set(Object.keys(layout.offsets));
    const withoutNames = geometry(local.log).filter((g) => { const [op, args] = JSON.parse(g); return !(op === 'fillText' && names.has(args[0])); });
    expect(withoutNames).toEqual(geometry(whole.log));
  });

  it('draws ramparts room-locally', () => {
    const whole = mockCtx(); drawRamparts(whole.ctx, frame, layout);
    const local = mockCtx(); drawRoomRamparts(local.ctx, inRoom('W1N1'));
    expect(geometry(local.log)).toEqual(geometry(whole.log));
  });

  it('puts flags in room-local coordinates', () => {
    expect(flagsByRoom([{ room: 'W0N1', name: 'F', x: 3, y: 4 }], layout).get('W0N1')).toEqual([{ name: 'F', x: 3, y: 4 }]);
  });

  it('keeps a long flag label at the room edge inside the padded tile', () => {
    const { ctx, log } = mockCtx();
    const name = 'a-very-long-flag-name';
    drawRoomStructureLayer(ctx, 'W1N1', [], [{ name, x: 49, y: 10 }]);
    const label = log.find((c) => c.op === 'fillText' && c.args[0] === name)!;
    expect((label.args[1] as number) + name.length * 0.22 / 2).toBeLessThanOrEqual(52 + 1e-9);
  });
});

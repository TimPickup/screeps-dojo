import { describe, expect, it, vi } from 'vitest';
import type { Recording, StageLayout } from '../../api/types';
import { drawFrame } from '../drawFrame';
import * as powerEffects from '../powerEffects';
import * as powerCreepsModule from '../powerCreeps';
import { fakeLayers, mockCtx } from './mockCtx';

describe('drawFrame spawn transition', () => {
  it('uses the normal movement interpolation when a spawning creep is released', () => {
    const recording = {
      meta: { scenario: 'spawn-transition', endReason: 'running', ticks: 2 },
      terrain: { W0N0: [] },
      frames: [
        { gameTime: 1, flags: [], objects: [
          { _id: 'creep', type: 'creep', room: 'W0N0', x: 10, y: 10, spawning: true },
        ] },
        { gameTime: 2, flags: [], objects: [
          { _id: 'creep', type: 'creep', room: 'W0N0', x: 11, y: 10, spawning: false },
        ] },
      ],
    } as Recording;
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const draws: Array<{ object: { spawning?: unknown }; x: number; y: number }> = [];
    const sprites = {
      draw: (_ctx: unknown, object: { spawning?: unknown }, x: number, y: number) => draws.push({ object, x, y }),
    };
    const record: string[] = [];
    const layers = fakeLayers(record);

    const { ctx, log } = mockCtx();
    drawFrame(ctx, recording, 0, 0.75, {
      sprites: sprites as never, layers: layers as never, layout, showVisuals: false,
    });

    expect(draws).toHaveLength(1);
    expect(draws[0].object.spawning).toBe(false);
    expect(draws[0].x).toBeCloseTo(10.5);
    expect(draws[0].y).toBe(10);
    expect(layers.swampTime).toBe(0.75);
    expect(record).toEqual(['terrain', 'structure', 'rampart']);
    expect(log[log.length - 1].op).toBe('drawImage');
    expect((log[log.length - 1].args[0] as { layer: string }).layer).toBe('rampart');
  });

  it('draws smaller-y creeps before larger-y creeps regardless of recording order', () => {
    const recording = {
      meta: { scenario: 'draw-order', endReason: 'running', ticks: 1 },
      terrain: { W0N0: [] },
      frames: [{
        gameTime: 1,
        flags: [],
        objects: [
          { _id: 'lower', type: 'creep', room: 'W0N0', x: 10, y: 20 },
          { _id: 'upper', type: 'creep', room: 'W0N0', x: 10, y: 10 },
        ],
      }],
    } as Recording;
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const drawnObjectIds: string[] = [];
    const sprites = {
      draw: (_ctx: unknown, object: { _id: string }) => drawnObjectIds.push(object._id),
    };
    const layers = fakeLayers();

    drawFrame(mockCtx().ctx, recording, 0, null, {
      sprites: sprites as never, layers: layers as never, layout, showVisuals: false,
    });

    expect(drawnObjectIds).toEqual(['upper', 'lower']);
  });

  it('draws a power creep through the same sprite dispatch as a creep', () => {
    const recording = {
      meta: { scenario: 'power-creep-draw', endReason: 'running', ticks: 1 },
      terrain: { W0N0: [] },
      frames: [{
        gameTime: 1,
        flags: [],
        objects: [
          { _id: 'pc', type: 'powerCreep', room: 'W0N0', x: 10, y: 10, level: 7, className: 'operator' },
        ],
      }],
    } as Recording;
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const draws: Array<{ object: { _id: string; type: string } }> = [];
    const sprites = {
      draw: (_ctx: unknown, object: { _id: string; type: string }) => draws.push({ object }),
    };
    const layers = fakeLayers();

    drawFrame(mockCtx().ctx, recording, 0, null, {
      sprites: sprites as never, layers: layers as never, layout, showVisuals: false,
    });

    expect(draws).toHaveLength(1);
    expect(draws[0].object._id).toBe('pc');
    expect(draws[0].object.type).toBe('powerCreep');
  });

  it('flares a power creep\'s fade-in only when it actually spawned, not merely new this frame', () => {
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const sprites = { draw: () => undefined };
    const layers = fakeLayers();
    const makeRecording = (actionLog: Record<string, unknown>) => ({
      meta: { scenario: 'power-creep-fade-in', endReason: 'running', ticks: 2 },
      terrain: { W0N0: [] },
      frames: [
        { gameTime: 1, flags: [], objects: [] },
        { gameTime: 2, flags: [], objects: [
          { _id: 'pc', type: 'powerCreep', room: 'W0N0', x: 10, y: 10, level: 1, className: 'operator', actionLog },
        ] },
      ],
    } as Recording);

    const flareSpy = vi.spyOn(powerCreepsModule, 'drawSpawnFlare').mockImplementation(() => undefined);

    // Newly present next frame, but no `spawned` flag — e.g. walking in from
    // an unrecorded room, or placed mid-run. Must NOT flare.
    drawFrame(mockCtx().ctx, makeRecording({}), 0, 0.5, {
      sprites: sprites as never, layers: layers as never, layout, showVisuals: false,
    });
    expect(flareSpy).not.toHaveBeenCalled();

    // Newly present next frame WITH the engine's spawned flag. Must flare.
    drawFrame(mockCtx().ctx, makeRecording({ spawned: true }), 0, 0.5, {
      sprites: sprites as never, layers: layers as never, layout, showVisuals: false,
    });
    expect(flareSpy).toHaveBeenCalled();

    flareSpy.mockRestore();
  });

  it('draws the active-effect pip after the rampart overlay, for a tower under OPERATE_TOWER', () => {
    const recording = {
      meta: { scenario: 'power-effect-pip', endReason: 'running', ticks: 1 },
      terrain: { W0N0: [] },
      frames: [{
        gameTime: 10,
        flags: [],
        objects: [
          { _id: 'tower1', type: 'tower', room: 'W0N0', x: 10, y: 10,
            effects: [{ effect: 3, power: 3, level: 1, endTime: 50 }] },
        ],
      }],
    } as Recording;
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const sprites = { draw: () => undefined };
    const layers = fakeLayers();

    const { ctx, log } = mockCtx();
    drawFrame(ctx, recording, 0, null, {
      sprites: sprites as never, layers: layers as never, layout, showVisuals: false,
    });

    expect(log.some((call) => call.op === 'fillText' && call.args[0] === 'OT')).toBe(true);
    const rampartDrawIndex = log.findIndex((call) => call.op === 'drawImage' && (call.args[0] as { layer?: string } | undefined)?.layer === 'rampart');
    const pipTextIndex = log.findIndex((call) => call.op === 'fillText' && call.args[0] === 'OT');
    expect(rampartDrawIndex).toBeGreaterThanOrEqual(0);
    expect(pipTextIndex).toBeGreaterThan(rampartDrawIndex);
  });

  it('calls activeEffects exactly once per object with a live effect, for both the flare pass and the pip pass', () => {
    const recording = {
      meta: { scenario: 'power-effect-single-scan', endReason: 'running', ticks: 1 },
      terrain: { W0N0: [] },
      frames: [{
        gameTime: 10,
        flags: [],
        objects: [
          { _id: 'tower1', type: 'tower', room: 'W0N0', x: 10, y: 10,
            effects: [{ effect: 3, power: 3, level: 1, endTime: 50 }] },
          // a second live-effect object, and a couple of effect-free ones, so
          // the count below can't pass by accident on a single-object frame
          { _id: 'rampart1', type: 'rampart', room: 'W0N0', x: 12, y: 10, hits: 5000, hitsMax: 0,
            effects: [{ power: 12, level: 1, endTime: 50 }] },
          { _id: 'energy1', type: 'energy', room: 'W0N0', x: 14, y: 10 },
        ],
      }],
    } as Recording;
    const layout = {
      rooms: ['W0N0'], offsets: { W0N0: { col: 0, row: 0 } },
      pixelsPerRoom: 600, width: 600, height: 600,
    } as StageLayout;
    const sprites = { draw: () => undefined };
    const layers = fakeLayers();

    const activeEffectsSpy = vi.spyOn(powerEffects, 'activeEffects');
    try {
      drawFrame(mockCtx().ctx, recording, 0, null, {
        sprites: sprites as never, layers: layers as never, layout, showVisuals: false,
      });
      // drawFrame.ts's flare pass (2e) is the only caller left — the pip pass
      // (4b) reads the flare pass's own liveEffectTargets buffer instead of
      // calling activeEffects again — so each live-effect object is scanned
      // exactly once for the whole frame, not once per pass.
      const idsScanned = activeEffectsSpy.mock.calls.map((call) => (call[0] as { _id: string })._id);
      expect(idsScanned).toEqual(['tower1', 'rampart1']);
    } finally {
      activeEffectsSpy.mockRestore();
    }
  });
});

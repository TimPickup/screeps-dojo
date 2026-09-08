import { describe, it, expect } from 'vitest';
import { drawReactor, drawUnknownObject, reactorAngle, reactorIsRunning } from '../modObjects';
import { drawFrame } from '../drawFrame';
import { drawStaticScene } from '../staticLayers';
import { REACTOR_RENDER_STYLE, RENDER_COLORS } from '../renderConstants';
import { mockCtx, lastSet } from './mockCtx';
import type { FrameObject } from '../../api/types';

const reactor = (patch: Partial<FrameObject> = {}): FrameObject => ({
  _id: 'r1', type: 'reactor', room: 'W0N0', x: 10, y: 10, store: {}, ...patch,
} as unknown as FrameObject);

// A stand-in for a decoded PNG. drawImage only records its arguments here.
const image = { width: 150, height: 150 } as unknown as CanvasImageSource;
const images = { reactorCore: image, reactorEdge: image, thorium: image };

describe('reactorIsRunning', () => {
  it('needs both an owner and Thorium', () => {
    expect(reactorIsRunning(reactor())).toBe(false);
    expect(reactorIsRunning(reactor({ store: { T: 5 } }))).toBe(false);
    expect(reactorIsRunning(reactor({ user: 'u1' }))).toBe(false);
    expect(reactorIsRunning(reactor({ user: 'u1', store: { T: 5 } }))).toBe(true);
  });

  it('treats an emptied reactor as stopped', () => {
    expect(reactorIsRunning(reactor({ user: 'u1', store: { T: 0 } }))).toBe(false);
  });
});

describe('reactorAngle', () => {
  // Derived from game time, never wall clock: a replay scrubbed by hand and the
  // same replay exported to MP4 at 8x have to look identical.
  it('turns half a revolution every four ticks', () => {
    expect(reactorAngle(0)).toBe(0);
    expect(reactorAngle(REACTOR_RENDER_STYLE.secondsPerHalfTurn)).toBeCloseTo(Math.PI);
    expect(reactorAngle(8)).toBeCloseTo(2 * Math.PI);
  });

  it('interpolates within a tick, so the edge does not step', () => {
    expect(reactorAngle(2.5)).toBeGreaterThan(reactorAngle(2));
    expect(reactorAngle(2.5)).toBeLessThan(reactorAngle(3));
  });
});

describe('drawReactor', () => {
  it('draws the core and edge artwork at 1.5 tiles, centred', () => {
    const { ctx, log } = mockCtx();
    drawReactor(ctx, reactor(), 10.5, 10.5, 0, images);
    const drawn = log.filter((c) => c.op === 'drawImage');
    expect(drawn).toHaveLength(2);
    const [, dx, dy, dw, dh] = drawn[0].args as [unknown, number, number, number, number];
    expect(dw).toBeCloseTo(REACTOR_RENDER_STYLE.size);
    expect(dh).toBeCloseTo(REACTOR_RENDER_STYLE.size);
    expect(dx).toBeCloseTo(-REACTOR_RENDER_STYLE.size / 2);
    expect(dy).toBeCloseTo(-REACTOR_RENDER_STYLE.size / 2);
  });

  it('rotates the edge only while the reactor is running', () => {
    const idle = mockCtx();
    drawReactor(idle.ctx, reactor({ user: 'u1' }), 10.5, 10.5, 3, images);
    expect(idle.log.filter((c) => c.op === 'rotate')).toHaveLength(0);

    const running = mockCtx();
    drawReactor(running.ctx, reactor({ user: 'u1', store: { T: 9 } }), 10.5, 10.5, 3, images);
    const rotations = running.log.filter((c) => c.op === 'rotate');
    expect(rotations).toHaveLength(1);
    expect(rotations[0].args[0]).toBeCloseTo(reactorAngle(3));
  });

  it('glows brighter and wider while running', () => {
    const idle = mockCtx();
    drawReactor(idle.ctx, reactor({ user: 'u1' }), 10.5, 10.5, 0, images);
    const running = mockCtx();
    drawReactor(running.ctx, reactor({ user: 'u1', store: { T: 1 } }), 10.5, 10.5, 0, images);

    const radius = (log: ReturnType<typeof mockCtx>['log']) =>
      (log.find((c) => c.op === 'createRadialGradient')!.args as number[])[5];
    expect(radius(running.log)).toBeGreaterThan(radius(idle.log));
    expect(running.log.some((c) => c.op === 'gradient.addColorStop')).toBe(true);
  });

  it('rings an owned reactor in the owner\'s colour, and an unowned one not at all', () => {
    const mine = mockCtx();
    drawReactor(mine.ctx, reactor({ user: 'u1', my: true }), 10.5, 10.5, 0, images);
    expect(lastSet(mine.log, 'strokeStyle')).toBe(RENDER_COLORS.ownership.bot);

    const theirs = mockCtx();
    drawReactor(theirs.ctx, reactor({ user: 'u2', my: false }), 10.5, 10.5, 0, images);
    expect(lastSet(theirs.log, 'strokeStyle')).toBe(RENDER_COLORS.ownership.opponent);

    const unowned = mockCtx();
    drawReactor(unowned.ctx, reactor(), 10.5, 10.5, 0, images);
    expect(unowned.log.some((c) => c.op === 'stroke')).toBe(false);
  });

  it('falls back to vectors when the artwork never loaded', () => {
    // The canvas tests run with no images at all; a replay opened before the
    // PNGs decode must still show something.
    const { ctx, log } = mockCtx();
    drawReactor(ctx, reactor({ user: 'u1', store: { T: 3 } }), 10.5, 10.5, 2);
    expect(log.some((c) => c.op === 'drawImage')).toBe(false);
    expect(log.filter((c) => c.op === 'fill').length).toBeGreaterThan(0);
    expect(log.filter((c) => c.op === 'rotate')).toHaveLength(1);
  });
});

describe('drawUnknownObject', () => {
  it('marks an object type the renderer has no artwork for, with its name', () => {
    const { ctx, log } = mockCtx();
    drawUnknownObject(ctx, { type: 'wormhole' } as unknown as FrameObject, 4.5, 4.5);
    expect(log.some((c) => c.op === 'arc')).toBe(true);
    const label = log.find((c) => c.op === 'fillText' || c.op === 'moveTo');
    expect(label).toBeTruthy();
  });
});

describe('drawFrame integration', () => {
  const layout = {
    rooms: ['W0N0'],
    offsets: { W0N0: { col: 0, row: 0 } },
    pixelsPerRoom: 50,
    width: 50,
    height: 50,
  };

  function recordingWith(objects: FrameObject[]) {
    return {
      meta: { scenario: 's', endReason: 'until', ticks: 1, botUserId: 'u1' },
      terrain: { W0N0: [] },
      frames: [{ gameTime: 4, objects, flags: [] }],
    } as unknown as Parameters<typeof drawFrame>[1];
  }

  const layers = {
    terrain: {} as HTMLCanvasElement,
    structure: {} as HTMLCanvasElement,
    rampart: null,
    prepare: () => {},
    sync: () => {},
    drawSwamps: () => {},
  } as unknown as Parameters<typeof drawFrame>[4]['layers'];

  const sprites = { draw: () => {} } as unknown as Parameters<typeof drawFrame>[4]['sprites'];

  it('draws a reactor from a frame, with the mod artwork it was given', () => {
    const { ctx, log } = mockCtx();
    drawFrame(ctx, recordingWith([reactor({ user: 'u1', store: { T: 4 } })]), 0, null, {
      sprites, layers, layout, showVisuals: false, modImages: images,
    });
    // two drawImage calls for the cached layers, plus the reactor's core+edge
    expect(log.filter((c) => c.op === 'drawImage').length).toBeGreaterThanOrEqual(4);
    expect(log.some((c) => c.op === 'createRadialGradient')).toBe(true);
  });

  it('marks an unknown mod object instead of dropping it', () => {
    const { ctx, log } = mockCtx();
    const before = mockCtx();
    drawFrame(before.ctx, recordingWith([]), 0, null, { sprites, layers, layout, showVisuals: false });
    drawFrame(ctx, recordingWith([{ _id: 'x', type: 'wormhole', room: 'W0N0', x: 3, y: 3 } as unknown as FrameObject]),
      0, null, { sprites, layers, layout, showVisuals: false });
    expect(log.filter((c) => c.op === 'arc').length).toBeGreaterThan(before.log.filter((c) => c.op === 'arc').length);
  });

  it('leaves types it already knows to their own renderers', () => {
    const { ctx, log } = mockCtx();
    const road = { _id: 'rd', type: 'road', room: 'W0N0', x: 3, y: 3 } as unknown as FrameObject;
    drawFrame(ctx, recordingWith([road]), 0, null, { sprites, layers, layout, showVisuals: false });
    // a road is baked into the cached structure layer — nothing extra here
    expect(log.filter((c) => c.op === 'arc')).toHaveLength(0);
  });
});

// The map editor and the scenario preview render through drawStaticScene, not
// drawFrame. They must agree with the replay: same routines, same artwork.
describe('drawStaticScene (map editor / preview)', () => {
  const layout = {
    rooms: ['W0N0'],
    offsets: { W0N0: { col: 0, row: 0 } },
    pixelsPerRoom: 50,
    width: 50,
    height: 50,
  };
  const terrain = { W0N0: Array.from({ length: 50 }, () => '.'.repeat(50)) };

  function scene(objects: FrameObject[]) {
    return { terrain, frame: { gameTime: 4, objects, flags: [] }, layout } as unknown as Parameters<typeof drawStaticScene>[1];
  }

  it('draws a reactor, which lives only in drawFrame for the replay', () => {
    const withReactor = mockCtx();
    drawStaticScene(withReactor.ctx, scene([reactor({ user: 'me', store: { T: 4 } })]), { modImages: images });
    const empty = mockCtx();
    drawStaticScene(empty.ctx, scene([]), { modImages: images });
    // core + edge sprites, and the glow
    expect(withReactor.log.filter((c) => c.op === 'drawImage').length)
      .toBe(empty.log.filter((c) => c.op === 'drawImage').length + 2);
    expect(withReactor.log.some((c) => c.op === 'createRadialGradient')).toBe(true);
  });

  it('uses the Thorium icon for a T mineral, exactly like the replay', () => {
    const mineral = { _id: 'm', type: 'mineral', room: 'W0N0', x: 5, y: 5, mineralType: 'T' } as unknown as FrameObject;
    const withArt = mockCtx();
    drawStaticScene(withArt.ctx, scene([mineral]), { modImages: images });
    expect(withArt.log.some((c) => c.op === 'drawImage')).toBe(true);

    // and falls back to the lettering when the artwork is unavailable
    const withoutArt = mockCtx();
    drawStaticScene(withoutArt.ctx, scene([mineral]), {});
    expect(withoutArt.log.some((c) => c.op === 'drawImage')).toBe(false);
  });

  it('marks an unknown mod object rather than leaving an empty tile', () => {
    const unknown = mockCtx();
    drawStaticScene(unknown.ctx, scene([{ _id: 'x', type: 'wormhole', room: 'W0N0', x: 3, y: 3 } as unknown as FrameObject]), {});
    const empty = mockCtx();
    drawStaticScene(empty.ctx, scene([]), {});
    expect(unknown.log.filter((c) => c.op === 'arc').length)
      .toBeGreaterThan(empty.log.filter((c) => c.op === 'arc').length);
  });
});

import type { StaticLayers } from '../caches';

export type Call = { op: string; args: unknown[] };

// A fake CanvasRenderingContext2D that records every method call and property
// set, in order, so tests can assert the exact sequence of draw operations.
export function mockCtx(): { ctx: CanvasRenderingContext2D; log: Call[] } {
  const log: Call[] = [];
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
    'arcTo', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect', 'translate',
    'rotate', 'scale', 'setLineDash', 'fillText', 'drawImage', 'setTransform',
  ];
  const target: Record<string, unknown> = {};
  for (const m of methods) target[m] = (...args: unknown[]) => { log.push({ op: m, args }); };
  target.createPattern = (...args: unknown[]) => {
    log.push({ op: 'createPattern', args });
    return {
      setTransform: (...transformArgs: unknown[]) => log.push({ op: 'pattern.setTransform', args: transformArgs }),
    };
  };
  target.createRadialGradient = (...args: unknown[]) => {
    log.push({ op: 'createRadialGradient', args });
    return {
      addColorStop: (...stopArgs: unknown[]) => log.push({ op: 'gradient.addColorStop', args: stopArgs }),
    };
  };
  target.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  const props = [
    'fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'globalCompositeOperation',
    'imageSmoothingEnabled', 'font', 'textAlign', 'lineCap', 'lineJoin', 'textBaseline',
  ];
  const store: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (t, p: string) => (props.includes(p) ? store[p] : t[p]),
    set: (t, p: string, v) => {
      if (props.includes(p)) { store[p] = v; log.push({ op: 'set:' + p, args: [v] }); return true; }
      t[p] = v; return true;
    },
  };
  return { ctx: new Proxy(target, handler) as unknown as CanvasRenderingContext2D, log };
}

// Test helper: names of ops in order (drops property sets).
export function ops(log: Call[]): string[] {
  return log.filter((c) => !c.op.startsWith('set:')).map((c) => c.op);
}
// Test helper: last value a property was set to.
export function lastSet(log: Call[], prop: string): unknown {
  const hits = log.filter((c) => c.op === 'set:' + prop);
  return hits.length ? hits[hits.length - 1].args[0] : undefined;
}

// A stand-in for StaticLayers (the drawFrame caller's view of it). Each draw
// method records its layer name in `record` and draws a `{ layer }` marker
// through ctx.drawImage, so a test can check both the layer order and where a
// layer falls among the other calls in the ctx log. drawSwamps keeps the
// animation time it was given on `.swampTime`.
export type FakeLayers = StaticLayers & { swampTime?: number };
export function fakeLayers(record: string[] = []): FakeLayers {
  const draw = (layer: 'terrain' | 'structure' | 'rampart') => (ctx: CanvasRenderingContext2D) => {
    record.push(layer);
    ctx.drawImage({ layer } as unknown as CanvasImageSource, 0, 0);
  };
  const layers = {
    swampTime: undefined as number | undefined,
    version: 0,
    prepare: () => undefined,
    sync: () => undefined,
    beginFrame: () => undefined,
    drawTerrain: draw('terrain'),
    drawStructures: draw('structure'),
    drawRamparts: draw('rampart'),
    drawSwamps: (_ctx: CanvasRenderingContext2D, animationTime: number) => { layers.swampTime = animationTime; },
    pump: () => 0,
    lodFor: () => 1,
    stats: () => ({ tileBytes: 0, pinnedBytes: 0, queued: 0 }),
  };
  return layers as unknown as FakeLayers;
}

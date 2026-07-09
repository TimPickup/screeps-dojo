export type Call = { op: string; args: unknown[] };

// A fake CanvasRenderingContext2D that records every method call and property
// set, in order, so tests can assert the exact sequence of draw operations.
export function mockCtx(): { ctx: CanvasRenderingContext2D; log: Call[] } {
  const log: Call[] = [];
  const methods = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
    'arcTo', 'rect', 'fill', 'stroke', 'fillRect', 'strokeRect', 'translate',
    'rotate', 'scale', 'setLineDash', 'fillText', 'drawImage', 'setTransform',
  ];
  const target: Record<string, unknown> = {};
  for (const m of methods) target[m] = (...args: unknown[]) => { log.push({ op: m, args }); };
  const props = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font', 'textAlign', 'lineCap', 'textBaseline'];
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

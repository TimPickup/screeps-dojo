import { circle, poly, rect, line } from './primitives';

type Ctx = CanvasRenderingContext2D;

const C = {
  gray: '#555555', light: '#AAAAAA', road: '#666', energy: '#FFE87B',
  power: '#F53547', dark: '#181818', outline: '#8FBB93',
};

// Ported from lib/RoomVisual.js#calculateFactoryLevelGapsPoly
function factoryLevelGaps(): number[][] {
  let x = -0.08, y = -0.52;
  const out: number[][] = [];
  const g = 16 * (Math.PI / 180), c1 = Math.cos(g), s1 = Math.sin(g);
  const a = 72 * (Math.PI / 180), c2 = Math.cos(a), s2 = Math.sin(a);
  for (let i = 0; i < 5; i++) {
    out.push([0, 0]); out.push([x, y]); out.push([x * c1 - y * s1, x * s1 + y * c1]);
    const tx = x * c2 - y * s2; y = x * s2 + y * c2; x = tx;
  }
  return out;
}
const FACTORY_GAPS = factoryLevelGaps();

// offsets are RoomVisual-relative; add the centred anchor.
const rel = (cx: number, cy: number, pts: number[][]) => pts.map((p) => [p[0] + cx, p[1] + cy]);

export function drawStructureShell(ctx: Ctx, x: number, y: number, type: string): void {
  const cx = x + 0.5, cy = y + 0.5;
  switch (type) {
    case 'extension':
      circle(ctx, cx, cy, { radius: 0.5, fill: C.dark, stroke: C.outline, strokeWidth: 0.05 });
      break;
    case 'spawn':
      circle(ctx, cx, cy, { radius: 0.65, fill: C.dark, stroke: '#CCCCCC', strokeWidth: 0.1 });
      break;
    case 'powerSpawn':
      circle(ctx, cx, cy, { radius: 0.65, fill: C.dark, stroke: C.power, strokeWidth: 0.1 });
      circle(ctx, cx, cy, { radius: 0.4, fill: C.energy });
      break;
    case 'tower':
      circle(ctx, cx, cy, { radius: 0.6, fill: C.dark, stroke: C.outline, strokeWidth: 0.05 });
      rect(ctx, cx - 0.4, cy - 0.3, 0.8, 0.6, { fill: C.gray });
      rect(ctx, cx - 0.2, cy - 0.9, 0.4, 0.5, { fill: C.light, stroke: C.dark, strokeWidth: 0.07 });
      break;
    case 'link': {
      const outer = rel(cx, cy, [[0, -0.5], [0.4, 0], [0, 0.5], [-0.4, 0]]);
      poly(ctx, outer, { fill: C.dark, stroke: C.outline, strokeWidth: 0.05 });
      break;
    }
    case 'terminal': {
      const outer = rel(cx, cy, [[0, -0.8], [0.55, -0.55], [0.8, 0], [0.55, 0.55], [0, 0.8], [-0.55, 0.55], [-0.8, 0], [-0.55, -0.55]]);
      const inner = rel(cx, cy, [[0, -0.65], [0.45, -0.45], [0.65, 0], [0.45, 0.45], [0, 0.65], [-0.45, 0.45], [-0.65, 0], [-0.45, -0.45]]);
      poly(ctx, outer, { fill: C.dark, stroke: C.outline, strokeWidth: 0.05 });
      poly(ctx, inner, { fill: C.light });
      rect(ctx, cx - 0.45, cy - 0.45, 0.9, 0.9, { fill: C.gray, stroke: C.dark, strokeWidth: 0.1 });
      break;
    }
    case 'lab':
      circle(ctx, cx, cy - 0.025, { radius: 0.55, fill: C.dark, stroke: C.outline, strokeWidth: 0.05 });
      circle(ctx, cx, cy - 0.025, { radius: 0.4, fill: C.gray });
      rect(ctx, cx - 0.45, cy + 0.3, 0.9, 0.25, { fill: C.dark });
      poly(ctx, rel(cx, cy, [[-0.45, 0.3], [-0.45, 0.55], [0.45, 0.55], [0.45, 0.3]]), { stroke: C.outline, strokeWidth: 0.05 });
      break;
    case 'factory': {
      const outline = rel(cx, cy, [[-0.68, -0.11], [-0.84, -0.18], [-0.84, -0.32], [-0.44, -0.44], [-0.32, -0.84], [-0.18, -0.84], [-0.11, -0.68], [0.11, -0.68], [0.18, -0.84], [0.32, -0.84], [0.44, -0.44], [0.84, -0.32], [0.84, -0.18], [0.68, -0.11], [0.68, 0.11], [0.84, 0.18], [0.84, 0.32], [0.44, 0.44], [0.32, 0.84], [0.18, 0.84], [0.11, 0.68], [-0.11, 0.68], [-0.18, 0.84], [-0.32, 0.84], [-0.44, 0.44], [-0.84, 0.32], [-0.84, 0.18], [-0.68, 0.11]]);
      poly(ctx, outline, { stroke: C.outline, strokeWidth: 0.05 });
      circle(ctx, cx, cy, { radius: 0.65, fill: '#232323', stroke: '#140a0a', strokeWidth: 0.035 });
      const spikes = rel(cx, cy, [[-0.4, -0.1], [-0.8, -0.2], [-0.8, -0.3], [-0.4, -0.4], [-0.3, -0.8], [-0.2, -0.8], [-0.1, -0.4], [0.1, -0.4], [0.2, -0.8], [0.3, -0.8], [0.4, -0.4], [0.8, -0.3], [0.8, -0.2], [0.4, -0.1], [0.4, 0.1], [0.8, 0.2], [0.8, 0.3], [0.4, 0.4], [0.3, 0.8], [0.2, 0.8], [0.1, 0.4], [-0.1, 0.4], [-0.2, 0.8], [-0.3, 0.8], [-0.4, 0.4], [-0.8, 0.3], [-0.8, 0.2], [-0.4, 0.1]]);
      poly(ctx, spikes, { fill: C.gray, stroke: '#140a0a', strokeWidth: 0.04 });
      circle(ctx, cx, cy, { radius: 0.54, fill: '#302a2a', stroke: '#140a0a', strokeWidth: 0.04 });
      poly(ctx, rel(cx, cy, FACTORY_GAPS), { fill: '#140a0a' });
      circle(ctx, cx, cy, { radius: 0.42, fill: '#140a0a' });
      rect(ctx, cx - 0.24, cy - 0.24, 0.48, 0.48, { fill: '#3f3f3f' });
      break;
    }
    case 'road':
      circle(ctx, cx, cy, { radius: 0.175, fill: C.road });
      break;
    case 'rampart':
      rect(ctx, cx - 0.5, cy - 0.5, 1, 1, { fill: '#52a052', opacity: 0.25 });
      break;
    case 'invaderCore':
      circle(ctx, cx, cy, { radius: 0.55, fill: '#cc2222', stroke: '#000000', strokeWidth: 0.1 });
      break;
    case 'constructedWall':
      circle(ctx, cx, cy, { radius: 0.4, fill: C.dark, stroke: C.light, strokeWidth: 0.05 });
      break;
    case 'storage':
      poly(ctx, rel(cx, cy, [[-0.45, -0.55], [0, -0.65], [0.45, -0.55], [0.55, 0], [0.45, 0.55], [0, 0.65], [-0.45, 0.55], [-0.55, 0]]),
        { stroke: C.outline, strokeWidth: 0.05, fill: C.dark });
      break;
    case 'observer':
      circle(ctx, cx, cy, { radius: 0.45, fill: C.dark, stroke: C.outline, strokeWidth: 0.05 });
      circle(ctx, cx + 0.225, cy, { radius: 0.2, fill: C.outline });
      break;
    case 'nuker':
      poly(ctx, rel(cx, cy, [[0, -1], [-0.47, 0.2], [-0.5, 0.5], [0.5, 0.5], [0.47, 0.2]]), { stroke: C.outline, strokeWidth: 0.05, fill: C.dark });
      poly(ctx, rel(cx, cy, [[0, -0.8], [-0.4, 0.2], [0.4, 0.2]]), { stroke: C.outline, strokeWidth: 0.01, fill: C.gray });
      break;
    case 'container':
      rect(ctx, cx - 0.225, cy - 0.3, 0.45, 0.6, { fill: C.gray, stroke: C.dark, strokeWidth: 0.09 });
      break;
    case 'extractor':
      // no RoomVisual case → default marker
      circle(ctx, cx, cy, { radius: 0.35, fill: C.light, stroke: C.dark, strokeWidth: 0.2 });
      break;
    case 'keeperLair':
      circle(ctx, cx, cy, { radius: 0.35, fill: C.light, stroke: C.dark, strokeWidth: 0.2 });
      break;
    default:
      circle(ctx, cx, cy, { radius: 0.35, fill: C.light, stroke: C.dark, strokeWidth: 0.2 });
      break;
  }
}

// Ported from lib/RoomVisual.js#connectRoads: link each road tile to its N, NE,
// E, SE neighbour (half the 8 dirs, so each pair is drawn once). Tiles are
// integer coords; lines are centred (+0.5).
const ROAD_DIRS = [[0, -1], [1, -1], [1, 0], [1, 1]];
export function connectRoads(ctx: Ctx, roadTiles: number[][], color = C.road): void {
  const set = new Set(roadTiles.map((r) => r[0] + ',' + r[1]));
  for (const [x, y] of roadTiles) {
    for (const [dx, dy] of ROAD_DIRS) {
      if (set.has((x + dx) + ',' + (y + dy))) {
        line(ctx, x + 0.5, y + 0.5, x + dx + 0.5, y + dy + 0.5, { stroke: color, strokeWidth: 0.35 });
      }
    }
  }
}

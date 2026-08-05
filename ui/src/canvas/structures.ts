import type { FrameObject } from '../api/types.ts';
import { arc, circle, poly, rect, line } from './primitives.ts';
import { RENDER_COLORS } from './renderConstants.ts';

type CanvasContext = CanvasRenderingContext2D;

// Ported from lib/RoomVisual.js#calculateFactoryLevelGapsPoly
function factoryLevelGaps(): number[][] {
	let x = -0.08, y = -0.52;
	const points: number[][] = [];
	const gapAngle = 16 * (Math.PI / 180);
	const gapCosine = Math.cos(gapAngle), gapSine = Math.sin(gapAngle);
	const rotationAngle = 72 * (Math.PI / 180);
	const rotationCosine = Math.cos(rotationAngle), rotationSine = Math.sin(rotationAngle);
	for (let i = 0; i < 5; i++) {
		points.push([0, 0]);
		points.push([x, y]);
		points.push([x * gapCosine - y * gapSine, x * gapSine + y * gapCosine]);
		const rotatedX = x * rotationCosine - y * rotationSine;
		y = x * rotationSine + y * rotationCosine;
		x = rotatedX;
	}
	return points;
}
const FACTORY_GAPS = factoryLevelGaps();

// offsets are RoomVisual-relative; add the centred anchor.
const translatePoints = (centerX: number, centerY: number, points: number[][]): number[][] => (
	points.map((point) => [point[0] + centerX, point[1] + centerY])
);

export function drawStructureShell(ctx: CanvasContext, object: FrameObject): void {
	const { x, y, type, my, user } = object;
	const cx = x + 0.5, cy = y + 0.5;
	switch (type) {
		case 'extension':
			circle(ctx, cx, cy, { radius: 0.5, fill: RENDER_COLORS.structure.dark, stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05 });
			circle(ctx, cx, cy, { radius: 0.35, fill: RENDER_COLORS.structure.medium });
			break;
		case 'spawn':
			circle(ctx, cx, cy, { radius: 0.65, fill: RENDER_COLORS.structure.dark, stroke: RENDER_COLORS.structure.spawnOutline, strokeWidth: 0.1 });
			break;
		case 'powerSpawn':
			circle(ctx, cx, cy, { radius: 0.65, fill: RENDER_COLORS.structure.dark, stroke: RENDER_COLORS.resources.power, strokeWidth: 0.1 });
			circle(ctx, cx, cy, { radius: 0.4, fill: RENDER_COLORS.resources.energy });
			break;
		case 'tower':
			circle(ctx, cx, cy, { radius: 0.6, fill: RENDER_COLORS.structure.dark, stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05 });
			break;
		case 'link': {
			const outer = translatePoints(cx, cy, [[0, -0.40], [0.30, 0], [0, 0.40], [-0.30, 0]]);
			poly(ctx, outer, { fill: RENDER_COLORS.structure.dark, stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05 });
			const inner = translatePoints(cx, cy, [[0, -0.25], [0.20, 0], [0, 0.25], [-0.20, 0]]);
			poly(ctx, inner, { fill: RENDER_COLORS.structure.medium });
			break;
		}
		case 'terminal': {
			const outer = translatePoints(cx, cy, [[0, -0.8], [0.55, -0.55], [0.8, 0], [0.55, 0.55], [0, 0.8], [-0.55, 0.55], [-0.8, 0], [-0.55, -0.55]]);
			const inner = translatePoints(cx, cy, [[0, -0.65], [0.45, -0.45], [0.65, 0], [0.45, 0.45], [0, 0.65], [-0.45, 0.45], [-0.65, 0], [-0.45, -0.45]]);
			poly(ctx, outer, { fill: RENDER_COLORS.structure.dark, stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05 });
			poly(ctx, inner, { fill: RENDER_COLORS.structure.light });
			rect(ctx, cx - 0.45, cy - 0.45, 0.9, 0.9, { fill: RENDER_COLORS.structure.medium, stroke: RENDER_COLORS.structure.dark, strokeWidth: 0.1 });
			break;
		}
		case 'lab':
			circle(ctx, cx, cy - 0.025, { radius: 0.55, fill: RENDER_COLORS.structure.dark, stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05 });
			poly(ctx, translatePoints(cx, cy, [[-0.45, 0.3], [-0.45, 0.55], [0.45, 0.55], [0.45, 0.3]]), { stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05 });
			circle(ctx, cx, cy - 0.025, { radius: 0.4, fill: RENDER_COLORS.structure.medium });
			rect(ctx, cx - 0.425, cy + 0.3, 0.85, 0.215, { fill: RENDER_COLORS.structure.dark });
			break;
		case 'factory': {
			const outline = translatePoints(cx, cy, [[-0.68, -0.11], [-0.84, -0.18], [-0.84, -0.32], [-0.44, -0.44], [-0.32, -0.84], [-0.18, -0.84], [-0.11, -0.68], [0.11, -0.68], [0.18, -0.84], [0.32, -0.84], [0.44, -0.44], [0.84, -0.32], [0.84, -0.18], [0.68, -0.11], [0.68, 0.11], [0.84, 0.18], [0.84, 0.32], [0.44, 0.44], [0.32, 0.84], [0.18, 0.84], [0.11, 0.68], [-0.11, 0.68], [-0.18, 0.84], [-0.32, 0.84], [-0.44, 0.44], [-0.84, 0.32], [-0.84, 0.18], [-0.68, 0.11]]);
			poly(ctx, outline, { stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05 });
			circle(ctx, cx, cy, { radius: 0.65, fill: RENDER_COLORS.structure.factoryShell, stroke: RENDER_COLORS.structure.factoryOutline, strokeWidth: 0.035 });
			const spikes = translatePoints(cx, cy, [[-0.4, -0.1], [-0.8, -0.2], [-0.8, -0.3], [-0.4, -0.4], [-0.3, -0.8], [-0.2, -0.8], [-0.1, -0.4], [0.1, -0.4], [0.2, -0.8], [0.3, -0.8], [0.4, -0.4], [0.8, -0.3], [0.8, -0.2], [0.4, -0.1], [0.4, 0.1], [0.8, 0.2], [0.8, 0.3], [0.4, 0.4], [0.3, 0.8], [0.2, 0.8], [0.1, 0.4], [-0.1, 0.4], [-0.2, 0.8], [-0.3, 0.8], [-0.4, 0.4], [-0.8, 0.3], [-0.8, 0.2], [-0.4, 0.1]]);
			poly(ctx, spikes, { fill: RENDER_COLORS.structure.medium, stroke: RENDER_COLORS.structure.factoryOutline, strokeWidth: 0.04 });
			circle(ctx, cx, cy, { radius: 0.54, fill: RENDER_COLORS.structure.factoryInner, stroke: RENDER_COLORS.structure.factoryOutline, strokeWidth: 0.04 });
			poly(ctx, translatePoints(cx, cy, FACTORY_GAPS), { fill: RENDER_COLORS.structure.factoryOutline });
			circle(ctx, cx, cy, { radius: 0.42, fill: RENDER_COLORS.structure.factoryOutline });
			rect(ctx, cx - 0.24, cy - 0.24, 0.48, 0.48, { fill: RENDER_COLORS.structure.factoryCore });
			break;
		}
		case 'road':
			circle(ctx, cx, cy, { radius: 0.175, fill: RENDER_COLORS.structure.road });
			break;
		case 'rampart':
			rect(ctx, cx - 0.5, cy - 0.5, 1, 1, { fill: RENDER_COLORS.structure.rampart, opacity: 0.25 });
			break;
		case 'invaderCore':
			circle(ctx, cx, cy, { radius: 0.55, fill: RENDER_COLORS.structure.invaderCore, stroke: RENDER_COLORS.black, strokeWidth: 0.1 });
			break;
		case 'constructedWall':
			circle(ctx, cx, cy, { radius: 0.4, fill: RENDER_COLORS.structure.dark, stroke: RENDER_COLORS.structure.light, strokeWidth: 0.05 });
			break;
		case 'storage':
			poly(ctx, translatePoints(cx, cy, [[-0.45, -0.55], [0, -0.65], [0.45, -0.55], [0.55, 0], [0.45, 0.55], [0, 0.65], [-0.45, 0.55], [-0.55, 0]]),
				{ stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05, fill: RENDER_COLORS.structure.dark });
			rect(ctx, cx - 0.35, cy + 0.45 - 0.9, 0.7, 0.9, { fill: RENDER_COLORS.structure.light });
			break;
		case 'observer':
			circle(ctx, cx, cy, { radius: 0.45, fill: RENDER_COLORS.structure.dark, stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05 });
			circle(ctx, cx + 0.225, cy, { radius: 0.2, fill: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure });
			break;
		case 'nuker':
			poly(ctx, translatePoints(cx, cy, [[0, -1], [-0.47, 0.2], [-0.5, 0.5], [0.5, 0.5], [0.47, 0.2]]), { stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.05, fill: RENDER_COLORS.structure.dark });
			poly(ctx, translatePoints(cx, cy, [[0, -0.8], [-0.4, 0.2], [0.4, 0.2]]), { stroke: my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure, strokeWidth: 0.01, fill: RENDER_COLORS.structure.medium });
			break;
		case 'container':
			rect(ctx, cx - 0.225, cy - 0.3, 0.45, 0.6, { fill: RENDER_COLORS.structure.medium, stroke: RENDER_COLORS.structure.dark, strokeWidth: 0.09 });
			break;
		case 'extractor': {
			const color = user
				? (my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure)
				: RENDER_COLORS.ownership.publicStructure;
			const sixth = Math.PI / 3;
			for (let i = 0; i < 3; i++) {
				const start = i * 2 * sixth;
				arc(ctx, cx, cy, 0.8, start, start + sixth, { stroke: color, strokeWidth: 0.1 });
			}
			break;
		}
		case 'keeperLair':
			circle(ctx, cx, cy, { radius: 0.55, fill: RENDER_COLORS.structure.keeperLair, stroke: RENDER_COLORS.structure.dark, strokeWidth: 0.1 });
			circle(ctx, cx, cy, { radius: 0.25, fill: RENDER_COLORS.structure.dark });
			break;
		default:
			circle(ctx, cx, cy, { radius: 0.35, fill: RENDER_COLORS.structure.light, stroke: RENDER_COLORS.structure.dark, strokeWidth: 0.2 });
			break;
	}
}

// Ported from lib/RoomVisual.js#connectRoads: link each road tile to its N, NE,
// E, SE neighbour (half the 8 dirs, so each pair is drawn once). Tiles are
// integer coords; lines are centred (+0.5).
const ROAD_DIRECTIONS = [[0, -1], [1, -1], [1, 0], [1, 1]];
export function connectRoads(ctx: CanvasContext, roadTiles: number[][], color = RENDER_COLORS.structure.road): void {
	const roadPositions = new Set(roadTiles.map((road) => road[0] + ',' + road[1]));
	for (const [x, y] of roadTiles) {
		for (const [dx, dy] of ROAD_DIRECTIONS) {
			if (roadPositions.has((x + dx) + ',' + (y + dy))) {
				line(ctx, x + 0.5, y + 0.5, x + dx + 0.5, y + dy + 0.5, { stroke: color, strokeWidth: 0.35 });
			}
		}
	}
}

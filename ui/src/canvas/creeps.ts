import type { FrameObject } from '../api/types.ts';

const NPC_USERS = new Set(['2', '3']);
const SIZE = 1.25;
const MAX_CREEP_PARTS = 50;
const PART_ANGLE = 360 / MAX_CREEP_PARTS;
const MAX_TOUGH_WIDTH = 12;
const COLORS = {
	heal: '#6ffb6f', rangedAttack: '#5c82b1', attack: '#f7263f', work: '#ffe174',
	claim: '#b6a0f8', move: '#a9b8c6', tough: '#e8e8e8', ring: '#222222',
	inner: '#555555', energy: '#ffe25a', cargoOther: '#ffffff',
};
const TOP_PART_ORDER = [
	{ key: 'ranged_attack', color: COLORS.rangedAttack },
	{ key: 'attack', color: COLORS.attack },
	{ key: 'heal', color: COLORS.heal },
	{ key: 'work', color: COLORS.work },
	{ key: 'claim', color: COLORS.claim },
];

function countBodyParts(body?: Array<{ type: string; hits?: number }>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const part of body || []) {
		if (part.hits !== undefined && part.hits <= 0) continue;
		counts[part.type] = (counts[part.type] || 0) + 1;
	}
	return counts;
}

// The creep design uses zero degrees at twelve o'clock and increases clockwise.
// Canvas uses three o'clock as zero, so subtract 90 degrees.
function strokeArc(ctx: CanvasRenderingContext2D, radius: number, start: number, end: number, color: string, width: number): void {
	if (Math.abs(end - start) <= 0.001) return;
	const fullCircle = Math.abs(end - start) >= 359.999;
	ctx.beginPath();
	// A circle has no meaningful starting orientation. Normalising it to 0..2π
	// also avoids a Skia/@napi-rs edge case that drops -π/2..3π/2 strokes.
	ctx.arc(0, 0, radius,
		fullCircle ? 0 : (start - 90) * Math.PI / 180,
		fullCircle ? Math.PI * 2 : (end - 90) * Math.PI / 180);
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = 'butt';
	ctx.stroke();
}

function fillCircle(ctx: CanvasRenderingContext2D, radius: number, color: string): void {
	ctx.beginPath();
	ctx.arc(0, 0, radius, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}

function drawBody(ctx: CanvasRenderingContext2D, object: FrameObject, innerColor: string): void {
	const unit = SIZE / 100;
	const ringRadius = 28 * unit;
	const ringWidth = 12 * unit;
	const counts = countBodyParts(object.body);

	strokeArc(ctx, ringRadius, 0, 360, COLORS.ring, ringWidth);
	if (counts.tough > 0) {
		const toughParts = Math.min(MAX_CREEP_PARTS, counts.tough);
		const toughWidth = MAX_TOUGH_WIDTH * unit * toughParts / MAX_CREEP_PARTS;
		const toughOpacity = 0.5 + 0.5 * (toughParts - 1) / (MAX_CREEP_PARTS - 1);
		// TOUGH is always a complete outer shell. Part count controls how much of
		// that armour is visible through line width and opacity, not arc length.
		ctx.save();
		ctx.globalAlpha *= toughOpacity;
		strokeArc(ctx, ringRadius + ringWidth / 2 + toughWidth / 2, 0, 360, COLORS.tough, toughWidth);
		ctx.restore();
	}
	if (counts.move > 0) {
		const span = counts.move * PART_ANGLE;
		strokeArc(ctx, ringRadius, 180 - span / 2, 180 + span / 2, COLORS.move, ringWidth);
	}
	for (let i = 0; i < TOP_PART_ORDER.length; i++) {
		let cumulative = 0;
		for (let j = i; j < TOP_PART_ORDER.length; j++) cumulative += counts[TOP_PART_ORDER[j].key] || 0;
		if (cumulative <= 0) continue;
		const span = cumulative * PART_ANGLE;
		strokeArc(ctx, ringRadius, -span / 2, span / 2, TOP_PART_ORDER[i].color, ringWidth);
	}
	fillCircle(ctx, 18 * unit, innerColor || COLORS.inner);

	const store = object.store || {};
	const carried = Object.keys(store).filter((resource) => store[resource] > 0);
	if (!carried.length) return;
	const cargoColor = carried.length === 1 && carried[0] === 'energy' ? COLORS.energy : COLORS.cargoOther;
	let cargoRadius = 6 * unit;
	const capacity = object.storeCapacity as number | undefined;
	if (typeof capacity === 'number' && capacity > 0) {
		let used = 0;
		for (const resource of carried) used += store[resource];
		cargoRadius = (4 + 12 * Math.min(1, used / capacity)) * unit;
	}
	fillCircle(ctx, cargoRadius, cargoColor);
}

function drawInvader(ctx: CanvasRenderingContext2D): void {
	// Native invader form normalized into a 0.95-tile square.
	const size = 0.95;
	const points = [[24, 10], [8, 14], [8, 36], [24, 40], [56, 25]];
	ctx.scale(size / 64, size / 50);
	ctx.translate(-32, -25);
	ctx.beginPath();
	ctx.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
	ctx.closePath();
	ctx.strokeStyle = '#120006';
	ctx.lineWidth = 8;
	ctx.lineJoin = 'miter';
	ctx.miterLimit = 6;
	ctx.stroke();
	ctx.fillStyle = '#e51f36';
	ctx.fill();
}

export class CreepRenderer {
	draw(ctx: CanvasRenderingContext2D, object: FrameObject, wx: number, wy: number, facing: number, opacity: number): void {
		ctx.save();
		ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
		ctx.translate(wx + 0.5, wy + 0.5);
		if (object.spawning === undefined || object.spawning !== true) {

			if (this.isNpc(object)) {
				ctx.rotate(facing * Math.PI / 180);
				drawInvader(ctx);
			} else {
				ctx.rotate((facing + 90) * Math.PI / 180);
				drawBody(ctx, object, this.isBot(object) ? '#5577ff' : '#ff5555');
			}
		}
		ctx.restore();
	}

	isBot(object: FrameObject): boolean { return object.my === true; }
	isNpc(object: FrameObject): boolean { return NPC_USERS.has(String(object.user)); }
}

import type { FrameObject } from '../api/types.ts';
import { RENDER_COLORS } from './renderConstants.ts';

const NPC_USERS = new Set(['2', '3']);
const CREEP_SIZE = 1.25;
const MAX_CREEP_PARTS = 50;
const PART_ANGLE_DEGREES = 360 / MAX_CREEP_PARTS;
const MAX_TOUGH_WIDTH = 12;
const TOP_PART_ORDER = [
	{ key: 'ranged_attack', color: RENDER_COLORS.creep.rangedAttack },
	{ key: 'attack', color: RENDER_COLORS.creep.attack },
	{ key: 'heal', color: RENDER_COLORS.creep.heal },
	{ key: 'work', color: RENDER_COLORS.creep.work },
	{ key: 'claim', color: RENDER_COLORS.creep.claim },
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
function strokeArc(ctx: CanvasRenderingContext2D, radius: number, startDegrees: number, endDegrees: number, color: string, lineWidth: number): void {
	if (Math.abs(endDegrees - startDegrees) <= 0.001) return;
	const fullCircle = Math.abs(endDegrees - startDegrees) >= 359.999;
	ctx.beginPath();
	// A circle has no meaningful starting orientation. Normalising it to 0..2π
	// also avoids a Skia/@napi-rs edge case that drops -π/2..3π/2 strokes.
	ctx.arc(0, 0, radius,
		fullCircle ? 0 : (startDegrees - 90) * Math.PI / 180,
		fullCircle ? Math.PI * 2 : (endDegrees - 90) * Math.PI / 180);
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
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
	const unit = CREEP_SIZE / 100;
	const ringRadius = 28 * unit;
	const ringWidth = 12 * unit;
	const counts = countBodyParts(object.body);

	strokeArc(ctx, ringRadius, 0, 360, RENDER_COLORS.creep.ring, ringWidth);
	if (counts.tough > 0) {
		const toughParts = Math.min(MAX_CREEP_PARTS, counts.tough);
		const toughWidth = MAX_TOUGH_WIDTH * unit * toughParts / MAX_CREEP_PARTS;
		const toughOpacity = 0.5 + 0.5 * (toughParts - 1) / (MAX_CREEP_PARTS - 1);
		// TOUGH is always a complete outer shell. Part count controls how much of
		// that armour is visible through line width and opacity, not arc length.
		ctx.save();
		ctx.globalAlpha *= toughOpacity;
		strokeArc(ctx, ringRadius + ringWidth / 2 + toughWidth / 2, 0, 360, RENDER_COLORS.creep.tough, toughWidth);
		ctx.restore();
	}
	if (counts.move > 0) {
		const spanDegrees = counts.move * PART_ANGLE_DEGREES;
		strokeArc(ctx, ringRadius, 180 - spanDegrees / 2, 180 + spanDegrees / 2, RENDER_COLORS.creep.move, ringWidth);
	}
	for (let i = 0; i < TOP_PART_ORDER.length; i++) {
		let cumulativeParts = 0;
		for (let j = i; j < TOP_PART_ORDER.length; j++) cumulativeParts += counts[TOP_PART_ORDER[j].key] || 0;
		if (cumulativeParts <= 0) continue;
		const spanDegrees = cumulativeParts * PART_ANGLE_DEGREES;
		strokeArc(ctx, ringRadius, -spanDegrees / 2, spanDegrees / 2, TOP_PART_ORDER[i].color, ringWidth);
	}
	fillCircle(ctx, 18 * unit, innerColor || RENDER_COLORS.creep.inner);

	const store = object.store || {};
	const carriedResources = Object.keys(store).filter((resourceType) => store[resourceType] > 0);
	if (!carriedResources.length) return;
	const cargoColor = carriedResources.length === 1 && carriedResources[0] === 'energy'
		? RENDER_COLORS.resources.energy
		: RENDER_COLORS.resources.other;
	let cargoRadius = 6 * unit;
	const capacity = object.storeCapacity as number | undefined;
	if (typeof capacity === 'number' && capacity > 0) {
		let usedCapacity = 0;
		for (const resourceType of carriedResources) usedCapacity += store[resourceType];
		cargoRadius = (4 + 12 * Math.min(1, usedCapacity / capacity)) * unit;
	}
	fillCircle(ctx, cargoRadius, cargoColor);
}

function drawInvader(ctx: CanvasRenderingContext2D): void {
	// Native invader form normalized into a 0.95-tile square.
	const normalizedSize = 0.95;
	const points = [[24, 10], [8, 14], [8, 36], [24, 40], [56, 25]];
	ctx.scale(normalizedSize / 64, normalizedSize / 50);
	ctx.translate(-32, -25);
	ctx.beginPath();
	ctx.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
	ctx.closePath();
	ctx.strokeStyle = RENDER_COLORS.creep.invaderOutline;
	ctx.lineWidth = 8;
	ctx.lineJoin = 'miter';
	ctx.miterLimit = 6;
	ctx.stroke();
	ctx.fillStyle = RENDER_COLORS.creep.invaderBody;
	ctx.fill();
}

export class CreepRenderer {
	draw(ctx: CanvasRenderingContext2D, object: FrameObject, worldX: number, worldY: number, facingDegrees: number, opacity: number): void {
		ctx.save();
		ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
		ctx.translate(worldX + 0.5, worldY + 0.5);
		if (object.spawning === undefined || object.spawning !== true) {

			if (this.isNpc(object)) {
				ctx.rotate(facingDegrees * Math.PI / 180);
				drawInvader(ctx);
			} else {
				ctx.rotate((facingDegrees + 90) * Math.PI / 180);
				drawBody(ctx, object, this.isBot(object) ? RENDER_COLORS.ownership.bot : RENDER_COLORS.ownership.opponent);
			}
		}
		ctx.restore();
	}

	isBot(object: FrameObject): boolean { return object.my === true; }
	isNpc(object: FrameObject): boolean { return NPC_USERS.has(String(object.user)); }
}

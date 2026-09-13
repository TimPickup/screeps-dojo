import type { FrameObject, StageLayout } from '../api/types.ts';
import { lerp, tFx as effectProgressAt } from '../render/geometry.ts';
import { fillRenderText, parseRenderFont } from './renderFont.ts';
import { RENDER_COLORS, ROOM_SIZE_TILES } from './renderConstants.ts';

interface ActionTarget {
	x: number;
	y: number;
}

type ActionLog = Record<string, ActionTarget | undefined>;

interface WorldPosition {
	x: number;
	y: number;
}

export function drawHitPointsBar(
	ctx: CanvasRenderingContext2D,
	object: FrameObject,
	worldX: number,
	worldY: number,
	opacity: number,
): void {
	if (object.hits === undefined || !object.hitsMax || object.hits >= object.hitsMax) return;
	const hitPointFraction = Math.max(0, object.hits / object.hitsMax);
	ctx.save();
	ctx.globalAlpha = opacity;
	ctx.fillStyle = RENDER_COLORS.structure.medium;
	ctx.fillRect(worldX - 0.5, worldY - 0.85, 1.0, 0.15);
	ctx.fillStyle = RENDER_COLORS.health;
	ctx.fillRect(worldX - 0.5, worldY - 0.85, hitPointFraction, 0.15);
	ctx.restore();
}

// Speech bubble geometry, in tiles. The panel sits directly above the creep's
// tile with a short tail angled down-right at it, close enough to read as that
// creep's — the older, far higher box floated between the two rows.
const SPEECH = {
	fontSize: 0.42,
	// Advance of one character of the render font, as a fraction of font size.
	charWidth: 0.62,
	paddingX: 0.24,
	height: 0.72,
	corner: 0.3,
	// Gap between the tail's tip and the top of the creep's tile.
	tipGap: 0.1,
	tailLength: 0.3,
	tailBaseLeft: -0.15,
	tailBaseRight: 0.03,
	tailTipX: 0.14,
	border: 0.045,
} as const;

export function drawSpeechBubble(
	ctx: CanvasRenderingContext2D,
	message: string,
	worldX: number,
	worldY: number,
	isPublic = false,
): void {
	const content = String(message).slice(0, 10);
	const width = Math.max(0.9, content.length * SPEECH.charWidth * SPEECH.fontSize + 2 * SPEECH.paddingX);
	const centerX = worldX + 0.5;
	const bottom = worldY - SPEECH.tipGap - SPEECH.tailLength;
	const top = bottom - SPEECH.height;
	const left = centerX - width / 2, right = centerX + width / 2;
	const radius = Math.min(SPEECH.corner, SPEECH.height / 2, width / 2);
	// The tail is part of the same path as the panel, so the outline runs round
	// both without a seam where they meet.
	const baseRight = Math.min(centerX + SPEECH.tailBaseRight, right - radius);
	const baseLeft = Math.max(centerX + SPEECH.tailBaseLeft, left + radius);

	ctx.save();
	ctx.beginPath();
	ctx.moveTo(left + radius, top);
	ctx.lineTo(right - radius, top);
	ctx.arcTo(right, top, right, top + radius, radius);
	ctx.lineTo(right, bottom - radius);
	ctx.arcTo(right, bottom, right - radius, bottom, radius);
	ctx.lineTo(baseRight, bottom);
	ctx.lineTo(centerX + SPEECH.tailTipX, bottom + SPEECH.tailLength);
	ctx.lineTo(baseLeft, bottom);
	ctx.lineTo(left + radius, bottom);
	ctx.arcTo(left, bottom, left, bottom - radius, radius);
	ctx.lineTo(left, top + radius);
	ctx.arcTo(left, top, left + radius, top, radius);
	ctx.closePath();
	ctx.fillStyle = isPublic ? RENDER_COLORS.speech.publicBackground : RENDER_COLORS.speech.background;
	ctx.fill();
	ctx.strokeStyle = RENDER_COLORS.speech.border;
	ctx.lineWidth = SPEECH.border;
	ctx.lineJoin = 'round';
	ctx.stroke();

	ctx.fillStyle = RENDER_COLORS.speech.text;
	// Alphabetic baseline: drop it below the panel's centre by roughly a third of
	// the font size so the glyphs sit optically centred between the two edges.
	fillRenderText(ctx, content, centerX, (top + bottom) / 2 + SPEECH.fontSize * 0.35,
		parseRenderFont(SPEECH.fontSize), 'center');
	ctx.restore();
}

export function drawBeam(
	ctx: CanvasRenderingContext2D,
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	color: string,
	width: number,
	opacity = 0.85,
): void {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.globalAlpha = opacity;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(startX, startY);
	ctx.lineTo(endX, endY);
	ctx.stroke();
	ctx.restore();
}

// A null sub-frame gives effects their paused, solid appearance. Numeric
// sub-frames animate during the action half of a tick.
export function drawActionEffects(
	ctx: CanvasRenderingContext2D,
	object: FrameObject,
	worldX: number,
	worldY: number,
	subFrame: number | null,
	offsets: StageLayout['offsets'],
	roomName: string,
): void {
	const actionLog = object.actionLog as ActionLog | undefined;
	if (!actionLog) return;
	const roomOffset = offsets[roomName];
	if (!roomOffset) return;
	const centerX = worldX + 0.5, centerY = worldY + 0.5;
	const effectProgress = subFrame === null ? 1 : effectProgressAt(subFrame);
	const worldTarget = (target: ActionTarget): WorldPosition => ({
		x: roomOffset.col * ROOM_SIZE_TILES + target.x + 0.5,
		y: roomOffset.row * ROOM_SIZE_TILES + target.y + 0.5,
	});
	const drawAnimatedBeam = (target: ActionTarget, color: string, width: number): void => {
		const end = worldTarget(target);
		if (subFrame === null) {
			drawBeam(ctx, centerX, centerY, end.x, end.y, color, width);
			return;
		}
		const headProgress = effectProgress;
		const tailProgress = Math.max(0, headProgress - 0.18);
		drawBeam(
			ctx,
			lerp(centerX, end.x, tailProgress),
			lerp(centerY, end.y, tailProgress),
			lerp(centerX, end.x, headProgress),
			lerp(centerY, end.y, headProgress),
			color,
			width,
		);
	};

	if (actionLog.attack) {
		drawAnimatedBeam(actionLog.attack, RENDER_COLORS.actions.attack, 0.15);
		drawRing(ctx, worldTarget(actionLog.attack), 0.5, RENDER_COLORS.actions.attack);
	}
	if (actionLog.rangedAttack) drawAnimatedBeam(actionLog.rangedAttack, RENDER_COLORS.actions.attack, 0.1);
	if (actionLog.harvest) drawAnimatedBeam(actionLog.harvest, RENDER_COLORS.resources.energy, 0.1);
	if (actionLog.build) drawAnimatedBeam(actionLog.build, RENDER_COLORS.actions.build, 0.1);
	if (actionLog.repair) drawAnimatedBeam(actionLog.repair, RENDER_COLORS.actions.repair, 0.08);
	if (actionLog.dismantle) drawAnimatedBeam(actionLog.dismantle, RENDER_COLORS.actions.dismantle, 0.1);
	if (actionLog.upgradeController) drawAnimatedBeam(actionLog.upgradeController, RENDER_COLORS.resources.energy, 0.12);
	if (actionLog.heal) {
		if (actionLog.heal.x === object.x && actionLog.heal.y === object.y) {
			const radius = subFrame === null ? 0.6 : 0.55 + 0.1 * Math.sin(Math.PI * effectProgress);
			drawRing(ctx, { x: centerX, y: centerY }, radius, RENDER_COLORS.health);
		} else {
			drawAnimatedBeam(actionLog.heal, RENDER_COLORS.health, 0.1);
		}
	}
	if (actionLog.rangedHeal) drawAnimatedBeam(actionLog.rangedHeal, RENDER_COLORS.health, 0.08);
	if (actionLog.rangedMassAttack) {
		const radius = subFrame === null ? 3 : Math.max(0.2, 3 * effectProgress);
		ctx.save();
		ctx.strokeStyle = RENDER_COLORS.actions.rangedMassAttack;
		ctx.lineWidth = 0.1;
		ctx.globalAlpha = subFrame === null ? 0.5 : 0.8 * (1 - effectProgress);
		ctx.beginPath();
		ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}
}

function drawRing(
	ctx: CanvasRenderingContext2D,
	center: WorldPosition,
	radius: number,
	color: string,
): void {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = 0.08;
	ctx.globalAlpha = 0.8;
	ctx.beginPath();
	ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
}

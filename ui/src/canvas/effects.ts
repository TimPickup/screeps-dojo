import type { FrameObject, StageLayout } from '../api/types.ts';
import { lerp, tFx as effectProgressAt } from '../render/geometry.ts';
import { fillRenderText, parseRenderFont } from './renderFont.ts';
import { roundedRectPath } from './primitives.ts';
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

export function drawSpeechBubble(
	ctx: CanvasRenderingContext2D,
	message: string,
	worldX: number,
	worldY: number,
): void {
	const content = String(message).slice(0, 10);
	const width = Math.max(0.8, content.length * 0.32);
	ctx.save();
	ctx.fillStyle = RENDER_COLORS.speechBackground;
	roundedRectPath(ctx, worldX + 0.5 - width / 2, worldY - 1.5, width, 0.6, 0.1);
	ctx.fill();
	ctx.fillStyle = RENDER_COLORS.defaultFill;
	fillRenderText(ctx, content, worldX + 0.5, worldY - 1.05, parseRenderFont(0.5), 'center');
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

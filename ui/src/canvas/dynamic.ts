import type { FrameObject } from '../api/types.ts';
import { arc, circle, poly, rect, roundedRectPath, roundedSquare } from './primitives.ts';
import {
	CONSTRUCTION_SITE_RENDER_STYLE,
	CONTROLLER_LEVEL_PROGRESS,
	RENDER_COLORS,
	SOURCE_RENDER_STYLE,
} from './renderConstants.ts';

type CanvasContext = CanvasRenderingContext2D;
const TOWER_IDLE_ROTATION = Math.PI / 4;

export { CONTROLLER_LEVEL_PROGRESS as CONTROLLER_LEVELS } from './renderConstants.ts';

function clampFraction(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function energyFillFraction(object: FrameObject): number {
	const capacity = (object.storeCapacityResource as Record<string, number> | undefined)?.energy;
	if (!capacity || capacity <= 0) return 0;
	const energy = (object.store as Record<string, number> | undefined)?.energy || 0;
	return clampFraction(energy / capacity);
}

type TowerTarget = { x: number; y: number };

function towerActionTarget(object: FrameObject): TowerTarget | null {
	const actionLog = object.actionLog as Record<'attack' | 'heal' | 'repair', TowerTarget | null | undefined> | undefined;
	const target = actionLog && (actionLog.attack || actionLog.heal || actionLog.repair);
	return target && Number.isFinite(target.x) && Number.isFinite(target.y) ? target : null;
}

export function towerTurretAngle(object: FrameObject, replayTime: number): number {
	const target = towerActionTarget(object);
	if (target) {
		// The unrotated barrel points up, hence the quarter-turn offset from atan2.
		return Math.atan2(target.y - object.y, target.x - object.x) + Math.PI / 2;
	}
	return (Number.isFinite(replayTime) ? replayTime : 0) * TOWER_IDLE_ROTATION;
}

export function drawTowerTurret(
	ctx: CanvasContext,
	object: FrameObject,
	cx: number,
	cy: number,
	replayTime: number,
	energySource: FrameObject = object,
): void {
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(towerTurretAngle(object, replayTime));
	ctx.save();
	roundedRectPath(ctx, -0.4, -0.3, 0.8, 0.6, 0.12);
	ctx.clip();
	rect(ctx, -0.4, -0.3, 0.8, 0.6, { fill: RENDER_COLORS.structure.medium });
	const energyFraction = energyFillFraction(energySource);
	if (energyFraction > 0) {
		const height = 0.6 * energyFraction;
		rect(ctx, -0.4, 0.3 - height, 0.8, height, { fill: RENDER_COLORS.resources.energy });
	}
	ctx.restore();
	rect(ctx, -0.2, -0.9, 0.4, 0.5, { fill: RENDER_COLORS.structure.light, stroke: RENDER_COLORS.structure.dark, strokeWidth: 0.07 });
	ctx.restore();
}

export function storeFillFraction(object: FrameObject, resourceType?: string): number {
	const capacity = (object.storeCapacity as number | undefined) || 0;
	if (capacity <= 0) return 0;
	const store = (object.store as Record<string, number> | undefined) || {};
	let usedCapacity = 0;
	for (const storedResourceType of Object.keys(store)) {
		if (resourceType === storedResourceType || resourceType === undefined) usedCapacity += store[storedResourceType];
	}
	return clampFraction(usedCapacity / capacity);
}

export function drawExtensionFill(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const fillFraction = energyFillFraction(object);
	if (fillFraction === 0) return;
	if (fillFraction < 1) circle(ctx, cx, cy, { radius: 0.35, fill: RENDER_COLORS.structure.light });
	circle(ctx, cx, cy, { radius: 0.35 * fillFraction, fill: RENDER_COLORS.resources.energy });
}

export function drawLinkFill(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const fillFraction = clampFraction(((object.store as Record<string, number> | undefined)?.energy || 0) / 800);
	if (fillFraction <= 0) return;
	const diamond = [[0, -0.25], [0.20, 0], [0, 0.25], [-0.20, 0]];
	const inner = diamond.map((point) => [point[0] + cx, point[1] + cy]);
	poly(ctx, inner, { fill: RENDER_COLORS.structure.light });

	const innerFill = diamond.map((point) => [point[0] * fillFraction + cx, point[1] * fillFraction + cy]);
	poly(ctx, innerFill, { fill: RENDER_COLORS.resources.energy });
}

export function drawStorageFill(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const usedFraction = storeFillFraction(object);
	if (usedFraction <= 0) return;
	const energyFraction = storeFillFraction(object, 'energy');
	const powerFraction = storeFillFraction(object, 'power');
	const otherFraction = usedFraction - energyFraction - powerFraction;

	let yOffset = 0.45;
	if (energyFraction > 0) {
		rect(ctx, cx - 0.35, cy + yOffset - 0.9 * energyFraction, 0.7, 0.9 * energyFraction, { fill: RENDER_COLORS.resources.energy });
		yOffset -= 0.9 * energyFraction;
	}
	if (powerFraction > 0) {
		rect(ctx, cx - 0.35, cy + yOffset - 0.9 * powerFraction, 0.7, 0.9 * powerFraction, { fill: RENDER_COLORS.resources.power });
		yOffset -= 0.9 * powerFraction;
	}
	if (otherFraction > 0) {
		rect(ctx, cx - 0.35, cy + yOffset - 0.9 * otherFraction, 0.7, 0.9 * otherFraction, { fill: RENDER_COLORS.resources.other });
	}
}

export function drawTerminalFill(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const usedFraction = storeFillFraction(object);
	if (usedFraction <= 0) return;
	const energyFraction = storeFillFraction(object, 'energy');
	const powerFraction = storeFillFraction(object, 'power');
	const otherFraction = Math.max(0, usedFraction - energyFraction - powerFraction);
	const drawSquare = (fraction: number, fill: string): void => {
		const size = 0.9 * clampFraction(fraction);
		if (size <= 0) return;
		rect(ctx, cx - size / 2, cy - size / 2, size, size, { fill });
	};

	// Draw cumulative outer-to-inner layers. Each visible inner square replaces
	// the centre of the larger category beneath it.
	if (otherFraction > 0) drawSquare(energyFraction + powerFraction + otherFraction, RENDER_COLORS.resources.other);
	if (powerFraction > 0) drawSquare(energyFraction + powerFraction, RENDER_COLORS.resources.power);
	if (energyFraction > 0) drawSquare(energyFraction, RENDER_COLORS.resources.energy);
}

export function drawLabFill(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const store = (object.store as Record<string, number> | undefined) || {};
	const capacities = (object.storeCapacityResource as Record<string, number> | undefined) || {};
	const compoundType = Object.keys(store).find((type) => type !== 'energy' && store[type] > 0);

	if (compoundType) {
		const totalCapacity = (object.storeCapacity as number | undefined) || 0;
		const compoundCapacity = capacities[compoundType]
			|| (object.mineralCapacity as number | undefined)
			|| Math.max(0, totalCapacity - (capacities.energy || 0))
			|| 3000;
		const compoundFraction = clampFraction(store[compoundType] / compoundCapacity);
		if (compoundFraction > 0) {
			circle(ctx, cx, cy - 0.025 + (0.25 * (1 - compoundFraction)), { radius: 0.4 * compoundFraction, fill: RENDER_COLORS.resources.other });
		}
	}

	rect(ctx, cx - 0.425, cy + 0.3, 0.85, 0.215, { fill: RENDER_COLORS.black });

	const energyFraction = energyFillFraction(object);
	if (energyFraction > 0) {
		// Stay inside the ownership outline baked into the static lab shell.
		rect(ctx, cx - 0.425, cy + 0.375, 0.85 * energyFraction, 0.1, { fill: RENDER_COLORS.resources.energy });
	}
}

export function drawContainerFill(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const fillFraction = storeFillFraction(object);
	if (fillFraction <= 0) return;
	rect(ctx, cx - 0.17, cy + 0.27 - 0.2 * fillFraction, 0.34, 0.2 * fillFraction, { fill: RENDER_COLORS.resources.energy });
}

export function drawSourceCore(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const capacity = (object.energyCapacity as number | undefined) || 0;
	const fillFraction = capacity > 0 ? clampFraction(((object.energy as number | undefined) || 0) / capacity) : 0;
	if (fillFraction <= 0) return;
	// Shrinks towards the middle so the base's black outline always stays clear.
	roundedSquare(ctx, cx, cy, SOURCE_RENDER_STYLE.coreHalfSize * fillFraction, SOURCE_RENDER_STYLE.coreCornerRadius * fillFraction, {
		fill: RENDER_COLORS.resources.energy,
		opacity: SOURCE_RENDER_STYLE.coreOpacity,
	});
}

export function drawControllerProgress(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const progressTotal = CONTROLLER_LEVEL_PROGRESS[(object.level as number) || 0];
	const progressFraction = progressTotal ? Math.min(1, ((object.progress as number | undefined) || 0) / progressTotal) : 0;
	if (progressFraction <= 0) return;
	arc(ctx, cx, cy, 0.20, -Math.PI / 2, -Math.PI / 2 + progressFraction * Math.PI * 2,
		{ stroke: RENDER_COLORS.controller.progress, strokeWidth: 0.40 });
}

// One full pulse per tick. Driven by replay time rather than the wall clock so
// a scrubbed frame and an exported video frame render identically; a paused
// replay passes a whole tick and so sits at the peak, its static look.
export function constructionSitePulseOpacity(replayTime: number): number {
	const { pulsePeakOpacity, pulseTroughOpacity } = CONSTRUCTION_SITE_RENDER_STYLE;
	const phase = Number.isFinite(replayTime) ? replayTime : 0;
	const wave = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
	return pulseTroughOpacity + (pulsePeakOpacity - pulseTroughOpacity) * wave;
}

// An ownership-coloured ring filled by a progress wedge, pulsing so a site
// reads as pending rather than built. Never baked into the room tiles:
// progress changes every tick and the tile keys are deliberately progress-blind.
export function drawConstructionSite(
	ctx: CanvasContext,
	object: FrameObject,
	cx: number,
	cy: number,
	replayTime: number,
): void {
	const { radius, outlineWidth } = CONSTRUCTION_SITE_RENDER_STYLE;
	const color = object.my ? RENDER_COLORS.ownership.ownStructure : RENDER_COLORS.ownership.otherStructure;
	const opacity = constructionSitePulseOpacity(replayTime);
	circle(ctx, cx, cy, { radius, stroke: color, strokeWidth: outlineWidth, opacity });
	const progressTotal = (object.progressTotal as number | undefined) || 0;
	const progressFraction = progressTotal > 0
		? clampFraction(((object.progress as number | undefined) || 0) / progressTotal)
		: 0;
	if (progressFraction <= 0) return;
	// A stroke as wide as the span it covers paints a filled wedge, so centring
	// it half-way out fills from the middle to the ring's inner edge. Stopping
	// short of the ring keeps two translucent strokes of the same colour from
	// overlapping and compositing into a brighter band.
	const wedgeRadius = radius - outlineWidth / 2;
	arc(ctx, cx, cy, wedgeRadius / 2, -Math.PI / 2, -Math.PI / 2 + progressFraction * Math.PI * 2,
		{ stroke: color, strokeWidth: wedgeRadius, opacity });
}

export function drawSpawnFill(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const fillFraction = energyFillFraction(object);
	if (fillFraction <= 0) return;
	circle(ctx, cx, cy, { radius: 0.40 * fillFraction, fill: RENDER_COLORS.resources.energy });
}

export function drawSpawnProgress(ctx: CanvasContext, object: FrameObject, cx: number, cy: number, gameTime: number, subFrame: number): void {
	const spawning = object.spawning as { needTime?: number; spawnTime?: number } | undefined;
	if (!spawning || !spawning.needTime || spawning.needTime <= 0) return;
	const startTime = (spawning.spawnTime || 0) - spawning.needTime;
	const progressFraction = clampFraction((gameTime + subFrame - startTime) / spawning.needTime);
	if (progressFraction <= 0) return;
	arc(ctx, cx, cy, 0.52, -Math.PI / 2, -Math.PI / 2 + progressFraction * Math.PI * 2,
		{ stroke: RENDER_COLORS.defaultStroke, strokeWidth: 0.12, opacity: 0.85 });
}

// Tombstone: translucent rounded headstone outline + a dark X.
export function drawTombstone(ctx: CanvasContext, cx: number, cy: number): void {
	ctx.save();
	ctx.fillStyle = RENDER_COLORS.tombstone.body;
	ctx.strokeStyle = RENDER_COLORS.tombstone.outline;
	ctx.globalAlpha = 0.5;
	ctx.lineWidth = 0.05;
	ctx.beginPath();
	ctx.moveTo(cx - 0.25, cy + 0.25);
	ctx.lineTo(cx - 0.25, cy - 0.1);
	ctx.arc(cx, cy - 0.1, 0.25, Math.PI, 0); // top semicircle
	ctx.lineTo(cx + 0.25, cy + 0.25);
	ctx.closePath();
	ctx.fill(); ctx.stroke();
	ctx.strokeStyle = RENDER_COLORS.tombstone.mark;
	ctx.lineWidth = 0.05;
	ctx.beginPath();
	ctx.moveTo(cx - 0.1, cy - 0.1); ctx.lineTo(cx + 0.1, cy + 0.1);
	ctx.moveTo(cx - 0.1, cy + 0.1); ctx.lineTo(cx + 0.1, cy - 0.1);
	ctx.stroke();
	ctx.restore();
}

// Ruin: a low heap of grey rubble, with a resource dot on top while it still
// holds loot (a raided stronghold leaves ruins worth hauling).
export function drawRuin(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	ctx.save();
	ctx.globalAlpha = 0.8;
	ctx.fillStyle = RENDER_COLORS.ruin.rubble;
	ctx.strokeStyle = RENDER_COLORS.ruin.outline;
	ctx.lineWidth = 0.04;
	ctx.beginPath();
	ctx.moveTo(cx - 0.34, cy + 0.22);
	ctx.lineTo(cx - 0.24, cy - 0.04);
	ctx.lineTo(cx - 0.08, cy + 0.02);
	ctx.lineTo(cx + 0.02, cy - 0.2);
	ctx.lineTo(cx + 0.18, cy - 0.06);
	ctx.lineTo(cx + 0.32, cy - 0.1);
	ctx.lineTo(cx + 0.34, cy + 0.22);
	ctx.closePath();
	ctx.fill(); ctx.stroke();
	ctx.restore();
	const store = (object.store as Record<string, number> | undefined) || {};
	let amount = 0, top = 'energy', topAmount = 0;
	for (const resourceType of Object.keys(store)) {
		amount += store[resourceType];
		if (store[resourceType] > topAmount) { top = resourceType; topAmount = store[resourceType]; }
	}
	if (amount > 0) drawDroppedResource(ctx, cx, cy + 0.05, amount, top);
}

// Portal: a cyan swirl of rings.
export function drawPortal(ctx: CanvasContext, cx: number, cy: number): void {
	circle(ctx, cx, cy, { radius: 0.45, fill: RENDER_COLORS.portal.glow, opacity: 0.35 });
	circle(ctx, cx, cy, { radius: 0.34, stroke: RENDER_COLORS.portal.ring, strokeWidth: 0.07, opacity: 0.9 });
	circle(ctx, cx, cy, { radius: 0.17, stroke: RENDER_COLORS.portal.ring, strokeWidth: 0.05, opacity: 0.7 });
}

// Incoming nuke: its 5x5 blast area (NUKE_DAMAGE range 2) and a target mark.
export function drawNuke(ctx: CanvasContext, cx: number, cy: number): void {
	ctx.save();
	ctx.globalAlpha = 0.18;
	ctx.fillStyle = RENDER_COLORS.nuke.area;
	ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
	ctx.restore();
	// crosshair: four separate arms with a gap round the centre, reaching 20%
	// past the tile's edge
	ctx.save();
	ctx.strokeStyle = RENDER_COLORS.nuke.mark;
	ctx.lineWidth = 0.08;
	ctx.lineCap = 'butt';
	ctx.beginPath();
	for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
		ctx.moveTo(cx + dx * 0.22, cy + dy * 0.22);
		ctx.lineTo(cx + dx * 0.6, cy + dy * 0.6);
	}
	ctx.stroke();
	ctx.restore();
	circle(ctx, cx, cy, { radius: 0.08, fill: RENDER_COLORS.nuke.mark });
}

// What a dropped pile holds. The engine keeps the size in a field named after
// the resource (`energy: 747`, `H: 300`) — there is no `store` on one. A map
// (editor or import) writes `amount` instead, which the loader converts. A
// `store` is still read as a fallback for frames that carry one.
export function droppedPile(object: FrameObject): { resourceType: string; amount: number } {
	const resourceType = typeof object.resourceType === 'string' ? object.resourceType : 'energy';
	if (typeof object[resourceType] === 'number') return { resourceType, amount: object[resourceType] as number };
	if (typeof object.amount === 'number') return { resourceType, amount: object.amount };
	const store = (object.store as Record<string, number> | undefined) || {};
	let amount = 0;
	for (const key of Object.keys(store)) amount += Number(store[key]) || 0;
	return { resourceType: typeof object.resourceType === 'string' ? resourceType : Object.keys(store)[0] || 'energy', amount };
}

// Dropped resource dot.
export function drawDroppedResource(ctx: CanvasContext, cx: number, cy: number, amount: number, resourceType: string): void {
	const radius = 0.15 + 0.15 * Math.min(1, amount / 1000);
	circle(ctx, cx, cy, {
		radius,
		fill: resourceType === 'energy' ? RENDER_COLORS.resources.energy : RENDER_COLORS.resources.other,
		opacity: 0.85,
	});
}

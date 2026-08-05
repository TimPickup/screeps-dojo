import type { FrameObject } from '../api/types.ts';
import { arc, circle, poly, rect, roundedRectPath } from './primitives.ts';

type Ctx = CanvasRenderingContext2D;
const ENERGY = '#FFE87B';
const TOWER_IDLE_ROTATION = Math.PI / 4;

// Screeps controller progress totals (from @screeps/common constants).
export const CONTROLLER_LEVELS: Record<number, number> = {
	1: 200, 2: 45000, 3: 135000, 4: 405000, 5: 1215000, 6: 3645000, 7: 10935000, 8: 0,
};

export function energyFillFraction(o: FrameObject): number {
	const cap = (o.storeCapacityResource as Record<string, number> | undefined)?.energy;
	if (!cap || cap <= 0) return 0;
	const energy = (o.store as Record<string, number> | undefined)?.energy || 0;
	return Math.max(0, Math.min(1, energy / cap));
}

type TowerTarget = { x: number; y: number };

function towerActionTarget(o: FrameObject): TowerTarget | null {
	const log = o.actionLog as Record<'attack' | 'heal' | 'repair', TowerTarget | null | undefined> | undefined;
	const target = log && (log.attack || log.heal || log.repair);
	return target && Number.isFinite(target.x) && Number.isFinite(target.y) ? target : null;
}

export function towerTurretAngle(o: FrameObject, replayTime: number): number {
	const target = towerActionTarget(o);
	if (target) {
		// The unrotated barrel points up, hence the quarter-turn offset from atan2.
		return Math.atan2(target.y - o.y, target.x - o.x) + Math.PI / 2;
	}
	return (Number.isFinite(replayTime) ? replayTime : 0) * TOWER_IDLE_ROTATION;
}

export function drawTowerTurret(
	ctx: Ctx,
	o: FrameObject,
	cx: number,
	cy: number,
	replayTime: number,
	energySource: FrameObject = o,
) {
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(towerTurretAngle(o, replayTime));
	ctx.save();
	roundedRectPath(ctx, -0.4, -0.3, 0.8, 0.6, 0.12);
	ctx.clip();
	rect(ctx, -0.4, -0.3, 0.8, 0.6, { fill: '#555555' });
	const energyFraction = energyFillFraction(energySource);
	if (energyFraction > 0) {
		const height = 0.6 * energyFraction;
		rect(ctx, -0.4, 0.3 - height, 0.8, height, { fill: ENERGY });
	}
	ctx.restore();
	rect(ctx, -0.2, -0.9, 0.4, 0.5, { fill: '#AAAAAA', stroke: '#181818', strokeWidth: 0.07 });
	ctx.restore();
}

export function storeFillFraction(o: FrameObject, _optionalType?: string): number {
	const cap = (o.storeCapacity as number | undefined) || 0;
	if (cap <= 0) return 0;
	const store = (o.store as Record<string, number> | undefined) || {};
	let used = 0; for (const k of Object.keys(store)) if (_optionalType === k || _optionalType === undefined) used += store[k];
	return Math.max(0, Math.min(1, used / cap));
}

export function drawExtensionFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
	const f = energyFillFraction(o);
	if (f == 0) return;
	if (f < 1) circle(ctx, cx, cy, { radius: 0.35, fill: '#AAAAAA' });
	circle(ctx, cx, cy, { radius: 0.35 * f, fill: ENERGY });
}

export function drawLinkFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
	const f = Math.max(0, Math.min(1, ((o.store as Record<string, number> | undefined)?.energy || 0) / 800));
	if (f <= 0) return;
	const diamond = [[0, -0.25], [0.20, 0], [0, 0.25], [-0.20, 0]];
	const inner = diamond.map((p) => [p[0] + cx, p[1] + cy]);
	poly(ctx, inner, { fill: '#AAAAAA' });

	const innerFill = diamond.map((p) => [p[0] * f + cx, p[1] * f + cy]);
	poly(ctx, innerFill, { fill: ENERGY });
}

export function drawStorageFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
	const f = storeFillFraction(o);
	if (f <= 0) return;
	const energyPercent = storeFillFraction(o, 'energy');
	const powerPercent = storeFillFraction(o, 'power');
	const otherPercent = f - energyPercent - powerPercent;

	let yOffset = 0.45;
	if (energyPercent > 0) {
		rect(ctx, cx - 0.35, cy + yOffset - 0.9 * energyPercent, 0.7, 0.9 * energyPercent, { fill: ENERGY });
		yOffset -= 0.9 * energyPercent;
	}
	if (powerPercent > 0) {
		rect(ctx, cx - 0.35, cy + yOffset - 0.9 * powerPercent, 0.7, 0.9 * powerPercent, { fill: '#F00' });
		yOffset -= 0.9 * powerPercent;
	}
	if (otherPercent > 0) {
		rect(ctx, cx - 0.35, cy + yOffset - 0.9 * otherPercent, 0.7, 0.9 * otherPercent, { fill: '#FFF' });
	}

}

export function drawTerminalFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
	const usedPercent = storeFillFraction(o);
	if (usedPercent <= 0) return;
	const energyPercent = storeFillFraction(o, 'energy');
	const powerPercent = storeFillFraction(o, 'power');
	const otherPercent = Math.max(0, usedPercent - energyPercent - powerPercent);
	const square = (percent: number, fill: string) => {
		const size = 0.9 * Math.max(0, Math.min(1, percent));
		if (size <= 0) return;
		rect(ctx, cx - size / 2, cy - size / 2, size, size, { fill });
	};

	// Draw cumulative outer-to-inner layers. Each visible inner square replaces
	// the centre of the larger category beneath it.
	if (otherPercent > 0) square(energyPercent + powerPercent + otherPercent, '#FFF');
	if (powerPercent > 0) square(energyPercent + powerPercent, '#F00');
	if (energyPercent > 0) square(energyPercent, ENERGY);
}

export function drawLabFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
	const store = (o.store as Record<string, number> | undefined) || {};
	const capacities = (o.storeCapacityResource as Record<string, number> | undefined) || {};
	const compoundType = Object.keys(store).find((type) => type !== 'energy' && store[type] > 0);

	if (compoundType) {
		const totalCapacity = (o.storeCapacity as number | undefined) || 0;
		const compoundCapacity = capacities[compoundType]
			|| (o.mineralCapacity as number | undefined)
			|| Math.max(0, totalCapacity - (capacities.energy || 0))
			|| 3000;
		const compoundFraction = Math.max(0, Math.min(1, store[compoundType] / compoundCapacity));
		if (compoundFraction > 0) {
			circle(ctx, cx, cy - 0.025 + (0.25 * (1 - compoundFraction)), { radius: 0.4 * compoundFraction, fill: '#FFF' });
		}
	}

	rect(ctx, cx - 0.425, cy + 0.3, 0.85, 0.215, { fill: '#000' });

	const energyFraction = energyFillFraction(o);
	if (energyFraction > 0) {
		// Stay inside the ownership outline baked into the static lab shell.
		rect(ctx, cx - 0.425, cy + 0.375, 0.85 * energyFraction, 0.1, { fill: ENERGY });
	}
}

export function drawContainerFill(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
	const f = storeFillFraction(o);
	if (f <= 0) return;
	rect(ctx, cx - 0.17, cy + 0.27 - 0.2 * f, 0.34, 0.2 * f, { fill: ENERGY });
}

export function drawSourceCore(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
	const cap = (o.energyCapacity as number | undefined) || 0;
	const f = cap > 0 ? Math.max(0, Math.min(1, ((o.energy as number | undefined) || 0) / cap)) : 0;
	if (f > 0) circle(ctx, cx, cy, { radius: 0.32 * f, fill: ENERGY, opacity: 0.95 });
}

export function drawControllerProgress(ctx: Ctx, o: FrameObject, cx: number, cy: number) {
	const total = CONTROLLER_LEVELS[(o.level as number) || 0];
	const f = total ? Math.min(1, ((o.progress as number | undefined) || 0) / total) : 0;
	if (f <= 0) return;
	arc(ctx, cx, cy, 0.20, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2,
		{ stroke: '#ffffff7c', strokeWidth: 0.40 });
}

export function drawSpawnProgress(ctx: Ctx, o: FrameObject, cx: number, cy: number, gameTime: number, sub: number) {
	const sp = o.spawning as { needTime?: number; spawnTime?: number } | undefined;
	if (!sp || !sp.needTime || sp.needTime <= 0) return;
	const start = (sp.spawnTime || 0) - sp.needTime;
	const f = Math.max(0, Math.min(1, (gameTime + sub - start) / sp.needTime));
	if (f <= 0) return;
	arc(ctx, cx, cy, 0.52, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2,
		{ stroke: '#ffffff', strokeWidth: 0.12, opacity: 0.85 });
}

// Tombstone: rounded headstone + dark cross.
export function drawTombstone(ctx: Ctx, cx: number, cy: number) {
	ctx.save();
	ctx.fillStyle = '#9a9a9a'; ctx.strokeStyle = '#555555'; ctx.lineWidth = 0.04;
	ctx.beginPath();
	ctx.moveTo(cx - 0.25, cy + 0.25);
	ctx.lineTo(cx - 0.25, cy - 0.1);
	ctx.arc(cx, cy - 0.1, 0.25, Math.PI, 0); // top semicircle
	ctx.lineTo(cx + 0.25, cy + 0.25);
	ctx.closePath();
	ctx.fill(); ctx.stroke();
	ctx.strokeStyle = '#444444'; ctx.lineWidth = 0.05;
	ctx.beginPath();
	ctx.moveTo(cx, cy - 0.22); ctx.lineTo(cx, cy + 0.1);
	ctx.moveTo(cx - 0.1, cy - 0.12); ctx.lineTo(cx + 0.1, cy - 0.12);
	ctx.stroke();
	ctx.restore();
}

// Dropped resource dot.
export function drawDroppedResource(ctx: Ctx, cx: number, cy: number, amount: number, resourceType: string) {
	const radius = 0.15 + 0.15 * Math.min(1, amount / 1000);
	circle(ctx, cx, cy, { radius, fill: resourceType === 'energy' ? ENERGY : '#ffffff', opacity: 0.85 });
}

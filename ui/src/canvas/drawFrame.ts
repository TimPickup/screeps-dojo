import type { Recording, Frame, FrameObject, StageLayout } from '../api/types.ts';
import {
	creepFacing,
	lerp,
	nextLocal as nextLocalPosition,
	tFx as effectProgressAt,
	tPos as movementProgressAt,
} from '../render/geometry.ts';
import { StaticLayers } from './caches.ts';
import { CreepRenderer } from './creeps.ts';
import {
	drawExtensionFill, drawLinkFill, drawStorageFill, drawTerminalFill, drawLabFill, drawContainerFill, drawTowerTurret,
	drawSourceCore, drawControllerProgress, drawSpawnFill, drawSpawnProgress, drawTombstone, drawDroppedResource,
} from './dynamic.ts';
import { drawActionEffects, drawBeam, drawHitPointsBar, drawSpeechBubble } from './effects.ts';
import { RENDER_COLORS, ROOM_SIZE_TILES } from './renderConstants.ts';
import { frameObjectsInDrawOrder } from './renderOrder.ts';
import { drawUserVisuals } from './roomVisuals.ts';

interface DrawOptions {
	sprites: CreepRenderer;
	layers: StaticLayers;
	layout: StageLayout;
	showVisuals: boolean;
}

interface ActionTarget {
	x: number;
	y: number;
}

interface RenderActionLog {
	attack?: ActionTarget;
	harvest?: ActionTarget;
	say?: { message?: unknown };
	transferEnergy?: ActionTarget;
}

// Draws one frame (tick) at `subFrame` (null = paused/scrub static look;
// a number in [0,1) = animating).
// Works in TILE coordinates — the caller has applied the world→screen transform.
export function drawFrame(
	ctx: CanvasRenderingContext2D,
	recording: Recording,
	tick: number,
	subFrame: number | null,
	options: DrawOptions,
): void {
	const { sprites: creepRenderer, layout } = options;
	const frames = recording.frames;
	const frameIndex = Math.max(0, Math.min(frames.length - 1, tick));
	const baseFrame = frames[frameIndex];
	const nextFrame = subFrame !== null && frameIndex + 1 < frames.length ? frames[frameIndex + 1] : null;
	options.layers.prepare(baseFrame);
	if (nextFrame) options.layers.prepare(nextFrame);
	const offsets = layout.offsets;
	const widthInTiles = (layout.width / layout.pixelsPerRoom) * ROOM_SIZE_TILES;
	const heightInTiles = (layout.height / layout.pixelsPerRoom) * ROOM_SIZE_TILES;
	const baseObjectsInDrawOrder = frameObjectsInDrawOrder(baseFrame, layout);
	const nextObjectsInDrawOrder = nextFrame ? frameObjectsInDrawOrder(nextFrame, layout) : null;

	// 1) static layers (client-side, synchronous — never black)
	ctx.drawImage(options.layers.terrain, 0, 0, widthInTiles, heightInTiles);
	options.layers.drawSwamps(ctx, frameIndex + (subFrame ?? 0));
	ctx.drawImage(options.layers.structure, 0, 0, widthInTiles, heightInTiles);

	// world tile coords for a room-local position
	const worldPosition = (roomName: string, x: number, y: number) => {
		const roomOffset = offsets[roomName];
		return roomOffset
			? { worldX: roomOffset.col * ROOM_SIZE_TILES + x, worldY: roomOffset.row * ROOM_SIZE_TILES + y }
			: null;
	};

	const nextObjectsById = nextFrame ? indexById(nextFrame.objects) : null;
	const baseObjectsById = indexById(baseFrame.objects);
	// tiles each creep transferred/withdrew with this tick, for the nod (below)
	const nodTargets = nextFrame ? transferNods(nextFrame, nextObjectsById!) : {};

	// 2) creeps (interpolated) + HP + effects
	for (const object of baseObjectsInDrawOrder) {
		if (object.type !== 'creep') continue;
		if (object.spawning) {
			const releasedObject = nextObjectsById?.[object._id];
			const nextCreep = releasedObject && !releasedObject.spawning ? releasedObject : null;
			const targetPosition = nextCreep ? nextLocalPosition(object, nextCreep, layout) : object;
			const movementProgress = nextCreep ? movementProgressAt(subFrame as number) : 0;
			const position = worldPosition(
				object.room,
				lerp(object.x, targetPosition.x, movementProgress),
				lerp(object.y, targetPosition.y, movementProgress),
			);
			if (!position) continue;
			creepRenderer.draw(ctx, nextCreep || object, position.worldX, position.worldY,
				nextCreep ? creepFacing(frames, frameIndex, object._id, layout) : 0, 1);
			continue;
		}
		let x = object.x, y = object.y, opacity = 1;
		let actionSource: FrameObject = object;
		if (nextFrame) {
			const nextObject = nextObjectsById![object._id];
			if (nextObject && (nextObject.room === object.room || offsets[nextObject.room])) {
				const nextPosition = nextLocalPosition(object, nextObject, layout);
				const movementProgress = movementProgressAt(subFrame as number);
				x = lerp(object.x, nextPosition.x, movementProgress);
				y = lerp(object.y, nextPosition.y, movementProgress);
				actionSource = nextObject;
				// work/attack bob during the action half; transfer/withdraw nod toward
				// the tile the creep exchanged with (nodTargets — pickup isn't recorded)
				const actionLog = nextObject.actionLog as RenderActionLog | undefined;
				const bobTarget = (actionLog && (actionLog.harvest || actionLog.attack)) || nodTargets[object._id];
				if (bobTarget) {
					const dx = bobTarget.x - x, dy = bobTarget.y - y;
					const distance = Math.hypot(dx, dy);
					if (distance > 0) {
						const amplitude = 0.15 * Math.sin(Math.PI * effectProgressAt(subFrame as number));
						x += amplitude * dx / distance;
						y += amplitude * dy / distance;
					}
				}
			} else {
				opacity = 1 - (subFrame as number); // died/left layout: fade
			}
		}
		const position = worldPosition(object.room, x, y);
		if (!position) continue;
		const facing = creepFacing(frames, frameIndex, object._id, layout);
		creepRenderer.draw(ctx, object, position.worldX, position.worldY, facing, opacity);
		drawHitPointsBar(ctx, object, position.worldX, position.worldY, opacity);
		const baseActionLog = object.actionLog as RenderActionLog | undefined;
		if (baseActionLog?.say?.message) {
			drawSpeechBubble(ctx, String(baseActionLog.say.message), position.worldX, position.worldY);
		}
		drawActionEffects(ctx, actionSource, position.worldX, position.worldY, subFrame, offsets, object.room);
	}
	// creeps that appear only next frame (spawned): fade in
	if (nextFrame) {
		for (const nextObject of nextObjectsInDrawOrder!) {
			if (nextObject.type !== 'creep' || nextObject.spawning || baseObjectsById[nextObject._id]) continue;
			const position = worldPosition(nextObject.room, nextObject.x, nextObject.y);
			if (!position) continue;
			creepRenderer.draw(
				ctx,
				nextObject,
				position.worldX,
				position.worldY,
				creepFacing(frames, frameIndex + 1, nextObject._id, layout),
				subFrame as number,
			);
		}
	}

	// 2b) towers: live energy fill + attack/heal/repair beams. Towers are baked
	//     into the per-epoch background (epochKey excludes energy), so their
	//     current fill and per-tick actions must be drawn here on top. Beams reuse
	//     the creep effect renderer — tower actionLog keys (attack/heal/repair)
	//     are a subset of the creep ones, so they read identically.
	for (const object of baseObjectsInDrawOrder) {
		if (object.type !== 'tower') continue;
		const position = worldPosition(object.room, object.x, object.y);
		if (!position) continue;
		// actionLog lives on the structure doc; prefer the next frame's (the
		// transition being animated), matching the link-beam approach.
		const nextObject = nextObjectsById ? nextObjectsById[object._id] : null;
		const actionSource = nextObject || object;
		// Energy belongs to the rotating turret assembly, but its amount comes
		// from the base frame just like the other interpolated structure fills.
		drawTowerTurret(
			ctx,
			actionSource,
			position.worldX + 0.5,
			position.worldY + 0.5,
			baseFrame.gameTime + (subFrame ?? 0),
			object,
		);
		drawActionEffects(ctx, actionSource, position.worldX, position.worldY, subFrame, offsets, object.room);
	}

	// 2c) spawns: live energy core. Like towers, spawns are baked into the per-
	//     epoch background (which is energy-blind), but the background draws only
	//     the dark base — so the yellow core (scaled by fill, hidden when empty)
	//     is painted here on top and stays accurate as the spawn fills/drains.
	for (const object of baseObjectsInDrawOrder) {
		if (object.type !== 'spawn') continue;
		const position = worldPosition(object.room, object.x, object.y);
		if (!position) continue;
		drawSpawnFill(ctx, object, position.worldX + 0.5, position.worldY + 0.5);
	}

	// 2d) live structure fills, source cores, controller progress, spawn arcs,
	//     link beams — all energy-blind in the baked structure layer, so drawn here.
	for (const object of baseObjectsInDrawOrder) {
		const position = worldPosition(object.room, object.x, object.y);
		if (!position) continue;
		const centerX = position.worldX + 0.5, centerY = position.worldY + 0.5;
		switch (object.type) {
			case 'extension': drawExtensionFill(ctx, object, centerX, centerY); break;
			case 'storage': drawStorageFill(ctx, object, centerX, centerY); break;
			case 'terminal': drawTerminalFill(ctx, object, centerX, centerY); break;
			case 'lab': drawLabFill(ctx, object, centerX, centerY); break;
			case 'container': drawContainerFill(ctx, object, centerX, centerY); break;
			case 'source': drawSourceCore(ctx, object, centerX, centerY); break;
			case 'controller': drawControllerProgress(ctx, object, centerX, centerY); break;
			case 'link': {
				drawLinkFill(ctx, object, centerX, centerY);
				const nextObject = nextObjectsById ? nextObjectsById[object._id] : null;
				const actionLog = (nextObject || object).actionLog as RenderActionLog | undefined;
				if (actionLog?.transferEnergy) {
					const roomOffset = offsets[object.room];
					const targetX = roomOffset.col * ROOM_SIZE_TILES + actionLog.transferEnergy.x + 0.5;
					const targetY = roomOffset.row * ROOM_SIZE_TILES + actionLog.transferEnergy.y + 0.5;
					drawBeam(ctx, centerX, centerY, targetX, targetY, RENDER_COLORS.resources.energy, 0.12);
				}
				break;
			}
			case 'spawn':
				drawSpawnProgress(ctx, object, centerX, centerY, baseFrame.gameTime, subFrame === null ? 0 : subFrame);
				break;
			case 'tombstone': drawTombstone(ctx, centerX, centerY); break;
			case 'energy': case 'resource': {
				const store = (object.store as Record<string, number> | undefined) || {};
				let amount = 0;
				for (const resourceType of Object.keys(store)) amount += store[resourceType];
				const resourceType = (object.resourceType as string) || Object.keys(store)[0] || 'energy';
				drawDroppedResource(ctx, centerX, centerY, amount, resourceType);
				break;
			}
		}
	}

	// 3) bot's own RoomVisual draws, on top (drawn from the recording's raw
	//    command strings — no server round-trip; instant toggle)
	if (options.showVisuals && baseFrame.visuals) {
		for (const roomName of Object.keys(baseFrame.visuals)) {
			const roomOffset = offsets[roomName];
			if (!roomOffset) continue;
			// +0.5 shifts tile-centred RoomVisual coordinates to the canvas grid.
			drawUserVisuals(
				ctx,
				baseFrame.visuals[roomName],
				roomOffset.col * ROOM_SIZE_TILES + 0.5,
				roomOffset.row * ROOM_SIZE_TILES + 0.5,
			);
		}
	}

	// 4) cached ramparts are deliberately the final overlay, above structures,
	// creeps, effects, resources, and user RoomVisuals.
	if (options.layers.rampart) {
		ctx.drawImage(options.layers.rampart, 0, 0, widthInTiles, heightInTiles);
	}
}

function indexById(objects: FrameObject[]): Record<string, FrameObject> {
	const objectsById: Record<string, FrameObject> = {};
	for (const object of objects) objectsById[object._id] = object;
	return objectsById;
}

// Creeps that transferred/withdrew this tick, mapped to the tile they exchanged
// with, so the sprite can lean toward it (a "nod"). The engine records these
// ONLY as EVENT_TRANSFER (12) in the room event log — transfer sets
// objectId=creep, targetId=target; withdraw reverses them — so neither appears
// in actionLog. Read from the NEXT frame's log (the transition being animated).
// Pickup emits no event, so it produces no nod.
function transferNods(frame: Frame, objectsById: Record<string, FrameObject>): Record<string, { x: number; y: number }> {
	const targetTotals: Record<string, { sumX: number; sumY: number; count: number }> = {};
	if (!frame.eventLog) return {};
	for (const roomName of Object.keys(frame.eventLog)) {
		const events = frame.eventLog[roomName];
		if (!Array.isArray(events)) continue;
		for (const event of events as Array<{ event: number; objectId: string; data?: { targetId?: string } }>) {
			if (!event || event.event !== 12) continue; // EVENT_TRANSFER
			const sourceObject = objectsById[event.objectId];
			const targetObject = event.data?.targetId ? objectsById[event.data.targetId] : undefined;
			let creep: FrameObject | undefined, target: FrameObject | undefined;
			if (sourceObject?.type === 'creep') { creep = sourceObject; target = targetObject; }
			else if (targetObject?.type === 'creep') { creep = targetObject; target = sourceObject; }
			if (!creep || !target) continue;
			// A creep can transfer AND withdraw in the same tick (two events) — lean
			// toward the average of every tile it exchanged with, not just the last.
			const totals = targetTotals[creep._id]
				|| (targetTotals[creep._id] = { sumX: 0, sumY: 0, count: 0 });
			totals.sumX += target.x;
			totals.sumY += target.y;
			totals.count++;
		}
	}
	const nods: Record<string, { x: number; y: number }> = {};
	for (const objectId in targetTotals) {
		const totals = targetTotals[objectId];
		nods[objectId] = { x: totals.sumX / totals.count, y: totals.sumY / totals.count };
	}
	return nods;
}

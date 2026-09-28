import type { Recording, Frame, FrameObject, StageLayout } from '../api/types.ts';
import {
	creepFacing,
	lerp,
	lerpAngle,
	nextLocal as nextLocalPosition,
	tFx as effectProgressAt,
	tPos as movementProgressAt,
	tTurn as turnProgressAt,
} from '../render/geometry.ts';
import { StaticLayers } from './caches.ts';
import { detailLevel, visibleRooms } from './renderView.ts';
import type { RenderView } from './renderView.ts';
import { CreepRenderer, NPC_USERS, fillCreepDots } from './creeps.ts';
import type { CreepDot } from './creeps.ts';
import {
	drawExtensionFill, drawLinkFill, drawStorageFill, drawTerminalFill, drawLabFill, drawContainerFill, drawTowerTurret,
	drawSourceCore, drawControllerProgress, drawSpawnFill, drawSpawnProgress, drawTombstone, drawRuin, drawPortal, drawNuke, drawDroppedResource, droppedPile,
	drawConstructionSite,
} from './dynamic.ts';
import { drawActionEffects, drawBeam, drawHitPointsBar, drawSpeechBubble } from './effects.ts';
import { drawReactor, drawUnknownObject } from './modObjects.ts';
import type { ModImages } from './modImages.ts';
import { drawSpawnFlare } from './powerCreeps.ts';
import { activeEffects, drawEffectFlares, drawEffectPips } from './powerEffects.ts';
import type { ActiveEffect } from './powerEffects.ts';
import type { PowerImages } from './powerImages.ts';
import { CULL_MARGIN_TILES, KNOWN_OBJECT_TYPES, RENDER_COLORS, ROOM_SIZE_TILES, isCreepLike } from './renderConstants.ts';
import { frameObjectsInDrawOrder } from './renderOrder.ts';
import { drawMapVisuals } from './mapVisuals.ts';
import { drawUserVisuals } from './roomVisuals.ts';
import { objectIndex } from './roomIndex.ts';

interface DrawOptions {
	sprites: CreepRenderer;
	layers: StaticLayers;
	layout: StageLayout;
	showVisuals: boolean;
	// The bot's Game.map.visual draws, laid over the whole stage. Off unless asked.
	showMapVisuals?: boolean;
	// Sweep creeps into a new heading over the first part of the tick instead of
	// snapping them round. The caller decides: worth it at ordinary replay
	// speeds, a flicker beyond SMOOTH_TURN_MAX_SPEED.
	smoothTurns?: boolean;
	// Artwork a loaded mod brings (see modImages.ts). Optional everywhere: every
	// drawing routine falls back to vectors, so a recording still renders if the
	// images never loaded.
	modImages?: ModImages;
	// Official power icons (see powerImages.ts). Optional everywhere: usePower's
	// icon pop falls back to a vector badge when unloaded or the power has no
	// artwork.
	powerImages?: PowerImages;
	// What is on screen and at what zoom (see renderView.ts). Absent (the video
	// renderer, tests): every room at full detail and full resolution.
	view?: RenderView;
}

interface ActionTarget {
	x: number;
	y: number;
}

interface RenderActionLog {
	attack?: ActionTarget;
	heal?: ActionTarget;
	repair?: ActionTarget;
	harvest?: ActionTarget;
	say?: { message?: unknown; isPublic?: boolean };
	transferEnergy?: ActionTarget;
	spawned?: boolean;
}

interface LiveEffectTarget {
	worldX: number;
	worldY: number;
	effects: ActiveEffect[];
}

// Reused across drawFrame calls: the flare pass (2e) calls activeEffects()
// exactly once per object and records the live ones here; the pip pass (4b),
// after the rampart overlay, reads them back instead of recomputing
// activeEffects() (which re-scans, re-filters and re-sorts the object's raw
// effects, and — for the index-keyed shape, Ruling F — re-allocates via
// Object.values) a second time for the same object on the same frame. Reset
// by truncating its length each call rather than replacing it, so a frame
// with nothing live allocates no array here at all.
const liveEffectTargets: LiveEffectTarget[] = [];

// Creep dots for the zoomed-out creep pass, reused across calls the same way.
const creepDots: CreepDot[] = [];

// Dot radius in tiles below full detail: a little larger at minimal so a creep
// stays visible at one or two device pixels per tile.
const SIMPLE_CREEP_DOT_RADIUS = 0.45;
const MINIMAL_CREEP_DOT_RADIUS = 0.6;

// (room, x, y) -> is that tile on screen or within CULL_MARGIN_TILES of it.
type CullTest = (roomName: string, x: number, y: number) => boolean;

// Draws one frame (tick) at `subFrame` (null = paused/scrub static look;
// a number in [0,1) = animating).
// Works in TILE coordinates — the caller has applied the world→screen transform.
// With options.view, objects off screen are skipped and detail drops as the map
// zooms out (see detailLevel); without one, everything draws at full detail.
export function drawFrame(
	ctx: CanvasRenderingContext2D,
	recording: Recording,
	tick: number,
	requestedSubFrame: number | null,
	options: DrawOptions,
): void {
	const { sprites: creepRenderer, layout } = options;
	const detail = detailLevel(options.view);
	const inView = cullTest(options.view, layout);
	// At minimal detail a creep is a dot a pixel or two across: per-tick
	// positions are enough, so draw the tick's own state with no interpolation.
	const subFrame = detail === 'minimal' ? null : requestedSubFrame;
	const frames = recording.frames;
	const frameIndex = Math.max(0, Math.min(frames.length - 1, tick));
	const baseFrame = frames[frameIndex];
	const nextFrame = subFrame !== null && frameIndex + 1 < frames.length ? frames[frameIndex + 1] : null;
	// The frame that closes the tick STARTING here. A bot says and draws at the
	// start of a tick, from the world as it stood then, but the recorder stamps
	// both onto the frame captured after that tick ran — so frame N+1 carries
	// the speech, RoomVisuals and actionLog of the transition that leaves frame
	// N, and they belong on screen with the state they were computed from. The
	// action effects already read the next frame while animating; reading them
	// here as well means a paused frame looks exactly like the instant playback
	// resumes. The last frame has nothing after it — and the live view is always
	// on the last frame — so it falls back to its own.
	const tickFrame = frames[frameIndex + 1] || baseFrame;
	options.layers.prepare(baseFrame);
	if (nextFrame) options.layers.prepare(nextFrame);
	const offsets = layout.offsets;
	const baseObjectsInDrawOrder = frameObjectsInDrawOrder(baseFrame, layout);
	const nextObjectsInDrawOrder = nextFrame ? frameObjectsInDrawOrder(nextFrame, layout) : null;

	// 1) static layers: per-room tiles (see caches.ts). Without a view they are
	//    built synchronously; with one, a missing tile falls back to a coarser one.
	options.layers.drawTerrain(ctx, options.view);
	options.layers.drawSwamps(ctx, frameIndex + (subFrame ?? 0), options.view);
	options.layers.drawStructures(ctx, options.view);

	// world tile coords for a room-local position
	const worldPosition = (roomName: string, x: number, y: number) => {
		const roomOffset = offsets[roomName];
		return roomOffset
			? { worldX: roomOffset.col * ROOM_SIZE_TILES + x, worldY: roomOffset.row * ROOM_SIZE_TILES + y }
			: null;
	};

	// Cached per frame (roomIndex.ts): the same frames are drawn many animation
	// frames in a row, so the ~3,700-entry index isn't rebuilt each call.
	const baseObjectsById = objectIndex(baseFrame);
	const tickObjectsById = objectIndex(tickFrame);
	const nextObjectsById = nextFrame ? tickObjectsById : null;
	// A creep is on screen if either end of this tick's move is: one sliding in
	// from just off screen draws for the whole glide.
	const creepInView = (object: FrameObject): boolean => {
		if (inView(object.room, object.x, object.y)) return true;
		const nextObject = nextObjectsById?.get(object._id);
		return nextObject !== undefined && inView(nextObject.room, nextObject.x, nextObject.y);
	};

	if (detail === 'full') {
		// 2) creeps (interpolated) + HP + effects
		// tiles each creep transferred/withdrew with this tick, for the nod (below)
		const nodTargets = nextFrame ? transferNods(tickFrame, tickObjectsById) : {};
		for (const object of baseObjectsInDrawOrder) {
			if (!isCreepLike(object.type)) continue;
			if (!creepInView(object)) continue;
			if (object.spawning) {
				const releasedObject = nextObjectsById?.get(object._id);
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
					nextCreep ? turnedFacing(frames, frameIndex, object._id, layout, subFrame, options.smoothTurns) : 0, 1);
				continue;
			}
			let x = object.x, y = object.y, opacity = 1;
			// Everything this creep did in the tick that leaves this frame (tickFrame).
			const actionSource: FrameObject = tickObjectsById.get(object._id) || object;
			if (nextFrame) {
				const nextObject = nextObjectsById!.get(object._id);
				if (nextObject && (nextObject.room === object.room || offsets[nextObject.room])) {
					const nextPosition = nextLocalPosition(object, nextObject, layout);
					const movementProgress = movementProgressAt(subFrame as number);
					x = lerp(object.x, nextPosition.x, movementProgress);
					y = lerp(object.y, nextPosition.y, movementProgress);
					// work/attack bob during the action half; transfer/withdraw nod toward
					// the tile the creep exchanged with (nodTargets — pickup isn't recorded)
					const actionLog = actionSource.actionLog as RenderActionLog | undefined;
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
			const facing = turnedFacing(frames, frameIndex, object._id, layout, subFrame, options.smoothTurns);
			creepRenderer.draw(ctx, object, position.worldX, position.worldY, facing, opacity);
			drawHitPointsBar(ctx, object, position.worldX, position.worldY, opacity);
			const speech = (actionSource.actionLog as RenderActionLog | undefined)?.say;
			if (speech?.message) {
				drawSpeechBubble(ctx, String(speech.message), position.worldX, position.worldY, speech.isPublic === true);
			}
			drawActionEffects(ctx, actionSource, position.worldX, position.worldY, subFrame, offsets, object.room, options.powerImages);
		}
		// creeps that appear only next frame (spawned): fade in
		if (nextFrame) {
			for (const nextObject of nextObjectsInDrawOrder!) {
				if (!isCreepLike(nextObject.type) || nextObject.spawning || baseObjectsById.has(nextObject._id)) continue;
				if (!inView(nextObject.room, nextObject.x, nextObject.y)) continue;
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
				// A power creep's first appearance is its spawn flare: the engine's
				// `spawned` flag sits on this next frame's actionLog, but the creep
				// itself isn't in baseFrame yet for drawActionEffects to see it there.
				// Require that flag, not just "new this frame" — a power creep can
				// also newly appear by walking in from an unrecorded room, or by
				// being placed mid-run, neither of which is a spawn.
				const nextActionLog = nextObject.actionLog as RenderActionLog | undefined;
				if (nextObject.type === 'powerCreep' && nextActionLog?.spawned) {
					drawSpawnFlare(ctx, position.worldX + 0.5, position.worldY + 0.5, subFrame as number);
				}
			}
		}
	} else {
		// 2) zoomed out: creeps are coloured dots. HP bars, speech, action
		//    effects, bob/nod, the turn sweep and the spawn flare are all
		//    sub-tile detail at this size, so none of them draw.
		creepDots.length = 0;
		collectCreepDots(creepDots, baseObjectsInDrawOrder, nextObjectsInDrawOrder, baseObjectsById, nextObjectsById,
			subFrame, layout, creepInView);
		fillCreepDots(ctx, creepDots, detail === 'simple' ? SIMPLE_CREEP_DOT_RADIUS : MINIMAL_CREEP_DOT_RADIUS);
	}

	// 2b) towers: live energy fill + attack/heal/repair beams. Towers are baked
	//     into the per-epoch background (epochKey excludes energy), so their
	//     current fill and per-tick actions must be drawn here on top. Beams reuse
	//     the creep effect renderer — tower actionLog keys (attack/heal/repair)
	//     are a subset of the creep ones, so they read identically.
	// 2b-2d draw at full and simple detail: fills and beams still read at a few
	// pixels per tile. At minimal detail a room is a smudge of pixels, so they
	// are skipped along with everything else but the creep dots.
	if (detail !== 'minimal') for (const object of baseObjectsInDrawOrder) {
		if (object.type !== 'tower') continue;
		// actionLog lives on the structure doc; take the tick that leaves this
		// frame (tickFrame), matching the link-beam approach.
		const actionSource = tickObjectsById.get(object._id) || object;
		// A tower beam crosses up to a room: keep it while its target is on
		// screen even if the tower itself is not.
		if (!inView(object.room, object.x, object.y)
			&& !actionTargetInView(actionSource.actionLog as RenderActionLog | undefined, object.room, inView)) continue;
		const position = worldPosition(object.room, object.x, object.y);
		if (!position) continue;
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
		drawActionEffects(ctx, actionSource, position.worldX, position.worldY, subFrame, offsets, object.room, options.powerImages);
	}

	// 2c) spawns: live energy core. Like towers, spawns are baked into the per-
	//     epoch background (which is energy-blind), but the background draws only
	//     the dark base — so the yellow core (scaled by fill, hidden when empty)
	//     is painted here on top and stays accurate as the spawn fills/drains.
	if (detail !== 'minimal') for (const object of baseObjectsInDrawOrder) {
		if (object.type !== 'spawn') continue;
		if (!inView(object.room, object.x, object.y)) continue;
		const position = worldPosition(object.room, object.x, object.y);
		if (!position) continue;
		drawSpawnFill(ctx, object, position.worldX + 0.5, position.worldY + 0.5);
	}

	// 2d) live structure fills, source cores, controller progress, spawn arcs,
	//     link beams — all energy-blind in the baked structure layer, so drawn here.
	//     Construction sites join them: the baked layer is progress-blind too, and
	//     theirs advances every tick.
	if (detail !== 'minimal') for (const object of baseObjectsInDrawOrder) {
		if (!inView(object.room, object.x, object.y)
			&& !(object.type === 'link' && actionTargetInView(
				(tickObjectsById.get(object._id) || object).actionLog as RenderActionLog | undefined, object.room, inView))) continue;
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
				const actionLog = (tickObjectsById.get(object._id) || object).actionLog as RenderActionLog | undefined;
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
			case 'constructionSite':
				drawConstructionSite(ctx, object, centerX, centerY, baseFrame.gameTime + (subFrame ?? 0));
				break;
			case 'tombstone': drawTombstone(ctx, centerX, centerY); break;
			case 'ruin': drawRuin(ctx, object, centerX, centerY); break;
			case 'portal': drawPortal(ctx, centerX, centerY); break;
			case 'nuke': drawNuke(ctx, centerX, centerY); break;
			// Season 5. Drawn per frame rather than baked into the structure
			// layer: its edge turns, and it starts and stops turning as Thorium
			// arrives and burns away.
			case 'reactor':
				drawReactor(ctx, object, centerX, centerY, baseFrame.gameTime + (subFrame ?? 0), options.modImages);
				break;
			case 'energy': case 'resource': {
				const pile = droppedPile(object);
				drawDroppedResource(ctx, centerX, centerY, pile.amount, pile.resourceType);
				break;
			}
			default:
				// An object type from a mod this renderer has no artwork for. It
				// still belongs on the map.
				if (!KNOWN_OBJECT_TYPES.has(object.type)) drawUnknownObject(ctx, object, centerX, centerY);
				break;
		}
	}

	// 2e) active power effect flares. activeEffects() first: stronghold
	//     structures all carry never-pruned effect 1002, so compute a position
	//     (which allocates) only for objects with a LIVE power effect. Uses
	//     baseFrame.gameTime, like the construction-site pulse and the
	//     inspector, so the canvas and inspector drop an effect on the same tick.
	//     activeEffects() runs exactly once per object here; its result (and
	//     the object's position) is kept in liveEffectTargets for the pip pass
	//     below, rather than recomputed there.
	//     Full detail only: flares and pips are icon-sized ornaments that vanish
	//     below it.
	liveEffectTargets.length = 0;
	if (detail === 'full') for (const object of baseObjectsInDrawOrder) {
		if (!object.effects) continue;
		if (!inView(object.room, object.x, object.y)) continue;
		const effects = activeEffects(object, baseFrame.gameTime);
		if (effects.length === 0) continue;
		const position = worldPosition(object.room, object.x, object.y);
		if (!position) continue;
		liveEffectTargets.push({ worldX: position.worldX, worldY: position.worldY, effects });
		drawEffectFlares(ctx, effects, position.worldX, position.worldY, baseFrame.gameTime, subFrame);
	}

	// 3) bot's own RoomVisual draws, on top (drawn from the recording's raw
	//    command strings — no server round-trip; instant toggle)
	//    Skipped at minimal detail (lines and text below a few pixels per tile
	//    are noise), and per room when the room is off screen: a visual can
	//    draw anywhere in its room, so it is culled by room, not position.
	if (options.showVisuals && tickFrame.visuals && detail !== 'minimal') {
		const roomsInView = visibleRooms(layout, expandedView(options.view));
		for (const roomName of Object.keys(tickFrame.visuals)) {
			const roomOffset = offsets[roomName];
			if (!roomOffset || !roomsInView.has(roomName)) continue;
			// +0.5 shifts tile-centred RoomVisual coordinates to the canvas grid.
			drawUserVisuals(
				ctx,
				tickFrame.visuals[roomName],
				roomOffset.col * ROOM_SIZE_TILES + 0.5,
				roomOffset.row * ROOM_SIZE_TILES + 0.5,
			);
		}
	}

	// 4) cached ramparts are deliberately the final overlay, above structures,
	// creeps, effects, resources, and user RoomVisuals.
	options.layers.drawRamparts(ctx, options.view);

	// 4b) active power effect corner pips: the final pass, after the rampart
	//     overlay, so SHIELD and FORTIFY targets (ramparts and walls) don't
	//     tint over them. Replays liveEffectTargets from the flare pass (2e)
	//     above — no re-walk of baseObjectsInDrawOrder, no second activeEffects().
	//     Empty below full detail, where 2e records nothing.
	for (const target of liveEffectTargets) {
		drawEffectPips(ctx, target.effects, target.worldX, target.worldY, options.powerImages);
	}

	// 5) bot's Game.map.visual draws: a map-scale overlay above the rooms
	//    themselves, as the game client's world map shows them. Drawn at every
	//    detail level: they are map-scale by design, made for zoomed-out viewing.
	if (options.showMapVisuals && tickFrame.mapVisuals) {
		drawMapVisuals(ctx, tickFrame.mapVisuals, offsets);
	}
}

// Where a creep is pointing at `subFrame`. It sweeps from the heading it held
// through the previous tick into this one's over the first TURN_FRACTION, then
// holds — so the turn lands before the glide starts. A creep with no previous
// heading (it just spawned, or the recording starts here) simply faces its new
// one; nothing spins up from an angle it never held.
function turnedFacing(
	frames: Frame[],
	frameIndex: number,
	objectId: string,
	layout: StageLayout,
	subFrame: number | null,
	smoothTurns?: boolean,
): number {
	const facing = creepFacing(frames, frameIndex, objectId, layout);
	if (!smoothTurns || subFrame === null) return facing;
	const previous = creepFacing(frames, frameIndex - 1, objectId, layout, facing);
	return previous === facing ? facing : lerpAngle(previous, facing, turnProgressAt(subFrame));
}

// The view grown by CULL_MARGIN_TILES on every side, so HP bars, speech
// bubbles and creeps sliding in from just off screen still draw.
function expandedView(view: RenderView | undefined): RenderView | undefined {
	if (!view) return undefined;
	return {
		minX: view.minX - CULL_MARGIN_TILES,
		minY: view.minY - CULL_MARGIN_TILES,
		maxX: view.maxX + CULL_MARGIN_TILES,
		maxY: view.maxY + CULL_MARGIN_TILES,
		pixelsPerTile: view.pixelsPerTile,
	};
}

// Culling by position, not by room: a tile draws when it overlaps the expanded
// view. Without a view (video export, tests) everything draws.
function cullTest(view: RenderView | undefined, layout: StageLayout): CullTest {
	const bounds = expandedView(view);
	if (!bounds) return () => true;
	const offsets = layout.offsets;
	return (roomName, x, y) => {
		const roomOffset = offsets[roomName];
		if (!roomOffset) return false;
		const worldX = roomOffset.col * ROOM_SIZE_TILES + x, worldY = roomOffset.row * ROOM_SIZE_TILES + y;
		return worldX + 1 > bounds.minX && worldX < bounds.maxX && worldY + 1 > bounds.minY && worldY < bounds.maxY;
	};
}

// Whether a structure's beam target (tower attack/heal/repair, link transfer)
// is in view, so a beam whose source is off screen still draws.
function actionTargetInView(actionLog: RenderActionLog | undefined, roomName: string, inView: CullTest): boolean {
	if (!actionLog) return false;
	const target = actionLog.attack || actionLog.heal || actionLog.repair || actionLog.transferEnergy;
	return target !== undefined && inView(roomName, target.x, target.y);
}

// Zoomed-out creeps as dots. Positions follow the full pass's movement
// interpolation (so simple-detail dots still glide) but skip the bob/nod, the
// fade and the turn sweep. `subFrame` is already null at minimal detail.
function collectCreepDots(
	dots: CreepDot[],
	baseObjects: FrameObject[],
	nextObjects: FrameObject[] | null,
	baseObjectsById: ReadonlyMap<string, FrameObject>,
	nextObjectsById: ReadonlyMap<string, FrameObject> | null,
	subFrame: number | null,
	layout: StageLayout,
	creepInView: (object: FrameObject) => boolean,
): void {
	const offsets = layout.offsets;
	const movementProgress = subFrame === null ? 0 : movementProgressAt(subFrame);
	const pushDot = (drawnObject: FrameObject, roomName: string, x: number, y: number): void => {
		const roomOffset = offsets[roomName];
		if (!roomOffset) return;
		dots.push({
			x: roomOffset.col * ROOM_SIZE_TILES + x + 0.5,
			y: roomOffset.row * ROOM_SIZE_TILES + y + 0.5,
			my: drawnObject.my === true,
			npc: NPC_USERS.has(String(drawnObject.user)),
		});
	};
	for (const object of baseObjects) {
		if (!isCreepLike(object.type) || !creepInView(object)) continue;
		const nextObject = nextObjectsById?.get(object._id);
		// A creep still spawning has no body on the map yet; the full renderer
		// draws nothing for it until the tick it is released.
		if (object.spawning && (!nextObject || nextObject.spawning)) continue;
		if (nextObject && (nextObject.room === object.room || offsets[nextObject.room])) {
			const nextPosition = nextLocalPosition(object, nextObject, layout);
			pushDot(object.spawning ? nextObject : object, object.room,
				lerp(object.x, nextPosition.x, movementProgress), lerp(object.y, nextPosition.y, movementProgress));
		} else {
			pushDot(object, object.room, object.x, object.y);
		}
	}
	// Creeps that appear only next frame (spawned or walked in).
	if (nextObjects) {
		for (const nextObject of nextObjects) {
			if (!isCreepLike(nextObject.type) || nextObject.spawning || baseObjectsById.has(nextObject._id)) continue;
			if (!creepInView(nextObject)) continue;
			pushDot(nextObject, nextObject.room, nextObject.x, nextObject.y);
		}
	}
}

// Creeps that transferred/withdrew this tick, mapped to the tile they exchanged
// with, so the sprite can lean toward it (a "nod"). The engine records these
// ONLY as EVENT_TRANSFER (12) in the room event log — transfer sets
// objectId=creep, targetId=target; withdraw reverses them — so neither appears
// in actionLog. Read from the NEXT frame's log (the transition being animated).
// Pickup emits no event, so it produces no nod.
function transferNods(frame: Frame, objectsById: ReadonlyMap<string, FrameObject>): Record<string, { x: number; y: number }> {
	const targetTotals: Record<string, { sumX: number; sumY: number; count: number }> = {};
	if (!frame.eventLog) return {};
	for (const roomName of Object.keys(frame.eventLog)) {
		const events = frame.eventLog[roomName];
		if (!Array.isArray(events)) continue;
		for (const event of events as Array<{ event: number; objectId: string; data?: { targetId?: string } }>) {
			if (!event || event.event !== 12) continue; // EVENT_TRANSFER
			const sourceObject = objectsById.get(event.objectId);
			const targetObject = event.data?.targetId ? objectsById.get(event.data.targetId) : undefined;
			let creep: FrameObject | undefined, target: FrameObject | undefined;
			if (sourceObject && isCreepLike(sourceObject.type)) { creep = sourceObject; target = targetObject; }
			else if (targetObject && isCreepLike(targetObject.type)) { creep = targetObject; target = sourceObject; }
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

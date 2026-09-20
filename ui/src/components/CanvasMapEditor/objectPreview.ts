// Draws editor objects with the game's own artwork.
//
// One routine, three callers: the palette icon, the ghost under the cursor, and
// the loose-object pass over the main canvas. They share it so the thing you
// pick in the palette, the thing you see under the mouse, and the thing that
// lands on the map are unmistakably the same object.

import type { Frame, FrameObject, StageLayout } from '../../api/types';
import { drawMergedWalls, drawStaticStructures } from '../../canvas/staticLayers';
import { drawConstructionSite, drawDroppedResource, drawSourceCore, drawTombstone, drawTowerTurret } from '../../canvas/dynamic';
import { drawReactor } from '../../canvas/modObjects';
import { drawRamparts } from '../../canvas/ramparts';
import { CreepRenderer } from '../../canvas/creeps';
import { populateFrameMy } from '../../canvas/ownership';
import { computeStageLayout } from '../../render/geometry';
import type { TerrainTextures } from '../../canvas/terrainTextures';
import type { ModImages } from '../../canvas/modImages';
import { BODY_PART_HITS } from './gameData';
import { bodyToSegments, segmentsToParts } from './bodyModel';
import { creepCapacity } from './storeRules';
import type { EditableObject } from './mapModel';

export interface PreviewOptions {
	terrainTextures?: TerrainTextures | null;
	modImages?: ModImages;
	creeps?: CreepRenderer;
	// Terrain for the room, needed only so a constructedWall merges into the
	// natural walls around it exactly as it does on the map.
	terrain?: Record<string, string[]>;
}

// The engine's NPC user ids. A map writes the owner as a label; the creep
// renderer picks the invader silhouette off the raw id, so the two have to be
// reconciled or an imported invader draws as an ordinary creep.
export const NPC_USER_IDS: Record<string, string> = { invader: '2', sourceKeeper: '3' };

function amountOf(object: FrameObject): number {
	const store = object.store as Record<string, number> | undefined;
	if (!store) return 0;
	let total = 0;
	for (const key of Object.keys(store)) total += Number(store[key]) || 0;
	return total;
}

// An editable object as the renderer's FrameObject. Creeps get their body
// expanded into the engine's `[{ type, hits }]` docs, because that is what the
// creep renderer counts parts off.
export function toFrameObject(object: EditableObject, room: string, index: number): FrameObject {
	const { owner, ...renderFields } = object;
	const output = {
		...renderFields,
		_id: String(object._id || object.id || `editor-${index}`),
		type: object.type,
		room,
		x: object.x,
		y: object.y,
	} as FrameObject;
	if (output.user === undefined && owner !== undefined) output.user = NPC_USER_IDS[owner] ?? owner;
	if (object.type === 'source') {
		const capacity = typeof object.energyCapacity === 'number' ? object.energyCapacity : 3000;
		output.energyCapacity = capacity;
		if (typeof object.energy !== 'number') output.energy = capacity;
	}
	if (object.type === 'creep') {
		output.body = segmentsToParts(bodyToSegments(object.body, object.boosts)).map((part) => (
			part.boost
				? { type: part.part, hits: BODY_PART_HITS, boost: part.boost }
				: { type: part.part, hits: BODY_PART_HITS }
		));
		output.storeCapacity = creepCapacity(object.body, object.boosts);
	}
	// A dropped pile keeps its size in a field named after the resource; the
	// renderer reads `store`, so mirror it for drawing only.
	if (object.type === 'energy' && typeof object.amount === 'number') {
		output.store = { [String(object.resourceType || 'energy')]: object.amount };
	}
	return output;
}

// Everything in a frame, in the order the replay draws it.
export function drawPreviewFrame(
	ctx: CanvasRenderingContext2D,
	frame: Frame,
	layout: StageLayout,
	options: PreviewOptions = {},
): void {
	const creeps = options.creeps || sharedCreepRenderer;
	drawMergedWalls(ctx, options.terrain || {}, frame, layout, options.terrainTextures?.wallNoise);
	drawStaticStructures(ctx, frame, layout, options.modImages);
	for (const object of frame.objects) {
		const roomOffset = layout.offsets[object.room];
		if (!roomOffset) continue;
		const cx = roomOffset.col * 50 + object.x + 0.5;
		const cy = roomOffset.row * 50 + object.y + 0.5;
		if (object.type === 'tower') drawTowerTurret(ctx, object, cx, cy, frame.gameTime);
		else if (object.type === 'reactor') drawReactor(ctx, object, cx, cy, frame.gameTime, options.modImages);
		else if (object.type === 'source') drawSourceCore(ctx, object, cx, cy);
		else if (object.type === 'energy' || object.type === 'resource') {
			const store = object.store as Record<string, number> | undefined;
			const resource = store ? Object.keys(store)[0] || 'energy' : 'energy';
			drawDroppedResource(ctx, cx, cy, amountOf(object) || 1, resource);
		} else if (object.type === 'tombstone' || object.type === 'ruin') drawTombstone(ctx, cx, cy);
		// A static pulse: the editor has no clock, so it draws the peak.
		else if (object.type === 'constructionSite') drawConstructionSite(ctx, object, cx, cy, 0);
		else if (object.type === 'creep') {
			creeps.draw(ctx, object, roomOffset.col * 50 + object.x, roomOffset.row * 50 + object.y, 0, 1);
		}
	}
	drawRamparts(ctx, frame, layout);
}

const sharedCreepRenderer = new CreepRenderer();
const ICON_LAYOUT: StageLayout = computeStageLayout(['W1N1']);
// A controller and a spawn both draw wider than their tile, so the icon shows
// 1.9 tiles' worth of room and centres the object in it.
const ICON_TILES = 1.9;

// One object, alone, filling `size` device-independent pixels. Used for the
// palette rows; `sample` is the object the palette would actually place, so a
// lab icon is a lab and a creep icon is a creep with a body.
export function drawObjectIcon(
	canvas: HTMLCanvasElement,
	sample: EditableObject,
	size: number,
	options: PreviewOptions = {},
	// Extra objects drawn alongside, for types whose artwork comes from their
	// neighbours (a road draws as a dot until there is something to join to).
	neighbours: EditableObject[] = [],
): void {
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	canvas.width = Math.max(1, Math.round(size * dpr));
	canvas.height = Math.max(1, Math.round(size * dpr));
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	const scale = size * dpr / ICON_TILES;
	ctx.setTransform(scale, 0, 0, scale, 0, 0);
	// Put the object's own tile in the middle of the visible square.
	ctx.translate((ICON_TILES - 1) / 2 - sample.x, (ICON_TILES - 1) / 2 - sample.y);

	const object = { ...sample };
	const frame = populateFrameMy({
		gameTime: 0,
		objects: object.type === 'flag'
			? []
			: [object, ...neighbours].map((entry, index) => toFrameObject(entry, 'W1N1', index)),
		flags: object.type === 'flag' ? [{ room: 'W1N1', name: '', x: object.x, y: object.y }] : [],
	});
	// A lone constructedWall needs terrain to merge against, or the island
	// builder has nothing to draw.
	const terrain = object.type === 'constructedWall'
		? { W1N1: Array.from({ length: 50 }, () => '.'.repeat(50)) }
		: {};
	drawPreviewFrame(ctx, frame, ICON_LAYOUT, { ...options, terrain });
}

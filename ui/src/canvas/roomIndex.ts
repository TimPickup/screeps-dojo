import type { Frame, FrameObject, StageLayout } from '../api/types.ts';
import { STATIC_LAYER_OBJECT_TYPES } from './renderConstants.ts';
import { frameObjectsInDrawOrder } from './renderOrder.ts';

// ---- Per-room object index and per-room change keys ----
// The static map is cached per room, so a frame change must say which rooms'
// tiles went stale. Each key covers exactly what one cached tile draws:
//   structure: static structure types (minus walls) + that room's flags
//   rampart:   rampart position, owner side and public flag
//   terrain:   constructed-wall positions (walls draw in the terrain tile)

// Constructed walls draw in the terrain pass, so they key the terrain tile, not
// the structure tile; moving a wall must not rebuild the structure tile.
const ROOM_STRUCTURE_TYPES: ReadonlySet<string> = new Set(
	[...STATIC_LAYER_OBJECT_TYPES].filter((type) => type !== 'constructedWall'),
);

// Same size as renderOrder.ts: covers the interpolation/scrub window. A WeakMap
// keyed by frame would live as long as the recording (every frame) and hold an
// index plus key strings per frame: hundreds of MB on a long huge-map run.
const RECENT_FRAME_CACHE_SIZE = 4;

interface CachedRoomIndex {
	frame: Frame;
	byRoom: Map<string, FrameObject[]>;
	structureKeys?: Map<string, string>;
	rampartKeys?: Map<string, string>;
	terrainKeys?: Map<string, string>;
}

interface CachedIdIndex {
	frame: Frame;
	byId: Map<string, FrameObject>;
}

const recentRoomIndexesByLayout = new WeakMap<StageLayout, CachedRoomIndex[]>();
// objectById has no layout, so it keeps its own list of the same size.
const recentIdIndexes: CachedIdIndex[] = [];

// The part strings use the same fields as caches.ts epochKey/rampartEpochKey
// (they build their whole-map keys from these), so a per-room key changes
// exactly when that room's share of the old whole-map key changes.
export function structureKeyPart(object: FrameObject): string {
	return object.type + ',' + object.room + ',' + object.x + ',' + object.y + ','
		+ (object.level ?? '') + ',' + (object.user ?? '') + ',' + (object.depositType ?? '');
}

export function flagKeyPart(flag: unknown): string {
	return 'flag,' + JSON.stringify(flag);
}

// `my` is render-only ownership: the caller must run populateFrameMy first.
export function rampartKeyPart(object: FrameObject): string {
	return [
		object.room,
		object.x,
		object.y,
		object.my ? 'own' : 'other',
		object.isPublic === true ? 'public' : 'private',
	].join(',');
}

function wallKeyPart(object: FrameObject): string {
	return object.room + ',' + object.x + ',' + object.y;
}

// 32-bit FNV-1a over UTF-16 code units. Keys are stored hashed because a joined
// part string for a busy room runs to tens of KB, and 108 rooms x 3 keys x 4
// cached frames of those adds up. The part count is kept alongside the hash so
// `0:` marks an empty room without a lookup, and a collision would also need
// the same number of parts.
function fnv1a32(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function keyFromParts(parts: string[]): string {
	parts.sort();
	return parts.length + ':' + fnv1a32(parts.join('|'));
}

function roomIndexEntry(frame: Frame, layout: StageLayout): CachedRoomIndex {
	const recent = recentRoomIndexesByLayout.get(layout) || [];
	const cached = recent.find((entry) => entry.frame === frame);
	if (cached) return cached;

	// One (possibly empty) list per laid-out room, so every room gets a key.
	// Objects in rooms outside the layout have nowhere to draw and are dropped.
	const byRoom = new Map<string, FrameObject[]>();
	for (const room of Object.keys(layout.offsets)) byRoom.set(room, []);
	for (const object of frameObjectsInDrawOrder(frame, layout)) {
		byRoom.get(object.room)?.push(object);
	}
	const entry: CachedRoomIndex = { frame, byRoom };
	recent.push(entry);
	if (recent.length > RECENT_FRAME_CACHE_SIZE) recent.shift();
	recentRoomIndexesByLayout.set(layout, recent);
	return entry;
}

function keysByRoom(
	byRoom: Map<string, FrameObject[]>,
	partsFor: (objects: FrameObject[]) => string[],
	extraParts?: Map<string, string[]>,
): Map<string, string> {
	const keys = new Map<string, string>();
	for (const [room, objects] of byRoom) {
		const parts = partsFor(objects);
		const extra = extraParts?.get(room);
		if (extra) parts.push(...extra);
		keys.set(room, keyFromParts(parts));
	}
	return keys;
}

// Objects of each laid-out room, in draw order.
export function objectsByRoom(frame: Frame, layout: StageLayout): Map<string, FrameObject[]> {
	return roomIndexEntry(frame, layout).byRoom;
}

export function roomStructureKeys(frame: Frame, layout: StageLayout): Map<string, string> {
	const entry = roomIndexEntry(frame, layout);
	if (entry.structureKeys) return entry.structureKeys;
	const flagParts = new Map<string, string[]>();
	for (const flag of frame.flags || []) {
		const room = (flag as { room?: unknown } | null)?.room;
		if (typeof room !== 'string' || !entry.byRoom.has(room)) continue;
		const parts = flagParts.get(room);
		if (parts) parts.push(flagKeyPart(flag));
		else flagParts.set(room, [flagKeyPart(flag)]);
	}
	entry.structureKeys = keysByRoom(entry.byRoom, (objects) => {
		const parts: string[] = [];
		for (const object of objects) {
			if (ROOM_STRUCTURE_TYPES.has(object.type)) parts.push(structureKeyPart(object));
		}
		return parts;
	}, flagParts);
	return entry.structureKeys;
}

// A key starting `0:` means the room has no ramparts to draw.
export function roomRampartKeys(frame: Frame, layout: StageLayout): Map<string, string> {
	const entry = roomIndexEntry(frame, layout);
	if (entry.rampartKeys) return entry.rampartKeys;
	entry.rampartKeys = keysByRoom(entry.byRoom, (objects) => {
		const parts: string[] = [];
		for (const object of objects) {
			if (object.type === 'rampart') parts.push(rampartKeyPart(object));
		}
		return parts;
	});
	return entry.rampartKeys;
}

export function roomTerrainKeys(frame: Frame, layout: StageLayout): Map<string, string> {
	const entry = roomIndexEntry(frame, layout);
	if (entry.terrainKeys) return entry.terrainKeys;
	entry.terrainKeys = keysByRoom(entry.byRoom, (objects) => {
		const parts: string[] = [];
		for (const object of objects) {
			if (object.type === 'constructedWall') parts.push(wallKeyPart(object));
		}
		return parts;
	});
	return entry.terrainKeys;
}

// Every object in the frame by `_id` (creeps, structures, everything). Shares
// the recent-frames cache with objectById, so drawFrame's per-animation-frame
// lookups reuse one index per frame rather than rebuilding it every call.
export function objectIndex(frame: Frame): ReadonlyMap<string, FrameObject> {
	let cached = recentIdIndexes.find((entry) => entry.frame === frame);
	if (!cached) {
		const byId = new Map<string, FrameObject>();
		for (const object of frame.objects) byId.set(object._id, object);
		cached = { frame, byId };
		recentIdIndexes.push(cached);
		if (recentIdIndexes.length > RECENT_FRAME_CACHE_SIZE) recentIdIndexes.shift();
	}
	return cached.byId;
}

// Any object in the frame by `_id` (creeps, structures, everything).
export function objectById(frame: Frame, id: string): FrameObject | undefined {
	return objectIndex(frame).get(id);
}

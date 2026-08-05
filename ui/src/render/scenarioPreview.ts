import type { Frame, FrameObject, ScenarioMapFile, StageLayout } from '../api/types';
import { computeStageLayout } from './geometry';

type JsonObject = Record<string, unknown>;

export interface PreviewFlag {
  room: string;
  name: string;
  x: number;
  y: number;
}

export interface ScenarioPreviewScene {
  terrain: Record<string, string[]>;
  frame: Frame;
  layout: StageLayout;
  mapCount: number;
  duplicateRooms: string[];
  errors: string[];
}

const ROOM_RE = /^([WE])(\d+)([NS])(\d+)$/;

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validTerrain(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === 50
    && value.every((row) => typeof row === 'string' && row.length === 50);
}

function finitePosition(value: JsonObject): value is JsonObject & { x: number; y: number } {
  return typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y);
}

function frameObject(value: unknown, fallbackType: string | null, room: string, generatedId: string): FrameObject | null {
  if (!isObject(value) || !finitePosition(value)) return null;
  const type = typeof value.type === 'string' ? value.type : fallbackType;
  if (!type) return null;
  const object = {
    ...value,
    _id: String(value._id ?? value.id ?? generatedId),
    type,
    x: value.x,
    y: value.y,
    room,
  } as FrameObject;
  // Map files use the friendly owner tags understood by dojoWorld; frame
  // renderers use `user`. Keeping both makes ownership-aware drawing possible.
  if (object.user === undefined && value.owner !== undefined) object.user = String(value.owner);
  if (type === 'source') {
    const capacity = typeof value.energyCapacity === 'number' ? value.energyCapacity : 3000;
    object.energyCapacity = capacity;
    if (typeof value.energy !== 'number') object.energy = capacity;
  }
  return object;
}

/** Convert editor map JSON into the same terrain/frame shape used by replays. */
export function buildScenarioPreviewScene(files: ScenarioMapFile[]): ScenarioPreviewScene | null {
  const errors: string[] = [];
  const duplicateRooms = new Set<string>();
  const byRoom = new Map<string, { path: string; map: JsonObject }>();

  for (const file of files) {
    if (!isObject(file.map)) {
      errors.push(file.path + ': map must be an object');
      continue;
    }
    const room = file.map.room;
    if (typeof room !== 'string' || !ROOM_RE.test(room)) {
      errors.push(file.path + ': invalid room name');
      continue;
    }
    if (!validTerrain(file.map.terrain)) {
      errors.push(file.path + ': terrain must contain 50 rows of 50 tiles');
      continue;
    }
    if (byRoom.has(room)) duplicateRooms.add(room);
    // A world layout cannot show two maps at the same coordinate. File order is
    // stable, so the later path wins deterministically and the UI reports it.
    byRoom.set(room, { path: file.path, map: file.map });
  }

  if (byRoom.size === 0) return null;

  const terrain: Record<string, string[]> = {};
  const objects: FrameObject[] = [];
  const flags: PreviewFlag[] = [];
  let generated = 0;

  for (const [room, entry] of byRoom) {
    const map = entry.map;
    terrain[room] = (map.terrain as string[]).slice();
    const structures = Array.isArray(map.structures) ? map.structures : [];
    let hasController = false;
    for (const raw of structures) {
      const object = frameObject(raw, null, room, `preview-${generated++}`);
      if (!object) continue;
      if (object.type === 'controller') hasController = true;
      objects.push(object);
    }
    for (const raw of (Array.isArray(map.sources) ? map.sources : [])) {
      const object = frameObject(raw, 'source', room, `preview-${generated++}`);
      if (object) objects.push(object);
    }
    for (const raw of (Array.isArray(map.minerals) ? map.minerals : [])) {
      const object = frameObject(raw, 'mineral', room, `preview-${generated++}`);
      if (object) objects.push(object);
    }
    if (!hasController && map.controller) {
      const object = frameObject(map.controller, 'controller', room, `preview-${generated++}`);
      if (object) objects.push(object);
    }
    for (const raw of (Array.isArray(map.flags) ? map.flags : [])) {
      if (!isObject(raw) || !finitePosition(raw)) continue;
      flags.push({ room, name: typeof raw.name === 'string' ? raw.name : 'flag', x: raw.x, y: raw.y });
    }
  }

  const rooms = Object.keys(terrain);
  return {
    terrain,
    frame: { gameTime: 0, objects, flags },
    layout: computeStageLayout(rooms),
    mapCount: files.length,
    duplicateRooms: Array.from(duplicateRooms).sort(),
    errors,
  };
}

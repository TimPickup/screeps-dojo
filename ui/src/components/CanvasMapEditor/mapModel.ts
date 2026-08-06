export interface EditableObject extends Record<string, unknown> {
  type: string;
  x: number;
  y: number;
  owner?: string;
  store?: Record<string, number>;
  level?: number;
  id?: string;
  mineralType?: string;
  density?: number;
}

export interface EditableFlag {
  name: string;
  x: number;
  y: number;
}

export interface EditableMap {
  room: string;
  terrain: string[];
  structures: EditableObject[];
  flags: EditableFlag[];
  extra: Record<string, unknown>;
}

const MODELLED_TOP_LEVEL = new Set(['room', 'terrain', 'structures', 'flags', 'sources', 'minerals', 'controller']);
const STRUCTURE_MANAGED = new Set([
  'type', 'x', 'y', 'owner', 'store', 'level', 'id', 'mineralType', 'density',
  'energy', 'energyCapacity', 'mineralAmount',
]);

function randomObjectId(): string {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function positioned(value: unknown): value is Record<string, unknown> & { x: number; y: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return typeof object.x === 'number' && Number.isFinite(object.x)
    && typeof object.y === 'number' && Number.isFinite(object.y);
}

export function parseEditableMap(input: string | unknown): { map: EditableMap | null; error: string | null } {
  try {
    const raw = typeof input === 'string' ? JSON.parse(input) : input;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('map must be an object');
    const source = raw as Record<string, unknown>;
    if (typeof source.room !== 'string' || !source.room) throw new Error('missing room');
    if (!Array.isArray(source.terrain) || source.terrain.length !== 50) throw new Error('terrain must contain 50 rows');
    const terrain = source.terrain.map((row, index) => {
      if (typeof row !== 'string' || row.length !== 50) throw new Error(`terrain row ${index} must contain 50 tiles`);
      return row;
    });

    const structures: EditableObject[] = [];
    for (const value of (Array.isArray(source.structures) ? source.structures : [])) {
      if (!positioned(value) || typeof value.type !== 'string') continue;
      const object = { ...value } as EditableObject;
      if ((object.type === 'source' || object.type === 'mineral') && !object.id) object.id = randomObjectId();
      structures.push(object);
    }
    for (const value of (Array.isArray(source.sources) ? source.sources : [])) {
      if (!positioned(value)) continue;
      const object: EditableObject = { type: 'source', x: value.x, y: value.y, id: String(value.id || randomObjectId()) };
      if (value.energy != null) object.energy = value.energy;
      if (value.energyCapacity != null) object.energyCapacity = value.energyCapacity;
      structures.push(object);
    }
    for (const value of (Array.isArray(source.minerals) ? source.minerals : [])) {
      if (!positioned(value)) continue;
      const object: EditableObject = {
        type: 'mineral', x: value.x, y: value.y, id: String(value.id || randomObjectId()),
        mineralType: typeof value.mineralType === 'string' ? value.mineralType : 'H',
        density: typeof value.density === 'number' ? value.density : 3,
      };
      if (value.mineralAmount != null) object.mineralAmount = value.mineralAmount;
      structures.push(object);
    }
    if (positioned(source.controller) && !structures.some((object) => object.type === 'controller')) {
      const controller: EditableObject = { type: 'controller', x: source.controller.x, y: source.controller.y };
      if (source.controller.owner != null) controller.owner = String(source.controller.owner);
      if (typeof source.controller.level === 'number') controller.level = source.controller.level;
      structures.push(controller);
    }

    const flags: EditableFlag[] = [];
    for (const value of (Array.isArray(source.flags) ? source.flags : [])) {
      if (!positioned(value)) continue;
      flags.push({ name: typeof value.name === 'string' ? value.name : 'flag', x: value.x, y: value.y });
    }
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(source)) if (!MODELLED_TOP_LEVEL.has(key)) extra[key] = source[key];
    return { map: { room: source.room, terrain, structures, flags, extra }, error: null };
  } catch (error) {
    return { map: null, error: String((error as Error).message || error) };
  }
}

export function serializeEditableMap(map: EditableMap): string {
  const structures: Record<string, unknown>[] = [];
  const sources: Record<string, unknown>[] = [];
  const minerals: Record<string, unknown>[] = [];
  let controller: Record<string, unknown> | null = null;

  for (const object of map.structures) {
    if (object.type === 'source') {
      if (!object.id) object.id = randomObjectId();
      const source: Record<string, unknown> = { x: object.x, y: object.y, id: object.id };
      if (object.energy != null) source.energy = object.energy;
      if (object.energyCapacity != null) source.energyCapacity = object.energyCapacity;
      sources.push(source);
    } else if (object.type === 'mineral') {
      if (!object.id) object.id = randomObjectId();
      const mineral: Record<string, unknown> = {
        x: object.x, y: object.y, mineralType: object.mineralType || 'H',
        density: object.density || 3, id: object.id,
      };
      if (object.mineralAmount != null) mineral.mineralAmount = object.mineralAmount;
      minerals.push(mineral);
    } else if (object.type === 'controller') {
      controller = { x: object.x, y: object.y };
      if (object.owner != null) controller.owner = object.owner;
      if (object.level != null && object.level !== 0) controller.level = object.level;
    } else {
      const structure: Record<string, unknown> = { type: object.type, x: object.x, y: object.y };
      for (const key of Object.keys(object)) if (!STRUCTURE_MANAGED.has(key)) structure[key] = object[key];
      if (object.owner != null) structure.owner = object.owner;
      if (object.store && Object.keys(object.store).length) structure.store = object.store;
      if (object.level != null && object.level !== 0) structure.level = object.level;
      structures.push(structure);
    }
  }

  const output: Record<string, unknown> = {
    room: map.room,
    terrain: map.terrain.slice(),
    structures,
    flags: map.flags.map((flag) => ({ name: flag.name, x: flag.x, y: flag.y })),
  };
  if (sources.length) output.sources = sources;
  if (minerals.length) output.minerals = minerals;
  if (controller) output.controller = controller;
  for (const key of Object.keys(map.extra)) output[key] = map.extra[key];
  return JSON.stringify(output, null, '\t');
}

export function structureLayer(type: string): 'floor' | 'overlay' | 'main' {
  return type === 'road' ? 'floor' : (type === 'rampart' ? 'overlay' : 'main');
}

export function makeEditableObject(type: string, x: number, y: number): EditableObject {
  const object: EditableObject = { type, x, y };
  if (['spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab', 'factory', 'rampart'].includes(type)) object.owner = 'me';
  if (['storage', 'terminal', 'container'].includes(type)) object.store = {};
  if (type === 'controller') object.level = 0;
  if (type === 'mineral') { object.mineralType = 'H'; object.density = 3; }
  if (type === 'source' || type === 'mineral') object.id = randomObjectId();
  return object;
}

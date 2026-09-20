// Game facts the map editor needs to be useful: what can be placed, how many
// of each an RCL allows, what a store may legally hold, and the body/boost
// tables. All of it mirrors engine constants (@screeps/common lib/constants.js)
// — the engine itself lives in the container, so it cannot be imported here and
// the values are transcribed instead. Each block names the constant it copies
// so a mismatch is checkable by eye.
//
// Kept pure and DOM-free so every rule is unit-testable.

export type PlaceableGroup = 'structure' | 'natural' | 'npc' | 'loose' | 'unit' | 'marker';
export type PlaceLayer = 'floor' | 'overlay' | 'main' | 'unit' | 'loose';

export interface Placeable {
	type: string;
	label: string;
	group: PlaceableGroup;
	// Drawn on the palette row. Deliberately a text glyph, not an image: the
	// palette has to render before the CDN icons do and at 11px.
	glyph: string;
	layer: PlaceLayer;
	// Mods that must be selected for this to be offered (absent = always).
	mod?: string;
	hint?: string;
}

// CONTROLLER_STRUCTURES, indexed by RCL 0..8. A type absent from this table has
// no controller-imposed limit (sources, minerals, NPC structures, loose
// objects), which the panel shows as "—".
export const RCL_LIMITS: Record<string, readonly number[]> = {
	spawn: [0, 1, 1, 1, 1, 1, 1, 2, 3],
	extension: [0, 0, 5, 10, 20, 30, 40, 50, 60],
	link: [0, 0, 0, 0, 0, 2, 3, 4, 6],
	road: [2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500],
	constructedWall: [0, 0, 2500, 2500, 2500, 2500, 2500, 2500, 2500],
	rampart: [0, 0, 2500, 2500, 2500, 2500, 2500, 2500, 2500],
	storage: [0, 0, 0, 0, 1, 1, 1, 1, 1],
	tower: [0, 0, 0, 1, 1, 2, 2, 3, 6],
	observer: [0, 0, 0, 0, 0, 0, 0, 0, 1],
	powerSpawn: [0, 0, 0, 0, 0, 0, 0, 0, 1],
	extractor: [0, 0, 0, 0, 0, 0, 1, 1, 1],
	terminal: [0, 0, 0, 0, 0, 0, 1, 1, 1],
	lab: [0, 0, 0, 0, 0, 0, 3, 6, 10],
	container: [5, 5, 5, 5, 5, 5, 5, 5, 5],
	nuker: [0, 0, 0, 0, 0, 0, 0, 0, 1],
	factory: [0, 0, 0, 0, 0, 0, 0, 1, 1],
};

// null = no controller limit for this type ("—" in the palette).
export function rclLimit(type: string, rcl: number): number | null {
	const row = RCL_LIMITS[type];
	if (!row) return null;
	return row[Math.max(0, Math.min(8, Math.floor(rcl)))];
}

export const PLACEABLES: readonly Placeable[] = [
	// --- owned structures (CONTROLLER_STRUCTURES) ---
	{ type: 'spawn', label: 'Spawn', group: 'structure', glyph: '⌂', layer: 'main' },
	{ type: 'extension', label: 'Extension', group: 'structure', glyph: '⊙', layer: 'main' },
	{ type: 'tower', label: 'Tower', group: 'structure', glyph: '⌖', layer: 'main' },
	{ type: 'storage', label: 'Storage', group: 'structure', glyph: '▤', layer: 'main' },
	{ type: 'terminal', label: 'Terminal', group: 'structure', glyph: '▥', layer: 'main' },
	{ type: 'link', label: 'Link', group: 'structure', glyph: '▦', layer: 'main' },
	{ type: 'lab', label: 'Lab', group: 'structure', glyph: '⚗', layer: 'main' },
	{ type: 'factory', label: 'Factory', group: 'structure', glyph: '⚙', layer: 'main' },
	{ type: 'nuker', label: 'Nuker', group: 'structure', glyph: '☢', layer: 'main' },
	{ type: 'powerSpawn', label: 'Power Spawn', group: 'structure', glyph: '✦', layer: 'main' },
	{ type: 'observer', label: 'Observer', group: 'structure', glyph: '◉', layer: 'main' },
	{ type: 'extractor', label: 'Extractor', group: 'structure', glyph: '⛏', layer: 'main' },
	{ type: 'container', label: 'Container', group: 'structure', glyph: '▢', layer: 'main' },
	{ type: 'road', label: 'Road', group: 'structure', glyph: '═', layer: 'floor' },
	{ type: 'rampart', label: 'Rampart', group: 'structure', glyph: '▒', layer: 'overlay' },
	{ type: 'constructedWall', label: 'Wall', group: 'structure', glyph: '█', layer: 'main' },
	{ type: 'constructionSite', label: 'Construction Site', group: 'structure', glyph: '◫', layer: 'main',
		hint: 'Pick which structure in the properties panel.' },

	// --- natural room features ---
	{ type: 'source', label: 'Source', group: 'natural', glyph: '◆', layer: 'main' },
	{ type: 'mineral', label: 'Mineral', group: 'natural', glyph: '◈', layer: 'main' },
	{ type: 'controller', label: 'Controller', group: 'natural', glyph: '⬢', layer: 'main',
		hint: 'One per room — placing a second moves the existing one.' },
	{ type: 'deposit', label: 'Deposit', group: 'natural', glyph: '❖', layer: 'main' },
	{ type: 'powerBank', label: 'Power Bank', group: 'natural', glyph: '⬣', layer: 'main' },
	{ type: 'portal', label: 'Portal', group: 'natural', glyph: '◎', layer: 'main' },
	{ type: 'reactor', label: 'Reactor', group: 'natural', glyph: '☀', layer: 'main', mod: 'season5' },

	// --- NPC structures ---
	{ type: 'keeperLair', label: 'Keeper Lair', group: 'npc', glyph: '☠', layer: 'main' },
	{ type: 'invaderCore', label: 'Invader Core', group: 'npc', glyph: '⛨', layer: 'main' },

	// --- loose objects lying on the floor ---
	{ type: 'energy', label: 'Dropped Resource', group: 'loose', glyph: '◌', layer: 'loose' },
	{ type: 'tombstone', label: 'Tombstone', group: 'loose', glyph: '†', layer: 'loose' },
	{ type: 'ruin', label: 'Ruin', group: 'loose', glyph: '⌓', layer: 'loose' },

	// --- units & markers ---
	{ type: 'creep', label: 'Creep', group: 'unit', glyph: '●', layer: 'unit',
		hint: 'Drag a creep in Select mode to move it.' },
	{ type: 'flag', label: 'Flag', group: 'marker', glyph: '⚑', layer: 'main' },
];

export const GROUP_LABELS: Record<PlaceableGroup, string> = {
	structure: 'Structures',
	natural: 'Room features',
	npc: 'NPC',
	loose: 'On the floor',
	unit: 'Creeps',
	marker: 'Markers',
};

const PLACEABLE_BY_TYPE: Record<string, Placeable> = {};
for (const item of PLACEABLES) PLACEABLE_BY_TYPE[item.type] = item;

export function placeable(type: string): Placeable | undefined {
	return PLACEABLE_BY_TYPE[type];
}

export function labelFor(type: string): string {
	return PLACEABLE_BY_TYPE[type]?.label || (type ? type[0].toUpperCase() + type.slice(1) : 'Object');
}

export function glyphFor(type: string): string {
	return PLACEABLE_BY_TYPE[type]?.glyph || '◇';
}

// What a mod adds to the placeable list, beyond the `mod` tag above.
export const MOD_MINERALS: Record<string, string[]> = { season5: ['T'] };

export function placeablesFor(mods: string[] | undefined): Placeable[] {
	const selected = new Set(mods || []);
	return PLACEABLES.filter((item) => !item.mod || selected.has(item.mod));
}

// --- structure hits (engine *_HITS constants) --------------------------------
// Used to seed hitsMax on a newly placed structure and to bound the hits
// slider. A type absent here has no hit points the editor models.
export const STRUCTURE_HITS: Record<string, number> = {
	spawn: 5000,
	extension: 1000,
	tower: 3000,
	storage: 10000,
	terminal: 3000,
	link: 1000,
	lab: 500,
	factory: 1000,
	nuker: 1000,
	powerSpawn: 5000,
	observer: 500,
	extractor: 500,
	container: 250000,
	road: 5000,
	// WALL_HITS_MAX. A map is a snapshot of a base that already stands, so a
	// placed wall is a REPAIRED one — the engine's own "just built" value of 1
	// would be a wall the first creep pops.
	constructedWall: 300000000,
	powerBank: 2000000,
	invaderCore: 100000,
	keeperLair: 0,
};

// RAMPART_HITS_MAX, by RCL. A rampart is the one structure whose ceiling grows
// with the controller, so it cannot sit in the flat table above.
const RAMPART_HITS_MAX = [0, 0, 300000, 1000000, 3000000, 10000000, 30000000, 100000000, 300000000];

export function rampartHitsFor(rcl: number): number {
	return RAMPART_HITS_MAX[Math.max(0, Math.min(8, Math.floor(rcl)))] || 300000;
}

// Roads take terrain-dependent hits (ROAD_HITS 5000, ×5 on swamp, ×150 on a
// wall tile) — the engine multiplies at construction, so the editor does too.
export function roadHitsFor(terrainTile: string): number {
	if (terrainTile === '~') return 5000 * 5;
	if (terrainTile === '#') return 5000 * 150;
	return 5000;
}

// --- body parts & boosts (BODY_PARTS / BOOSTS) -------------------------------
export const BODY_PARTS = ['tough', 'work', 'carry', 'attack', 'ranged_attack', 'heal', 'claim', 'move'] as const;
export type BodyPart = typeof BODY_PARTS[number];

export const BODY_PART_LABELS: Record<string, string> = {
	tough: 'tough', work: 'work', carry: 'carry', attack: 'attack',
	ranged_attack: 'ranged', heal: 'heal', claim: 'claim', move: 'move',
};

// Replay inspector's palette, kept identical so a creep reads the same in both.
export const BODY_PART_COLORS: Record<string, string> = {
	tough: '#ffffff',
	work: '#ffe56d',
	carry: '#5c5f66',
	attack: '#f93842',
	ranged_attack: '#5d80b2',
	heal: '#65fd62',
	claim: '#b99cfb',
	move: '#a9b7c6',
};

export const BODY_PART_HITS = 100;
export const MAX_CREEP_SIZE = 50;

// BOOSTS, as part -> compound -> short description of the effect. Vanilla has
// no CLAIM boost, so `claim` is deliberately an empty list.
export const BOOSTS: Record<string, Array<{ compound: string; effect: string }>> = {
	work: [
		{ compound: 'UO', effect: 'harvest ×3' },
		{ compound: 'UHO2', effect: 'harvest ×5' },
		{ compound: 'XUHO2', effect: 'harvest ×7' },
		{ compound: 'LH', effect: 'build/repair ×1.5' },
		{ compound: 'LH2O', effect: 'build/repair ×1.8' },
		{ compound: 'XLH2O', effect: 'build/repair ×2' },
		{ compound: 'ZH', effect: 'dismantle ×2' },
		{ compound: 'ZH2O', effect: 'dismantle ×3' },
		{ compound: 'XZH2O', effect: 'dismantle ×4' },
		{ compound: 'GH', effect: 'upgrade ×1.5' },
		{ compound: 'GH2O', effect: 'upgrade ×1.8' },
		{ compound: 'XGH2O', effect: 'upgrade ×2' },
	],
	attack: [
		{ compound: 'UH', effect: 'attack ×2' },
		{ compound: 'UH2O', effect: 'attack ×3' },
		{ compound: 'XUH2O', effect: 'attack ×4' },
	],
	ranged_attack: [
		{ compound: 'KO', effect: 'ranged ×2' },
		{ compound: 'KHO2', effect: 'ranged ×3' },
		{ compound: 'XKHO2', effect: 'ranged ×4' },
	],
	heal: [
		{ compound: 'LO', effect: 'heal ×2' },
		{ compound: 'LHO2', effect: 'heal ×3' },
		{ compound: 'XLHO2', effect: 'heal ×4' },
	],
	carry: [
		{ compound: 'KH', effect: 'capacity ×2' },
		{ compound: 'KH2O', effect: 'capacity ×3' },
		{ compound: 'XKH2O', effect: 'capacity ×4' },
	],
	move: [
		{ compound: 'ZO', effect: 'fatigue ÷2' },
		{ compound: 'ZHO2', effect: 'fatigue ÷3' },
		{ compound: 'XZHO2', effect: 'fatigue ÷4' },
	],
	tough: [
		{ compound: 'GO', effect: 'damage ×0.7' },
		{ compound: 'GHO2', effect: 'damage ×0.5' },
		{ compound: 'XGHO2', effect: 'damage ×0.3' },
	],
	claim: [],
};

// CARRY_CAPACITY, and the multiplier a carry boost applies to it.
export const CARRY_CAPACITY = 50;
const CARRY_BOOST_MULTIPLIER: Record<string, number> = { KH: 2, KH2O: 3, XKH2O: 4 };

export function carryBoostMultiplier(boost: string | undefined): number {
	return (boost && CARRY_BOOST_MULTIPLIER[boost]) || 1;
}

// --- resources (RESOURCES_ALL) ----------------------------------------------
export const BASE_MINERALS = ['H', 'O', 'U', 'L', 'K', 'Z', 'X'];
export const RESOURCE_GROUPS: Array<{ label: string; resources: string[] }> = [
	{ label: 'Basic', resources: ['energy', 'power', 'ops'] },
	{ label: 'Minerals', resources: [...BASE_MINERALS, 'G'] },
	{ label: 'Tier 1 compounds', resources: ['OH', 'ZK', 'UL', 'UH', 'UO', 'KH', 'KO', 'LH', 'LO', 'ZH', 'ZO', 'GH', 'GO'] },
	{ label: 'Tier 2 compounds', resources: ['UH2O', 'UHO2', 'KH2O', 'KHO2', 'LH2O', 'LHO2', 'ZH2O', 'ZHO2', 'GH2O', 'GHO2'] },
	{ label: 'Tier 3 compounds', resources: ['XUH2O', 'XUHO2', 'XKH2O', 'XKHO2', 'XLH2O', 'XLHO2', 'XZH2O', 'XZHO2', 'XGH2O', 'XGHO2'] },
	{ label: 'Commodities', resources: [
		'silicon', 'metal', 'biomass', 'mist',
		'utrium_bar', 'lemergium_bar', 'zynthium_bar', 'keanium_bar', 'ghodium_melt', 'oxidant', 'reductant', 'purifier', 'battery',
		'composite', 'crystal', 'liquid',
		'wire', 'switch', 'transistor', 'microchip', 'circuit', 'device',
		'cell', 'phlegm', 'tissue', 'muscle', 'organoid', 'organism',
		'alloy', 'tube', 'fixtures', 'frame', 'hydraulics', 'machine',
		'condensate', 'concentrate', 'extract', 'spirit', 'emanation', 'essence',
	] },
];

export function allResources(mods: string[] | undefined): string[] {
	const out: string[] = [];
	for (const group of RESOURCE_GROUPS) for (const resource of group.resources) out.push(resource);
	for (const mod of mods || []) for (const extra of MOD_MINERALS[mod] || []) if (!out.includes(extra)) out.push(extra);
	return out;
}

export function mineralTypes(mods: string[] | undefined): string[] {
	const out = BASE_MINERALS.slice();
	for (const mod of mods || []) for (const extra of MOD_MINERALS[mod] || []) if (!out.includes(extra)) out.push(extra);
	return out;
}

// Everything a lab or terminal may hold that is NOT plain energy — i.e. what a
// lab's single mineral slot can be.
export function nonEnergyResources(mods: string[] | undefined): string[] {
	return allResources(mods).filter((resource) => resource !== 'energy');
}

// --- owners ------------------------------------------------------------------
// The four owner tags the loader resolves itself (src/dojoWorld.js resolveOwner
// + NPC_USER_IDS); any other value is a player LABEL that settings.json binds a
// bot codebase to.
export const BUILTIN_OWNERS = [
	{ value: 'me', label: 'me (this scenario\'s bot)' },
	{ value: 'invader', label: 'invader (NPC)' },
	{ value: 'sourceKeeper', label: 'source keeper (NPC)' },
	{ value: 'unclaimed', label: 'unclaimed / neutral' },
];

// Structures that carry an owner at all. Everything else is neutral by nature
// (roads and walls included: the engine stores no user on them).
export const OWNABLE = new Set([
	'spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab', 'factory',
	'nuker', 'powerSpawn', 'observer', 'extractor', 'rampart', 'controller',
	'creep', 'constructionSite', 'invaderCore', 'ruin', 'tombstone',
]);

export function isClaimed(owner: unknown): boolean {
	return owner != null && owner !== 'neutral' && owner !== 'unclaimed';
}

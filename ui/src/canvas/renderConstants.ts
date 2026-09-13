const WHITE = '#ffffff';
const BLACK = '#000000';
const ENERGY = '#fcdd72';
const POWER = '#f53547';
const HEALTH = '#65fd62';
const ATTACK = '#f7263f';
const RANGED_ATTACK = '#5c82b1';
const LIGHT_GREY = '#aaaaaa';
const OTHER_STRUCTURE = '#ff9999';

// Semantic canvas palette. Repeated meanings intentionally share the same
// underlying colour while distinct renderer details keep their own entries.
export const RENDER_COLORS = {
	transparent: 'transparent',
	defaultFill: WHITE,
	defaultStroke: WHITE,
	black: BLACK,

	resources: {
		energy: ENERGY,
		power: POWER,
		other: WHITE,
	},
	health: HEALTH,
	actions: {
		attack: ATTACK,
		rangedMassAttack: RANGED_ATTACK,
		build: WHITE,
		repair: ENERGY,
		dismantle: '#d18b2a',
	},
	ownership: {
		bot: '#5577ff',
		opponent: '#ff5555',
		ownStructure: '#8fbb93',
		otherStructure: OTHER_STRUCTURE,
		publicStructure: '#aaaaaa',
	},
	creep: {
		heal: HEALTH,
		rangedAttack: RANGED_ATTACK,
		attack: ATTACK,
		work: '#ffe174',
		claim: '#b6a0f8',
		move: '#a9b8c6',
		tough: '#e8e8e8',
		ring: '#222222',
		inner: '#555555',
		invaderOutline: '#120006',
		invaderBody: '#e51f36',
	},
	terrain: {
		plain: '#2b2b2b',
		swamp: '#3a4429',
		swampOutline: '#292a208e',
		wall: '#101010',
		constructedWallMarker: LIGHT_GREY,
		wallOuterShadow: '#00000020',
		wallInnerGlow: '#FFFFFF05',
		wallInnerHighlight: '#99999930',
		wallOutline: BLACK,
		grid: WHITE,
		exit: '#ffffff60',
	},
	structure: {
		dark: '#181818',
		medium: '#555555',
		light: LIGHT_GREY,
		road: '#666666',
		spawnOutline: '#cccccc',
		sourceBase: '#0a0a0a',
		sourceOutline: BLACK,
		factoryShell: '#232323',
		factoryOutline: '#140a0a',
		factoryInner: '#302a2a',
		factoryCore: '#3f3f3f',
		invaderCore: '#cc2222',
		keeperLair: '#aa0000',
	},
	rampart: {
		own: '#519752',
		other: '#95484a',
	},
	deposit: {
		biomass: '#87ae29',
		metal: '#7e5b4d',
		mist: '#d771f1',
		silicon: '#4aabe3',
	},
	powerBank: {
		inner: '#351419',
		outline: LIGHT_GREY,
	},
	controller: {
		base: '#0a0a0a',
		outline: BLACK,
		level: LIGHT_GREY,
		unclaimed: '#444444',
		progress: '#ffffff7c',
	},
	flag: {
		fill: '#ff6666',
		foreground: WHITE,
	},
	tombstone: {
		body: 'transparent',
		outline: WHITE,
		mark: BLACK,
	},
	roomName: WHITE,
	// say() bubble: a near-white panel with a black outline, so it reads against
	// both terrain and creeps. A public say (say(msg, true)) swaps in a pink
	// panel — the only way to tell the two apart on the map.
	speech: {
		background: '#f2f2ef',
		publicBackground: '#f8c5cb',
		border: BLACK,
		text: BLACK,
	},
} as const;

export const TERRAIN_COLORS: Readonly<Record<string, string>> = {
	'.': RENDER_COLORS.terrain.plain,
	'~': RENDER_COLORS.terrain.swamp,
	'#': RENDER_COLORS.terrain.wall,
};

export const MINERAL_COLORS: Readonly<Record<string, string>> = {
	// Thorium (Season 5). Its own green, so a Thorium deposit reads as seasonal
	// at a glance rather than as another grey mineral.
	T: '#8fe04a',
	H: '#cdcdcd',
	O: '#cdcdcd',
	U: '#52daf8',
	K: '#9c7afb',
	L: '#2bf4a7',
	Z: '#fdd08b',
	X: '#fe767a',
};

export const DEFAULT_MINERAL_COLOR = MINERAL_COLORS.H;
export const ROOM_SIZE_TILES = 50;
// Room name label, in tiles: small enough to sit inside the top-left corner
// without standing as tall as the wall tile behind it.
export const ROOM_NAME_STYLE = { fontSize: 0.65, x: 0.15, baseline: 0.75 } as const;

export const STATIC_LAYER_RESOLUTION = 24;

export const WALL_RENDER_STYLE = {
	cornerRadius: 0.42,
	textureOpacity: 0.055,
	outerShadowWidth: 0.5,
	innerGlowWidth: 0.7,
	innerHighlightWidth: 0.2,
	outlineWidth: 0.045,
	constructedMarkerWidth: 0.035,
	constructedMarkers: [
		{ y: 1 / 3, startX: 0.3, length: 0.3 },
		{ y: 2 / 3, startX: 0.4, length: 0.3 },
	],
} as const;

export const SWAMP_RENDER_STYLE = {
	animated: true,
	cornerRadius: 0.45,
	outlineWidth: 0.25,
	textureOpacity: 0.3,
	textureRepeatsPerRoom: 2,
	textureLayers: [
		{ velocityX: 0.32, velocityY: 0.14 },
		{ velocityX: -0.19, velocityY: -0.27 },
	],
} as const;

export const RAMPART_RENDER_STYLE = {
	cornerRadius: WALL_RENDER_STYLE.cornerRadius,
	fillOpacity: 0.2,
	outlineOpacity: 0.7,
	outlineWidth: 0.15,
	publicMarkerOpacity: 0.7,
	publicMarkerWidth: 0.15,
	publicMarkerLength: 0.5,
} as const;

export const DEPOSIT_RENDER_STYLE = {
	size: 1.5,
	outlineWidth: 0.1,
	detailWidth: 0.05,
	fillOpacity: 0.4,
} as const;

export const SOURCE_RENDER_STYLE = {
	halfSize: 0.35,
	cornerRadius: 0.2,
	// The black outline is always left visible: the energy core stops short of it.
	outlineWidth: 0.04,
	coreHalfSize: 0.3,
	coreCornerRadius: 0.2,
	coreOpacity: 0.95,
} as const;

export const POWER_BANK_RENDER_STYLE = {
	halfSize: 0.78,
	cornerClip: 0.25,
	outlineWidth: 0.1,
	coreRadius: 0.3,
} as const;

export const STRUCTURE_SHELL_TYPES: ReadonlySet<string> = new Set([
	'spawn',
	'extension',
	'tower',
	'storage',
	'terminal',
	'link',
	'lab',
	'factory',
	'observer',
	'nuker',
	'powerSpawn',
	'container',
	'road',
	'powerBank',
	'invaderCore',
	'keeperLair',
	'extractor',
]);

// The epoch cache KEY, not the draw list: an object type belongs here only if
// it is baked into the cached structure canvas, because listing it makes the
// whole background rebuild whenever one appears, moves, or disappears.
// Construction sites are deliberately absent — they are drawn per frame (their
// progress changes every tick), so keying on them would rebuild for nothing.
export const STATIC_LAYER_OBJECT_TYPES: ReadonlySet<string> = new Set([
	...STRUCTURE_SHELL_TYPES,
	'constructedWall',
	'controller',
	'source',
	'mineral',
	'deposit',
]);

// Season 5 reactor. The official client draws a 150x150 sprite on a 100-unit
// tile, so the artwork is 1.5 tiles across; its edge rotates π every four
// seconds, and one tick is one second of replay at 1x.
export const REACTOR_RENDER_STYLE = {
	size: 1.5,
	secondsPerHalfTurn: 4,
	glowRadius: 1.6,
	glowInner: '#67a700',
	glowOpacity: 0.55,
	// A claimed-but-empty reactor still glows, faintly — enough to find it on
	// the map without implying it is running.
	idleGlowScale: 0.6,
	idleGlowOpacity: 0.22,
	coreFill: '#3f6b12',
	coreOutline: '#bcff50',
	edgeFill: '#bcff50',
	ownerRingRadius: 0.62,
	ownerRingWidth: 0.09,
} as const;

// Anything a loaded mod placed that the renderer has no artwork for. Visible
// and selectable beats invisible: a scenario that placed it should see it.
export const UNKNOWN_OBJECT_RENDER_STYLE = {
	radius: 0.4,
	fill: '#2a2a2a',
	stroke: '#9a9a9a',
	outlineWidth: 0.06,
	labelFont: 0.42,
	labelOffsetY: 0.15,
	labelChars: 3,
} as const;

// Types the renderer draws deliberately, somewhere. Anything outside this set
// came from a mod the renderer does not know, and gets the marker above.
export const KNOWN_OBJECT_TYPES: ReadonlySet<string> = new Set([
	...STATIC_LAYER_OBJECT_TYPES,
	'reactor',
	'creep',
	'powerCreep',
	'constructionSite',
	'tombstone',
	'ruin',
	'rampart',
	'energy',
	'resource',
	'nuke',
	'portal',
]);

export const CONSTRUCTION_SITE_RENDER_STYLE = {
	// 80% of a tile across, matching the owned-structure outline weight.
	radius: 0.25,
	outlineWidth: 0.10,
	// Pulses between these once per tick, which is one second of replay at 1x.
	pulsePeakOpacity: 0.7,
	pulseTroughOpacity: 0.5,
} as const;

// Screeps controller progress totals (from @screeps/common constants).
export const CONTROLLER_LEVEL_PROGRESS: Readonly<Record<number, number>> = {
	1: 200,
	2: 45000,
	3: 135000,
	4: 405000,
	5: 1215000,
	6: 3645000,
	7: 10935000,
	8: 0,
};

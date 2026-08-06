const WHITE = '#ffffff';
const BLACK = '#000000';
const ENERGY = '#fcdd72';
const POWER = '#f53547';
const HEALTH = '#65fd62';
const ATTACK = '#f7263f';
const RANGED_ATTACK = '#5c82b1';

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
		otherStructure: '#ff9999',
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
		swamp: '#29301d',
		wall: '#101010',
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
		light: '#aaaaaa',
		road: '#666666',
		spawnOutline: '#cccccc',
		sourceBase: '#0a0a0a',
		sourceOutline: '#333333',
		factoryShell: '#232323',
		factoryOutline: '#140a0a',
		factoryInner: '#302a2a',
		factoryCore: '#3f3f3f',
		rampart: '#52a052',
		invaderCore: '#cc2222',
		keeperLair: '#aa0000',
	},
	controller: {
		base: '#0a0a0a',
		outline: BLACK,
		level: '#aaaaaa',
		unclaimed: '#444444',
		progress: '#ffffff7c',
	},
	flag: {
		fill: '#ff6666',
		foreground: WHITE,
	},
	tombstone: {
		body: '#9a9a9a',
		outline: '#555555',
		mark: '#444444',
	},
	speechBackground: 'rgba(0,0,0,0.7)',
} as const;

export const TERRAIN_COLORS: Readonly<Record<string, string>> = {
	'.': RENDER_COLORS.terrain.plain,
	'~': RENDER_COLORS.terrain.swamp,
	'#': RENDER_COLORS.terrain.wall,
};

export const MINERAL_COLORS: Readonly<Record<string, string>> = {
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
export const STATIC_LAYER_RESOLUTION = 24;

export const WALL_RENDER_STYLE = {
	cornerRadius: 0.22,
	textureOpacity: 0.025,
	outerShadowWidth: 0.5,
	innerGlowWidth: 0.7,
	innerHighlightWidth: 0.2,
	outlineWidth: 0.045,
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
	'rampart',
	'constructedWall',
	'invaderCore',
	'keeperLair',
	'extractor',
]);

export const STATIC_LAYER_OBJECT_TYPES: ReadonlySet<string> = new Set([
	...STRUCTURE_SHELL_TYPES,
	'controller',
	'source',
	'mineral',
	'constructionSite',
]);

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

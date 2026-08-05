import type { Recording, StageLayout, Frame, FrameObject } from '../api/types.ts';
import { drawStructureShell, connectRoads } from './structures.ts';
import { drawSourceCore, drawTowerTurret } from './dynamic.ts';
import { circle, poly, text } from './primitives.ts';

export const STATIC_RES = 24; // px per tile for offscreen layers

const TILE_COLORS: Record<string, string> = { '.': '#2b2b2b', '~': '#23311e', '#': '#111111' };
const MINERAL_COLORS: Record<string, string> = { 'H': '#cdcdcd', 'O': '#cdcdcd', 'U': '#52daf8', 'K': '#9c7afb', 'L': '#2bf4a7', 'Z': '#fdd08b', 'X': '#fe767a' };
const ROOM_BG = '#2b2b2b';

// One room's terrain at room-local integer tile coordinates.
export function drawTerrain(ctx: CanvasRenderingContext2D, rows: string[]): void {
  ctx.save();
  ctx.fillStyle = ROOM_BG;
  ctx.fillRect(0, 0, 50, 50);
  for (let y = 0; y < 50; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < 50; x++) {
      const ch = row[x];
      if (ch === '.' || ch === undefined) continue;
      ctx.fillStyle = TILE_COLORS[ch] || ROOM_BG;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // faint tile grid
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  for (let i = 1; i < 50; i++) { ctx.moveTo(i, 0); ctx.lineTo(i, 50); ctx.moveTo(0, i); ctx.lineTo(50, i); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  // exit chevrons on walkable border tiles
  ctx.strokeStyle = '#9bd49b';
  ctx.lineWidth = 0.08;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  const chevron = (tileX: number, tileY: number, dirX: number, dirY: number) => {
    // chevron from -0.15 (arm base) to tip at +0.3 of the tile centre,
    // arms spread ±0.25 perpendicular to the pointing direction
    const cx = tileX + 0.5, cy = tileY + 0.5;
    const px = -dirY, py = dirX; // perpendicular
    const ax = cx - 0.15 * dirX + 0.25 * px, ay = cy - 0.15 * dirY + 0.25 * py;
    const tipX = cx + 0.3 * dirX, tipY = cy + 0.3 * dirY;
    const bx = cx - 0.15 * dirX - 0.25 * px, by = cy - 0.15 * dirY - 0.25 * py;
    ctx.moveTo(ax, ay);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(bx, by);
  };
  for (let i = 1; i < 49; i++) {
    if (rows[i] && rows[i][0] !== '#') chevron(0, i, -1, 0);
    if (rows[i] && rows[i][49] !== '#') chevron(49, i, 1, 0);
    if (rows[0] && rows[0][i] !== '#') chevron(i, 0, 0, -1);
    if (rows[49] && rows[49][i] !== '#') chevron(i, 49, 0, 1);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawTerrainScene(ctx: CanvasRenderingContext2D, terrain: Record<string, string[]>, layout: StageLayout): void {
  for (const room of Object.keys(terrain)) {
    const off = layout.offsets[room];
    if (!off) continue;
    ctx.save();
    ctx.translate(off.col * 50, off.row * 50);
    drawTerrain(ctx, terrain[room]);
    ctx.restore();
  }
}

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

function browserCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function buildTerrainCanvas(
  recording: Recording,
  layout: StageLayout,
  res = STATIC_RES,
  canvasFactory: CanvasFactory = browserCanvas,
): HTMLCanvasElement {
  const colsTiles = (layout.width / layout.pixelsPerRoom) * 50;
  const rowsTiles = (layout.height / layout.pixelsPerRoom) * 50;
  const cv = canvasFactory(
    Math.max(1, Math.round(colsTiles * res)),
    Math.max(1, Math.round(rowsTiles * res)),
  );
  const ctx = cv.getContext('2d')!;
  ctx.scale(res, res); // now draw in tile units
  drawTerrainScene(ctx, recording.terrain, layout);
  return cv;
}

const SHELL_TYPES = new Set(['spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab',
  'factory', 'observer', 'nuker', 'powerSpawn', 'container', 'road', 'rampart', 'constructedWall',
  'invaderCore', 'keeperLair', 'extractor']);

export function drawStaticStructures(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  layout: StageLayout,
): void {
  for (const room of Object.keys(layout.offsets)) {
    const off = layout.offsets[room];
    ctx.save();
    ctx.translate(off.col * 50, off.row * 50);
    const roads: number[][] = [];
    for (const o of frame.objects as FrameObject[]) {
      if (o.room !== room) continue;
      if (SHELL_TYPES.has(o.type)) {
        drawStructureShell(ctx, o);
        if (o.type === 'road') roads.push([o.x, o.y]);
      } else if (o.type === 'source') {
        // black base only; the energy core is dynamic (Task 5)
        circle(ctx, o.x + 0.5, o.y + 0.5, { radius: 0.35, fill: '#0a0a0a', stroke: '#333333', strokeWidth: 0.04 });
      } else if (o.type === 'mineral') {
		//text of the mineralType
		const mineralType = typeof o.mineralType === 'string' ? o.mineralType : '?';
		const mineralColor = MINERAL_COLORS[mineralType] || '#cdcdcd';
		//75% darker
		const mineralDarkColor = `#${mineralColor.slice(1).split('').map(c => (parseInt(c, 16) * 0.25 | 0).toString(16)).join('')}`;
		circle(ctx, o.x + 0.5, o.y + 0.5, { radius: 0.55, fill: mineralDarkColor, stroke: mineralColor, strokeWidth: 0.1 });
		text(ctx, mineralType, o.x + 0.5, o.y + 0.80, { font: 0.85, fill: mineralColor});
      } else if (o.type === 'controller') {
		//draw a octagon for the controller base, with a number for the level with a flat top and sides
		const octagon = [ [0.292893, 0], [0.707107, 0], [1, 0.292893], [1, 0.707107], [0.707107, 1], [0.292893, 1], [0, 0.707107], [0, 0.292893],];
		const octagonPoints = octagon.map(([dx, dy]) => [o.x -0.25 + dx*1.5, o.y -0.25 + dy*1.5]);
		poly(ctx, octagonPoints, { fill: '#0a0a0a', stroke: '#000', strokeWidth: 0.1 });
		//draw a triangle for each level, with the tip pointing up and the base flat, centered on the controller
		const level = Math.min(o.level ?? 0, 8);
		if (level > 0) {
			for (let i = 0; i < level; i++) {
				poly(ctx, [octagonPoints[i], octagonPoints[(i + 1) % 8], [o.x + 0.5, o.y + 0.5]], { fill: '#AAAAAA', stroke: '#000', strokeWidth: 0.1 });
			}
		}
		let controllerColour;
		if (level === 0) {
			controllerColour = '#444';
		} else {
			controllerColour = o.my ? '#5577ff' : '#ff5555';
		}
		circle(ctx, o.x + 0.5, o.y + 0.5, { radius: 0.4, fill: controllerColour, stroke: '#000', strokeWidth: 0.05 });
      }
    }
    connectRoads(ctx, roads);
    ctx.restore();
  }
  drawFlags(ctx, frame.flags, layout);
}

// Recorded flags use the engine's compact `data` wire string; map previews use
// direct {room,name,x,y} entries. Normalising both here keeps every canvas
// consumer on the replay renderer's visual implementation.
export function drawFlags(ctx: CanvasRenderingContext2D, rawFlags: unknown[], layout: StageLayout): void {
  const flags: Array<{ room: string; name: string; x: number; y: number }> = [];
  for (const value of rawFlags || []) {
    if (!value || typeof value !== 'object') continue;
    const flag = value as Record<string, unknown>;
    const room = typeof flag.room === 'string' ? flag.room : '';
    if (!room || !layout.offsets[room]) continue;
    if (typeof flag.x === 'number' && typeof flag.y === 'number') {
      flags.push({ room, name: typeof flag.name === 'string' ? flag.name : 'flag', x: flag.x, y: flag.y });
      continue;
    }
    if (typeof flag.data !== 'string') continue;
    for (const entry of flag.data.split('|').filter(Boolean)) {
      const fields = entry.split('~');
      const x = Number(fields[3]), y = Number(fields[4]);
      if (Number.isFinite(x) && Number.isFinite(y)) flags.push({ room, name: fields[0] || 'flag', x, y });
    }
  }
  for (const flag of flags) {
    const off = layout.offsets[flag.room];
    const x = off.col * 50 + flag.x + 0.5;
    const y = off.row * 50 + flag.y + 0.5;
    poly(ctx, [[x, y + 0.3], [x, y - 0.5], [x + 0.5, y - 0.3], [x, y - 0.1]],
      { stroke: '#ffffff', strokeWidth: 0.08, fill: '#ff6666', opacity: 0.9 });
    text(ctx, flag.name, x, y + 0.85, { font: 0.4, fill: '#ffffff', opacity: 0.8 });
  }
}

export function drawStaticScene(
  ctx: CanvasRenderingContext2D,
  scene: { terrain: Record<string, string[]>; frame: Frame; layout: StageLayout },
  options: { initialSourceEnergy?: boolean } = {},
): void {
  drawTerrainScene(ctx, scene.terrain, scene.layout);
  drawStaticStructures(ctx, scene.frame, scene.layout);
  for (const object of scene.frame.objects) {
    const off = scene.layout.offsets[object.room];
    if (!off) continue;
    const cx = off.col * 50 + object.x + 0.5;
    const cy = off.row * 50 + object.y + 0.5;
    if (object.type === 'tower') drawTowerTurret(ctx, object, cx, cy, scene.frame.gameTime);
    else if (options.initialSourceEnergy && object.type === 'source') drawSourceCore(ctx, object, cx, cy);
  }
}

export function buildStructureCanvas(
  frame: Frame,
  layout: StageLayout,
  res = STATIC_RES,
  canvasFactory: CanvasFactory = browserCanvas,
): HTMLCanvasElement {
  const colsTiles = (layout.width / layout.pixelsPerRoom) * 50;
  const rowsTiles = (layout.height / layout.pixelsPerRoom) * 50;
  const cv = canvasFactory(
    Math.max(1, Math.round(colsTiles * res)),
    Math.max(1, Math.round(rowsTiles * res)),
  );
  const ctx = cv.getContext('2d')!;
  ctx.scale(res, res);
  drawStaticStructures(ctx, frame, layout);
  return cv;
}

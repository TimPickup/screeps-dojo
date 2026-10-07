// Nukes: the nuker's charge, a nuke's flight from its launch room, and the
// one-tick impact. The landing marker itself lives with the other per-frame
// objects (dynamic.ts drawNuke).
//
// A nuke in flight is only a `nuke` object in the TARGET room — { landTime,
// launchRoomName } — so the flight is reconstructed from those two fields: it
// left NUKE_LAND_TIME ticks before it lands, from the launch room's nuker (or
// that room's centre once the nuker is gone, or was never recorded).
import type { Frame, FrameObject, StageLayout } from '../api/types.ts';
import { roomNameToXY } from '../render/geometry.ts';
import { RENDER_COLORS, ROOM_SIZE_TILES } from './renderConstants.ts';

type CanvasContext = CanvasRenderingContext2D;

export const NUKE_LAND_TIME = 50000;
const NUKER_ENERGY_CAPACITY = 300000;
const NUKER_GHODIUM_CAPACITY = 5000;

const NUKE_STYLE = {
	arcColor: '#ff5a4a',
	// how far the arc bows out, as a fraction of the launch→target distance
	arcLift: 0.28,
	rocketOpacity: 0.72,
	// rocket length in tiles, and the smallest it may shrink to on screen
	rocketLength: 3,
	rocketMinPixels: 26,
	lineMinPixels: 1.5,
	shockMinPixels: 2,
} as const;

function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

function storeAmount(object: FrameObject, resource: string): number {
	return (object.store as Record<string, number> | undefined)?.[resource] || 0;
}

function capacityOf(object: FrameObject, resource: string, fallback: number): number {
	const capacity = (object.storeCapacityResource as Record<string, number> | undefined)?.[resource];
	return capacity && capacity > 0 ? capacity : fallback;
}

// ---- nuker charge -----------------------------------------------------------

// Drawn over the baked nuker (structures.ts): ghodium as a white bar inside
// the dark base band, energy filling the inner triangle from the bottom up.
// The triangle fills by AREA, so a half-charged nuker shows half its yellow.
export function drawNukerFill(ctx: CanvasContext, object: FrameObject, cx: number, cy: number): void {
	const ghodium = clamp01(storeAmount(object, 'G') / capacityOf(object, 'G', NUKER_GHODIUM_CAPACITY));
	const energy = clamp01(storeAmount(object, 'energy') / capacityOf(object, 'energy', NUKER_ENERGY_CAPACITY));
	if (ghodium > 0) {
		ctx.fillStyle = RENDER_COLORS.resources.other;
		ctx.fillRect(cx - 0.38, cy + 0.29, 0.76 * ghodium, 0.12);
	}
	if (energy > 0) {
		// The inner triangle runs apex (0,-0.8) to base y=0.2. Empty space is a
		// similar triangle at the apex whose area is (1 - energy) of the whole.
		const apexY = -0.8, baseY = 0.2;
		const surfaceY = apexY + (baseY - apexY) * Math.sqrt(1 - energy);
		const halfWidthAt = (y: number) => 0.4 * (y - apexY) / (baseY - apexY);
		const surfaceHalf = halfWidthAt(surfaceY);
		ctx.beginPath();
		ctx.moveTo(cx - surfaceHalf, cy + surfaceY);
		ctx.lineTo(cx + surfaceHalf, cy + surfaceY);
		ctx.lineTo(cx + 0.4, cy + baseY);
		ctx.lineTo(cx - 0.4, cy + baseY);
		ctx.closePath();
		ctx.fillStyle = RENDER_COLORS.resources.energy;
		ctx.fill();
	}
}

// ---- flight -----------------------------------------------------------------

// World-tile origin of a room. A room outside the recorded layout (a nuke
// launched from far away) is placed by its map coordinates relative to one
// that is in it, so the arc still comes in from the right direction.
export function roomWorldOrigin(roomName: string, layout: StageLayout): { x: number; y: number } | null {
	const offsets = layout.offsets;
	const own = offsets[roomName];
	if (own) return { x: own.col * ROOM_SIZE_TILES, y: own.row * ROOM_SIZE_TILES };
	const reference = Object.keys(offsets)[0];
	if (!reference || !/^[WE]\d+[NS]\d+$/.test(roomName)) return null;
	const from = roomNameToXY(reference), to = roomNameToXY(roomName);
	return {
		x: (offsets[reference].col + to.x - from.x) * ROOM_SIZE_TILES,
		y: (offsets[reference].row + to.y - from.y) * ROOM_SIZE_TILES,
	};
}

export interface NukeFlight {
	// launch point, landing tile centre and the arc's control point (world tiles)
	sx: number; sy: number;
	tx: number; ty: number;
	qx: number; qy: number;
	// 0 at launch, 1 at impact
	progress: number;
}

// When a nuke lands. A recorded frame has the absolute `landTime`; a map (the
// editor, the scenario preview) has it relative, as `ticks.landTime`, which
// counts from `gameTime`.
export function nukeLandTime(nuke: FrameObject, gameTime: number): number | null {
	if (typeof nuke.landTime === 'number') return nuke.landTime;
	const relative = (nuke.ticks as Record<string, unknown> | undefined)?.landTime;
	return typeof relative === 'number' ? gameTime + relative : null;
}

export function nukeFlight(nuke: FrameObject, launcher: FrameObject | undefined, layout: StageLayout, time: number): NukeFlight | null {
	const target = roomWorldOrigin(nuke.room, layout);
	const launchRoom = typeof nuke.launchRoomName === 'string' ? nuke.launchRoomName : null;
	const launch = launchRoom ? roomWorldOrigin(launchRoom, layout) : null;
	const landTime = nukeLandTime(nuke, Math.floor(time));
	if (!target || !launch || landTime === null) return null;
	// the nuker's centre, or the launch room's centre
	const sx = launch.x + (launcher ? launcher.x + 0.5 : ROOM_SIZE_TILES / 2);
	const sy = launch.y + (launcher ? launcher.y + 0.5 : ROOM_SIZE_TILES / 2);
	const tx = target.x + nuke.x + 0.5, ty = target.y + nuke.y + 0.5;
	const dx = tx - sx, dy = ty - sy;
	// Bow the arc out sideways, always toward the top of the screen (a lob
	// reads as "up"); a straight vertical shot bows to the left.
	let nx = dy, ny = -dx;
	if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
	const length = Math.hypot(nx, ny) || 1;
	const lift = Math.hypot(dx, dy) * NUKE_STYLE.arcLift;
	return {
		sx, sy, tx, ty,
		qx: (sx + tx) / 2 + nx / length * lift,
		qy: (sy + ty) / 2 + ny / length * lift,
		progress: clamp01(1 - (landTime - time) / NUKE_LAND_TIME),
	};
}

function bezierPoint(f: NukeFlight, t: number): { x: number; y: number } {
	const u = 1 - t;
	return {
		x: u * u * f.sx + 2 * u * t * f.qx + t * t * f.tx,
		y: u * u * f.sy + 2 * u * t * f.qy + t * t * f.ty,
	};
}

export interface FrameNukes {
	nukes: FrameObject[];
	// Every nuker keyed by room — a nuke's launcher is the one in its launch
	// room. Rooms hold at most one nuker.
	nukers: Map<string, FrameObject>;
}

// A replay draws the same frame many animation frames in a row, and almost
// never has a nuke in it: one scan per frame, cached, keeps the nuke pass free.
const frameNukesCache = new WeakMap<Frame, FrameNukes>();

export function frameNukes(frame: Frame): FrameNukes {
	let cached = frameNukesCache.get(frame);
	if (!cached) {
		cached = { nukes: [], nukers: new Map() };
		for (const object of frame.objects) {
			if (object.type === 'nuke') cached.nukes.push(object);
			else if (object.type === 'nuker') cached.nukers.set(object.room, object);
		}
		frameNukesCache.set(frame, cached);
	}
	return cached;
}

// Every nuke in a still frame (map editor, scenario preview): its flight, with
// line widths sized from the canvas's current scale.
export function drawNukeFlights(ctx: CanvasContext, frame: Frame, layout: StageLayout): void {
	const { nukes, nukers } = frameNukes(frame);
	if (!nukes.length) return;
	const pixelsPerTile = Math.abs(ctx.getTransform?.().a || 1);
	for (const object of nukes) {
		const flight = nukeFlight(object, nukers.get(String(object.launchRoomName)), layout, frame.gameTime);
		if (flight) drawNukeFlight(ctx, flight, frame.gameTime, pixelsPerTile);
	}
}

// The arc and the rocket riding it. Not an object: nothing here is hit-tested.
export function drawNukeFlight(ctx: CanvasContext, flight: NukeFlight, time: number, pixelsPerTile: number): void {
	const lineWidth = Math.max(0.14, NUKE_STYLE.lineMinPixels / pixelsPerTile);
	const t = flight.progress;
	// Split the curve at the rocket (de Casteljau): the flown part fades, the
	// part still to come is a brighter dashed line.
	const ax = flight.sx + (flight.qx - flight.sx) * t, ay = flight.sy + (flight.qy - flight.sy) * t;
	const bx = flight.qx + (flight.tx - flight.qx) * t, by = flight.qy + (flight.ty - flight.qy) * t;
	const rocket = bezierPoint(flight, t);
	ctx.save();
	ctx.lineCap = 'round';
	ctx.strokeStyle = NUKE_STYLE.arcColor;
	ctx.lineWidth = lineWidth;
	ctx.globalAlpha = 0.18;
	ctx.beginPath();
	ctx.moveTo(flight.sx, flight.sy);
	ctx.quadraticCurveTo(ax, ay, rocket.x, rocket.y);
	ctx.stroke();
	ctx.globalAlpha = 0.5;
	ctx.setLineDash([lineWidth * 4, lineWidth * 3]);
	ctx.beginPath();
	ctx.moveTo(rocket.x, rocket.y);
	ctx.quadraticCurveTo(bx, by, flight.tx, flight.ty);
	ctx.stroke();
	ctx.restore();

	// heading = the curve's tangent at t
	const angle = Math.atan2(by - ay, bx - ax);
	const size = Math.max(NUKE_STYLE.rocketLength, NUKE_STYLE.rocketMinPixels / pixelsPerTile);
	// The rocket slides along its own length as it flies: at launch its tail
	// sits on the curve's start (the nuker's centre), at impact its nose is on
	// the landing tile's centre.
	const shift = size * (ROCKET_TAIL + (ROCKET_NOSE + ROCKET_TAIL) * -t);
	const rocketX = rocket.x + Math.cos(angle) * shift, rocketY = rocket.y + Math.sin(angle) * shift;
	// Altitude: the shadow drops away from the rocket mid-flight and meets it
	// at both ends.
	const altitude = Math.sin(Math.PI * t) * size * 0.35;
	ctx.save();
	ctx.globalAlpha = 0.16;
	ctx.fillStyle = RENDER_COLORS.black;
	ctx.translate(rocketX + altitude * 0.6, rocketY + altitude);
	ctx.rotate(angle);
	ctx.beginPath();
	ctx.ellipse(0, 0, size * 0.36, size * 0.075, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	ctx.save();
	ctx.globalAlpha = NUKE_STYLE.rocketOpacity;
	ctx.translate(rocketX, rocketY);
	ctx.rotate(angle);
	ctx.scale(size, size);
	drawRocket(ctx, time);
	ctx.restore();
}

// Where drawRocket's body ends, in its own units: the tail (fins and body,
// not the flame) at -ROCKET_TAIL, the nose tip at +ROCKET_NOSE.
const ROCKET_TAIL = 0.38;
const ROCKET_NOSE = 0.5;

// A cartoon rocket seen from above, pointing along +x, one unit long.
function drawRocket(ctx: CanvasContext, time: number): void {
	const outline = '#20242b';
	ctx.lineJoin = 'round';
	ctx.lineWidth = 0.022;
	ctx.strokeStyle = outline;

	// exhaust: two tongues of flame that flicker with replay time
	const flicker = 0.85 + 0.15 * Math.sin(time * 37) * Math.sin(time * 23);
	ctx.fillStyle = '#ff7a1a';
	ctx.beginPath();
	ctx.moveTo(-0.36, -0.07);
	ctx.quadraticCurveTo(-0.36 - 0.3 * flicker, 0, -0.36, 0.07);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = '#ffe680';
	ctx.beginPath();
	ctx.moveTo(-0.36, -0.04);
	ctx.quadraticCurveTo(-0.36 - 0.17 * flicker, 0, -0.36, 0.04);
	ctx.closePath();
	ctx.fill();

	// fins (behind the body)
	ctx.fillStyle = '#c8322b';
	for (const side of [-1, 1]) {
		ctx.beginPath();
		ctx.moveTo(-0.14, side * 0.085);
		ctx.lineTo(-0.38, side * 0.22);
		ctx.lineTo(-0.38, side * 0.085);
		ctx.closePath();
		ctx.fill(); ctx.stroke();
	}

	// body: a capsule, light grey with a shaded lower half
	ctx.fillStyle = '#e4e8ee';
	ctx.beginPath();
	ctx.moveTo(-0.36, -0.09);
	ctx.lineTo(0.2, -0.09);
	ctx.quadraticCurveTo(0.42, -0.07, 0.5, 0);
	ctx.quadraticCurveTo(0.42, 0.07, 0.2, 0.09);
	ctx.lineTo(-0.36, 0.09);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = '#b9c0ca';
	ctx.fillRect(-0.36, 0.02, 0.56, 0.07);
	ctx.beginPath();
	ctx.moveTo(-0.36, -0.09);
	ctx.lineTo(0.2, -0.09);
	ctx.quadraticCurveTo(0.42, -0.07, 0.5, 0);
	ctx.quadraticCurveTo(0.42, 0.07, 0.2, 0.09);
	ctx.lineTo(-0.36, 0.09);
	ctx.closePath();
	ctx.stroke();

	// nose cone
	ctx.fillStyle = '#d8382f';
	ctx.beginPath();
	ctx.moveTo(0.26, -0.085);
	ctx.quadraticCurveTo(0.43, -0.065, 0.5, 0);
	ctx.quadraticCurveTo(0.43, 0.065, 0.26, 0.085);
	ctx.closePath();
	ctx.fill(); ctx.stroke();

	// hazard band and a radiation trefoil
	ctx.fillStyle = '#ffcf3a';
	ctx.fillRect(0.12, -0.088, 0.07, 0.176);
	ctx.strokeRect(0.12, -0.088, 0.07, 0.176);
	ctx.fillStyle = '#ffcf3a';
	ctx.beginPath();
	ctx.arc(-0.08, 0, 0.055, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = outline;
	for (let blade = 0; blade < 3; blade++) {
		const start = blade * Math.PI * 2 / 3 - Math.PI / 2 - Math.PI / 6;
		ctx.beginPath();
		ctx.moveTo(-0.08, 0);
		ctx.arc(-0.08, 0, 0.048, start, start + Math.PI / 3);
		ctx.closePath();
		ctx.fill();
	}
	ctx.beginPath();
	ctx.arc(-0.08, 0, 0.012, 0, Math.PI * 2);
	ctx.fill();

	// highlight along the top
	ctx.strokeStyle = 'rgba(255,255,255,0.8)';
	ctx.lineWidth = 0.018;
	ctx.beginPath();
	ctx.moveTo(-0.3, -0.055);
	ctx.lineTo(0.22, -0.055);
	ctx.stroke();
}

// ---- impact -----------------------------------------------------------------

// The tick a nuke lands: it is in this frame and gone from the next one, which
// has reached its landTime. (A nuke merely missing from a later frame — the
// recording ended, a scenario removed it — is not an impact.)
export function nukeLandsAfter(nuke: FrameObject, nextFrame: Frame | undefined, nextIds: ReadonlyMap<string, FrameObject> | null): boolean {
	if (!nextFrame || !nextIds || nextIds.has(nuke._id)) return false;
	return typeof nuke.landTime === 'number' && nextFrame.gameTime >= nuke.landTime;
}

// The same landing seen from the frame after it: the nuke was in the previous
// frame and is gone from this one, which has reached its landTime. The live
// view sits on the newest frame with nothing after it, so this is the only
// way it ever sees a landing.
export function nukeLandedBy(nuke: FrameObject, frame: Frame, ids: ReadonlyMap<string, FrameObject>): boolean {
	if (ids.has(nuke._id)) return false;
	return typeof nuke.landTime === 'number' && frame.gameTime >= nuke.landTime;
}

function easeOut(t: number): number {
	return 1 - (1 - t) * (1 - t) * (1 - t);
}

// One tick of impact, t in [0,1): a fireball filling the 5x5 blast square and
// a shock wave that runs from the landing tile out to every edge of the room.
// (cx, cy) is the landing tile's centre and (roomX, roomY) the room's
// top-left corner, in world tiles.
export function drawNukeImpact(
	ctx: CanvasContext, cx: number, cy: number, roomX: number, roomY: number, t: number, pixelsPerTile: number, seed: string,
): void {
	const room = ROOM_SIZE_TILES;
	ctx.save();
	ctx.beginPath();
	ctx.rect(roomX, roomY, room, room);
	ctx.clip();

	// flash: the whole room whites out for an instant
	if (t < 0.18) {
		ctx.globalAlpha = 0.45 * (1 - t / 0.18);
		ctx.fillStyle = '#fff6dc';
		ctx.fillRect(roomX, roomY, room, room);
	}

	// shock wave: a soft wide band with a bright leading edge, reaching the
	// farthest corner as the tick ends
	const reach = Math.max(
		Math.hypot(cx - roomX, cy - roomY), Math.hypot(cx - roomX - room, cy - roomY),
		Math.hypot(cx - roomX, cy - roomY - room), Math.hypot(cx - roomX - room, cy - roomY - room));
	const radius = reach * easeOut(clamp01(t / 0.9));
	const fade = 1 - clamp01((t - 0.35) / 0.65);
	if (radius > 0.5 && fade > 0) {
		const minWidth = NUKE_STYLE.shockMinPixels / pixelsPerTile;
		ctx.strokeStyle = '#fff2d0';
		ctx.globalAlpha = 0.22 * fade;
		ctx.lineWidth = Math.max(2.2, minWidth * 3);
		ctx.beginPath();
		ctx.arc(cx, cy, Math.max(0, radius - 1), 0, Math.PI * 2);
		ctx.stroke();
		ctx.globalAlpha = 0.75 * fade;
		ctx.lineWidth = Math.max(0.3, minWidth);
		ctx.beginPath();
		ctx.arc(cx, cy, radius, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.restore();

	// fireball, held inside the 5x5 blast square
	const grow = easeOut(clamp01(t / 0.35));
	const fireFade = 1 - clamp01((t - 0.5) / 0.5);
	if (fireFade > 0) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(cx - 2.5, cy - 2.5, 5, 5);
		ctx.clip();
		const fireRadius = 0.6 + 3 * grow;
		ctx.globalAlpha = fireFade;
		if (ctx.createRadialGradient) {
			const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, fireRadius);
			gradient.addColorStop(0, '#ffffff');
			gradient.addColorStop(0.18, '#fff1a8');
			gradient.addColorStop(0.42, '#ffb030');
			gradient.addColorStop(0.7, '#e8461c');
			gradient.addColorStop(1, 'rgba(120,20,10,0)');
			ctx.fillStyle = gradient;
		} else {
			ctx.fillStyle = '#ff8a1f';
		}
		ctx.beginPath();
		ctx.arc(cx, cy, fireRadius, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	// sparks: streaks thrown out past the blast square, angles fixed per nuke
	const sparkFade = 1 - clamp01((t - 0.2) / 0.8);
	if (sparkFade > 0) {
		ctx.save();
		ctx.lineCap = 'round';
		ctx.strokeStyle = '#ffe9a0';
		ctx.lineWidth = Math.max(0.12, 1 / pixelsPerTile);
		ctx.globalAlpha = sparkFade;
		let hash = 0;
		for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
		ctx.beginPath();
		for (let i = 0; i < 14; i++) {
			hash = (hash * 1103515245 + 12345) >>> 0;
			const angle = (i + (hash % 1000) / 1000) * Math.PI * 2 / 14;
			const speed = 0.7 + ((hash >>> 10) % 1000) / 1000 * 0.6;
			const head = (0.8 + 4.2 * easeOut(clamp01(t / 0.8))) * speed;
			const tail = head * 0.55;
			ctx.moveTo(cx + Math.cos(angle) * tail, cy + Math.sin(angle) * tail);
			ctx.lineTo(cx + Math.cos(angle) * head, cy + Math.sin(angle) * head);
		}
		ctx.stroke();
		ctx.restore();
	}
}

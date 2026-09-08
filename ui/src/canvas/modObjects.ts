// Objects that only exist because a game mod is loaded.
//
// The dojo draws everything else procedurally, but the reactor is the one thing
// a Season 5 replay is *about*, so it uses the official mod's own artwork
// (ui/src/assets/season5, MIT) and reproduces the look the official client
// gives it: a green core, a three-sided edge that rotates while the reactor is
// running, a green glow, and the owner's colour ringed around it.
//
// Everything here is fallback-safe. If the artwork did not load — the canvas
// unit tests pass no images at all — the same shapes are drawn as vectors.
import type { FrameObject } from '../api/types.ts';
import type { ModImages } from './modImages.ts';
import { circle, poly, text } from './primitives.ts';
import { REACTOR_RENDER_STYLE, RENDER_COLORS, UNKNOWN_OBJECT_RENDER_STYLE } from './renderConstants.ts';

// Rotation is derived from game time, never from wall clock: a replay exported
// to MP4 at 8x and the same replay scrubbed by hand have to look identical.
// The official client rotates the edge by π every four seconds, and one tick is
// one second of replay at 1x.
export function reactorAngle(gameTime: number): number {
	return (gameTime * Math.PI) / REACTOR_RENDER_STYLE.secondsPerHalfTurn;
}

// A reactor is "running" only while it is owned AND holding Thorium — exactly
// the condition the mod uses to decide whether it consumes and scores.
export function reactorIsRunning(object: FrameObject): boolean {
	const store = (object.store as Record<string, number> | undefined) || {};
	return Boolean(object.user) && (store.T || 0) > 0;
}

export function drawReactor(
	ctx: CanvasRenderingContext2D,
	object: FrameObject,
	centerX: number,
	centerY: number,
	gameTime: number,
	images?: ModImages,
): void {
	const style = REACTOR_RENDER_STYLE;
	const running = reactorIsRunning(object);

	// The glow sits under everything and is the cue that the thing is live.
	const glowRadius = running ? style.glowRadius : style.glowRadius * style.idleGlowScale;
	const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
	gradient.addColorStop(0, style.glowInner);
	gradient.addColorStop(1, RENDER_COLORS.transparent);
	ctx.save();
	ctx.globalAlpha = running ? style.glowOpacity : style.idleGlowOpacity;
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.arc(centerX, centerY, glowRadius, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	drawSprite(ctx, images?.reactorCore, centerX, centerY, style.size, 0, () => {
		// Fallback core: a hexagon in the mod's green.
		poly(ctx, hexagon(centerX, centerY, style.size * 0.3),
			{ fill: style.coreFill, stroke: style.coreOutline, strokeWidth: 0.06 });
	});

	// The edge is the only part that turns, and only while the reactor runs —
	// a claimed-but-empty reactor is deliberately static.
	const angle = running ? reactorAngle(gameTime) : 0;
	drawSprite(ctx, images?.reactorEdge, centerX, centerY, style.size, angle, () => {
		ctx.save();
		ctx.translate(centerX, centerY);
		ctx.rotate(angle);
		for (let i = 0; i < 3; i++) {
			const spoke = (i * Math.PI * 2) / 3;
			circle(ctx, Math.cos(spoke) * style.size * 0.36, Math.sin(spoke) * style.size * 0.36,
				{ radius: style.size * 0.11, fill: style.edgeFill });
		}
		ctx.restore();
	});

	// Ownership: the ring the official client draws as a userBadge.
	if (object.user) {
		circle(ctx, centerX, centerY, {
			radius: style.ownerRingRadius,
			stroke: object.my ? RENDER_COLORS.ownership.bot : RENDER_COLORS.ownership.opponent,
			strokeWidth: style.ownerRingWidth,
		});
	}
}

// A mod object nobody has drawn artwork for. Better a labelled marker than an
// invisible object: a scenario that places one should be able to see it, and a
// future mod gets something usable for free.
export function drawUnknownObject(
	ctx: CanvasRenderingContext2D,
	object: FrameObject,
	centerX: number,
	centerY: number,
): void {
	const style = UNKNOWN_OBJECT_RENDER_STYLE;
	circle(ctx, centerX, centerY, {
		radius: style.radius,
		fill: style.fill,
		stroke: style.stroke,
		strokeWidth: style.outlineWidth,
		lineStyle: 'dashed',
	});
	text(ctx, String(object.type || '?').slice(0, style.labelChars), centerX, centerY + style.labelOffsetY,
		{ font: style.labelFont, fill: style.stroke });
}

function hexagon(x: number, y: number, radius: number): number[][] {
	const points: number[][] = [];
	for (let i = 0; i < 6; i++) {
		const angle = (i * Math.PI) / 3 - Math.PI / 2;
		points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
	}
	return points;
}

// Draws `image` centred on the tile, rotated, at `size` tiles square — or runs
// `fallback` when the artwork is unavailable.
function drawSprite(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource | undefined,
	centerX: number,
	centerY: number,
	size: number,
	angle: number,
	fallback: () => void,
): void {
	if (!image) { fallback(); return; }
	ctx.save();
	ctx.translate(centerX, centerY);
	if (angle) ctx.rotate(angle);
	ctx.drawImage(image, -size / 2, -size / 2, size, size);
	ctx.restore();
}

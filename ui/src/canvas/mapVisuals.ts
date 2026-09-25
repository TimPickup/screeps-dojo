import type { StageLayout } from '../api/types.ts';
import { canvasFont, fillRenderText } from './renderFont.ts';
import { RENDER_COLORS, ROOM_SIZE_TILES } from './renderConstants.ts';

interface MapVisualStyle {
	align?: CanvasTextAlign;
	backgroundColor?: string;
	backgroundPadding?: number;
	color?: string;
	fill?: string;
	fontSize?: number;
	fontStyle?: string;
	fontVariant?: string;
	lineStyle?: 'dashed' | 'dotted' | 'solid';
	opacity?: number;
	radius?: number;
	stroke?: string;
	strokeWidth?: number;
	width?: number;
}

interface MapPoint {
	x: number;
	y: number;
	n: string;
}

interface MapVisualCommand {
	t: 'c' | 'l' | 'r' | 'p' | 't';
	s?: MapVisualStyle;
	x: number;
	y: number;
	n: string;
	x1: number;
	y1: number;
	n1: string;
	x2: number;
	y2: number;
	n2: string;
	w: number;
	h: number;
	points?: MapPoint[];
	text?: unknown;
}

// Replays the bot's Game.map.visual command string onto the canvas. Unlike a
// RoomVisual, every position names its own room, so one command can span rooms;
// one that touches a room outside the stage is skipped whole. Defaults follow
// the MapVisual docs, which are sized for the world map (a circle is 10 tiles
// across by default, text 10 tiles tall), not the RoomVisual ones.
export function drawMapVisuals(
	ctx: CanvasRenderingContext2D,
	rawCommands: string,
	offsets: StageLayout['offsets'],
): void {
	// +0.5 puts a position on its tile's centre, as for RoomVisuals.
	const world = (roomName: string, x: number, y: number) => {
		const roomOffset = offsets[roomName];
		return roomOffset
			? { x: roomOffset.col * ROOM_SIZE_TILES + x + 0.5, y: roomOffset.row * ROOM_SIZE_TILES + y + 0.5 }
			: null;
	};

	for (const serializedCommand of rawCommands.split('\n')) {
		if (!serializedCommand.trim()) continue;
		let command: MapVisualCommand;
		try {
			command = JSON.parse(serializedCommand) as MapVisualCommand;
		} catch {
			continue;
		}
		const style = command.s || {};
		const strokeWidth = style.strokeWidth !== undefined ? style.strokeWidth : 0.5;

		ctx.save();
		ctx.globalAlpha = style.opacity !== undefined ? style.opacity : 0.5;
		if (style.lineStyle === 'dashed') ctx.setLineDash([2, 1]);
		else if (style.lineStyle === 'dotted') ctx.setLineDash([0.5, 0.5]);

		if (command.t === 'c') {
			const center = world(command.n, command.x, command.y);
			if (center) {
				ctx.beginPath();
				ctx.arc(center.x, center.y, style.radius !== undefined ? style.radius : 10, 0, Math.PI * 2);
				fillAndStroke(ctx, style.fill === undefined ? RENDER_COLORS.defaultFill : style.fill, style.stroke, strokeWidth);
			}
		} else if (command.t === 'l') {
			const from = world(command.n1, command.x1, command.y1);
			const to = world(command.n2, command.x2, command.y2);
			if (from && to) {
				ctx.beginPath();
				ctx.moveTo(from.x, from.y);
				ctx.lineTo(to.x, to.y);
				ctx.lineWidth = style.width !== undefined ? style.width : 0.1;
				ctx.strokeStyle = style.color || RENDER_COLORS.defaultStroke;
				ctx.stroke();
			}
		} else if (command.t === 'r') {
			const corner = world(command.n, command.x, command.y);
			if (corner) {
				ctx.beginPath();
				ctx.rect(corner.x, corner.y, command.w, command.h);
				fillAndStroke(ctx, style.fill === undefined ? RENDER_COLORS.defaultFill : style.fill, style.stroke, strokeWidth);
			}
		} else if (command.t === 'p') {
			const points = (command.points || []).map((point) => world(point.n, point.x, point.y));
			if (points.length && points.every((point) => point)) {
				ctx.beginPath();
				points.forEach((point, i) => {
					if (i === 0) ctx.moveTo(point!.x, point!.y);
					else ctx.lineTo(point!.x, point!.y);
				});
				fillAndStroke(ctx, style.fill, style.stroke === undefined ? RENDER_COLORS.defaultStroke : style.stroke, strokeWidth);
			}
		} else if (command.t === 't') {
			const anchor = world(command.n, command.x, command.y);
			if (anchor) drawMapText(ctx, String(command.text), anchor.x, anchor.y, style);
		}
		ctx.restore();
	}
}

function fillAndStroke(
	ctx: CanvasRenderingContext2D,
	fill: string | undefined,
	stroke: string | undefined,
	strokeWidth: number,
): void {
	if (fill !== undefined && fill !== RENDER_COLORS.transparent) {
		ctx.fillStyle = fill;
		ctx.fill();
	}
	if (stroke) {
		ctx.lineWidth = strokeWidth;
		ctx.strokeStyle = stroke;
		ctx.stroke();
	}
}

function drawMapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: MapVisualStyle): void {
	const spec = {
		size: style.fontSize !== undefined && style.fontSize > 0 ? style.fontSize : 10,
		weight: /bold|[6-9]00/i.test((style.fontStyle || '') + ' ' + (style.fontVariant || '')) ? 700 as const : 400 as const,
		style: /italic|oblique/i.test(style.fontStyle || '') ? 'italic' as const : 'normal' as const,
	};
	const align = style.align || 'center';
	if (style.backgroundColor) {
		ctx.font = canvasFont(spec);
		const width = ctx.measureText(text).width;
		const padding = style.backgroundPadding !== undefined ? style.backgroundPadding : 2;
		const left = align === 'left' || align === 'start' ? x : align === 'right' || align === 'end' ? x - width : x - width / 2;
		ctx.fillStyle = style.backgroundColor;
		ctx.fillRect(left - padding, y - spec.size * 0.8 - padding, width + padding * 2, spec.size + padding * 2);
	}
	ctx.fillStyle = style.color || RENDER_COLORS.defaultFill;
	fillRenderText(ctx, text, x, y, spec, align);
}

import { fillRenderText, parseRenderFont } from './renderFont.ts';
import { RENDER_COLORS } from './renderConstants.ts';

interface RoomVisualStyle {
	align?: CanvasTextAlign;
	color?: string;
	fill?: string;
	font?: number | string;
	lineStyle?: 'dashed' | 'dotted' | 'solid';
	opacity?: number;
	radius?: number;
	stroke?: string;
	strokeWidth?: number;
	width?: number;
}

interface RoomVisualCommand {
	t: 'c' | 'l' | 'r' | 'p' | 't';
	s?: RoomVisualStyle;
	x: number;
	y: number;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	w: number;
	h: number;
	points?: number[][];
	text?: unknown;
}

// Replays the bot's RoomVisual command strings onto the canvas. Geometry is
// exact; styling maps the common RoomVisual options.
export function drawUserVisuals(
	ctx: CanvasRenderingContext2D,
	rawCommands: string,
	originX: number,
	originY: number,
): void {
	for (const serializedCommand of rawCommands.split('\n')) {
		if (!serializedCommand.trim()) continue;
		let command: RoomVisualCommand;
		try {
			command = JSON.parse(serializedCommand) as RoomVisualCommand;
		} catch {
			continue;
		}
		const style = command.s || {};
		const strokeColor = style.stroke || style.color;
		const strokeWidth = style.strokeWidth !== undefined
			? style.strokeWidth
			: (style.width !== undefined ? style.width : 0.1);

		ctx.save();
		ctx.globalAlpha = style.opacity !== undefined ? style.opacity : (command.t === 't' ? 1 : 0.5);
		if (style.lineStyle === 'dashed') ctx.setLineDash([0.3, 0.2]);
		else if (style.lineStyle === 'dotted') ctx.setLineDash([0.1, 0.1]);

		if (command.t === 'c') {
			ctx.beginPath();
			ctx.arc(originX + command.x, originY + command.y, style.radius !== undefined ? style.radius : 0.15, 0, Math.PI * 2);
			if (style.fill !== undefined && style.fill !== RENDER_COLORS.transparent) {
				ctx.fillStyle = style.fill;
				ctx.fill();
			} else if (style.fill === undefined && strokeColor === undefined) {
				ctx.fillStyle = RENDER_COLORS.defaultFill;
				ctx.fill();
			}
			if (strokeColor) {
				ctx.lineWidth = strokeWidth;
				ctx.strokeStyle = strokeColor;
				ctx.stroke();
			}
		} else if (command.t === 'l') {
			ctx.beginPath();
			ctx.moveTo(originX + command.x1, originY + command.y1);
			ctx.lineTo(originX + command.x2, originY + command.y2);
			ctx.lineWidth = strokeWidth;
			ctx.strokeStyle = strokeColor || RENDER_COLORS.defaultStroke;
			ctx.stroke();
		} else if (command.t === 'r') {
			if (style.fill !== undefined && style.fill !== RENDER_COLORS.transparent) {
				ctx.fillStyle = style.fill;
				ctx.fillRect(originX + command.x, originY + command.y, command.w, command.h);
			}
			if (strokeColor) {
				ctx.lineWidth = strokeWidth;
				ctx.strokeStyle = strokeColor;
				ctx.strokeRect(originX + command.x, originY + command.y, command.w, command.h);
			}
		} else if (command.t === 'p') {
			ctx.beginPath();
			const points = command.points || [];
			for (let i = 0; i < points.length; i++) {
				const x = originX + points[i][0], y = originY + points[i][1];
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			if (style.fill !== undefined && style.fill !== RENDER_COLORS.transparent) {
				ctx.fillStyle = style.fill;
				ctx.fill();
			}
			if (strokeColor !== undefined || style.fill === undefined) {
				ctx.lineWidth = strokeWidth;
				ctx.strokeStyle = strokeColor || RENDER_COLORS.defaultStroke;
				ctx.stroke();
			}
		} else if (command.t === 't') {
			ctx.fillStyle = style.color || RENDER_COLORS.defaultFill;
			fillRenderText(ctx, String(command.text), originX + command.x, originY + command.y, parseRenderFont(style.font), style.align || 'center');
		}
		ctx.restore();
	}
}

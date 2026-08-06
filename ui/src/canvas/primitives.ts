// Canvas implementations of the five RoomVisual primitives, operating on a
// CanvasRenderingContext2D in tile coordinates.
import { fillRenderText, parseRenderFont } from './renderFont.ts';
import { RENDER_COLORS } from './renderConstants.ts';

export interface ShapeStyle {
	fill?: string | null | false;
	stroke?: string | null | false | boolean;
	strokeWidth?: number;
	opacity?: number;
	radius?: number;
	lineStyle?: 'dashed' | 'dotted' | 'solid';
	font?: number | string;
	align?: CanvasTextAlign;
}

export type ArcStyle = Pick<ShapeStyle, 'stroke' | 'strokeWidth' | 'opacity' | 'lineStyle'>;

type CanvasContext = CanvasRenderingContext2D;

function paintColor(color: ShapeStyle['fill' | 'stroke']): string | null {
	return typeof color === 'string' && color !== RENDER_COLORS.transparent ? color : null;
}

function applyShapeStyle(ctx: CanvasContext, style: ShapeStyle): void {
	ctx.globalAlpha = style.opacity ?? 1;
	applyDash(ctx, style.lineStyle);
}

function applyDash(ctx: CanvasContext, lineStyle?: string): void {
	if (lineStyle === 'dashed') ctx.setLineDash([0.15, 0.1]);
	else if (lineStyle === 'dotted') ctx.setLineDash([0.05, 0.05]);
}

export function circle(ctx: CanvasContext, x: number, y: number, style: ShapeStyle = {}): void {
	ctx.save();
	applyShapeStyle(ctx, style);
	ctx.beginPath();
	ctx.arc(x, y, style.radius ?? 0.15, 0, Math.PI * 2);
	const fill = paintColor(style.fill), stroke = paintColor(style.stroke);
	if (fill) { ctx.fillStyle = fill; ctx.fill(); }
	if (stroke) { ctx.lineWidth = style.strokeWidth ?? 0.05; ctx.strokeStyle = stroke; ctx.stroke(); }
	ctx.restore();
}

export function arc(ctx: CanvasContext, x: number, y: number, radius: number, start: number, end: number, style: ArcStyle = {}): void {
	ctx.save();
	applyShapeStyle(ctx, style);
	ctx.beginPath();
	ctx.arc(x, y, radius, start, end);
	ctx.lineWidth = style.strokeWidth ?? 0.05;
	ctx.strokeStyle = paintColor(style.stroke) ?? RENDER_COLORS.defaultStroke;
	ctx.stroke();
	ctx.restore();
}

export function poly(ctx: CanvasContext, points: number[][], style: ShapeStyle = {}): void {
	if (!points.length) return;
	ctx.save();
	applyShapeStyle(ctx, style);
	ctx.beginPath();
	ctx.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
	ctx.closePath();
	const fill = paintColor(style.fill), stroke = paintColor(style.stroke);
	if (fill) { ctx.fillStyle = fill; ctx.fill(); }
	if (stroke) { ctx.lineWidth = style.strokeWidth ?? 0.05; ctx.strokeStyle = stroke; ctx.stroke(); }
	ctx.restore();
}

export function rect(ctx: CanvasContext, x: number, y: number, width: number, height: number, style: ShapeStyle = {}): void {
	ctx.save();
	applyShapeStyle(ctx, style);
	const fill = paintColor(style.fill), stroke = paintColor(style.stroke);
	if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, width, height); }
	if (stroke) { ctx.lineWidth = style.strokeWidth ?? 0.05; ctx.strokeStyle = stroke; ctx.strokeRect(x, y, width, height); }
	ctx.restore();
}

// Rounded rectangle centred on (x, y), sized by its half-extent.
export function roundedSquare(ctx: CanvasContext, x: number, y: number, halfSize: number, radius: number, style: ShapeStyle = {}): void {
	ctx.save();
	applyShapeStyle(ctx, style);
	roundedRectPath(ctx, x - halfSize, y - halfSize, halfSize * 2, halfSize * 2, radius);
	const fill = paintColor(style.fill), stroke = paintColor(style.stroke);
	if (fill) { ctx.fillStyle = fill; ctx.fill(); }
	if (stroke) { ctx.lineWidth = style.strokeWidth ?? 0.05; ctx.strokeStyle = stroke; ctx.stroke(); }
	ctx.restore();
}

export function roundedRectPath(ctx: CanvasContext, x: number, y: number, width: number, height: number, radius: number): void {
	const clampedRadius = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
	ctx.beginPath();
	ctx.moveTo(x + clampedRadius, y);
	ctx.arcTo(x + width, y, x + width, y + height, clampedRadius);
	ctx.arcTo(x + width, y + height, x, y + height, clampedRadius);
	ctx.arcTo(x, y + height, x, y, clampedRadius);
	ctx.arcTo(x, y, x + width, y, clampedRadius);
	ctx.closePath();
}

export function line(ctx: CanvasContext, x1: number, y1: number, x2: number, y2: number, style: ShapeStyle = {}): void {
	ctx.save();
	applyShapeStyle(ctx, style);
	ctx.beginPath();
	ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
	ctx.lineWidth = style.strokeWidth ?? 0.1;
	ctx.strokeStyle = paintColor(style.stroke) ?? RENDER_COLORS.defaultStroke;
	ctx.stroke();
	ctx.restore();
}

export function text(ctx: CanvasContext, content: string, x: number, y: number, style: ShapeStyle = {}): void {
	ctx.save();
	ctx.globalAlpha = style.opacity ?? 1;
	ctx.fillStyle = paintColor(style.fill) ?? RENDER_COLORS.defaultFill;
	fillRenderText(ctx, String(content), x, y, parseRenderFont(style.font), style.align ?? 'center');
	ctx.restore();
}

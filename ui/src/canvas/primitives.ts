// Canvas implementations of the five RoomVisual primitives, operating on a
// CanvasRenderingContext2D in tile coordinates.
import { fillRenderText, parseRenderFont } from './renderFont.ts';

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

type Ctx = CanvasRenderingContext2D;

function paintColor(v: ShapeStyle['fill' | 'stroke']): string | null {
	return typeof v === 'string' && v !== 'transparent' ? v : null;
}
function applyDash(ctx: Ctx, lineStyle?: string) {
	if (lineStyle === 'dashed') ctx.setLineDash([0.15, 0.1]);
	else if (lineStyle === 'dotted') ctx.setLineDash([0.05, 0.05]);
}

export function circle(ctx: Ctx, x: number, y: number, s: ShapeStyle = {}) {
	ctx.save();
	ctx.globalAlpha = s.opacity ?? 1;
	applyDash(ctx, s.lineStyle);
	ctx.beginPath();
	ctx.arc(x, y, s.radius ?? 0.15, 0, Math.PI * 2);
	const fill = paintColor(s.fill), stroke = paintColor(s.stroke);
	if (fill) { ctx.fillStyle = fill; ctx.fill(); }
	if (stroke) { ctx.lineWidth = s.strokeWidth ?? 0.05; ctx.strokeStyle = stroke; ctx.stroke(); }
	ctx.restore();
}

export function arc(ctx: Ctx, x: number, y: number, radius: number, start: number, end: number, s: ArcStyle = {}) {
	ctx.save();
	ctx.globalAlpha = s.opacity ?? 1;
	applyDash(ctx, s.lineStyle);
	ctx.beginPath();
	ctx.arc(x, y, radius, start, end);
	ctx.lineWidth = s.strokeWidth ?? 0.05;
	ctx.strokeStyle = paintColor(s.stroke) ?? '#ffffff';
	ctx.stroke();
	ctx.restore();
}

export function poly(ctx: Ctx, points: number[][], s: ShapeStyle = {}) {
	if (!points.length) return;
	ctx.save();
	ctx.globalAlpha = s.opacity ?? 1;
	applyDash(ctx, s.lineStyle);
	ctx.beginPath();
	ctx.moveTo(points[0][0], points[0][1]);
	for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
	ctx.closePath();
	const fill = paintColor(s.fill), stroke = paintColor(s.stroke);
	if (fill) { ctx.fillStyle = fill; ctx.fill(); }
	if (stroke) { ctx.lineWidth = s.strokeWidth ?? 0.05; ctx.strokeStyle = stroke; ctx.stroke(); }
	ctx.restore();
}

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, s: ShapeStyle = {}) {
	ctx.save();
	ctx.globalAlpha = s.opacity ?? 1;
	applyDash(ctx, s.lineStyle);
	const fill = paintColor(s.fill), stroke = paintColor(s.stroke);
	if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
	if (stroke) { ctx.lineWidth = s.strokeWidth ?? 0.05; ctx.strokeStyle = stroke; ctx.strokeRect(x, y, w, h); }
	ctx.restore();
}

export function roundedRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, radius: number) {
	const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

export function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, s: ShapeStyle = {}) {
	ctx.save();
	ctx.globalAlpha = s.opacity ?? 1;
	applyDash(ctx, s.lineStyle);
	ctx.beginPath();
	ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
	ctx.lineWidth = s.strokeWidth ?? 0.1;
	ctx.strokeStyle = paintColor(s.stroke) ?? '#ffffff';
	ctx.stroke();
	ctx.restore();
}

export function text(ctx: Ctx, str: string, x: number, y: number, s: ShapeStyle = {}) {
	ctx.save();
	ctx.globalAlpha = s.opacity ?? 1;
	ctx.fillStyle = paintColor(s.fill) ?? '#ffffff';
	fillRenderText(ctx, String(str), x, y, parseRenderFont(s.font), s.align ?? 'center');
	ctx.restore();
}

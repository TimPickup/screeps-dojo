import type { FrameObject } from '../api/types.ts';
import { roundedRectPath } from './primitives.ts';
import { DEPOSIT_RENDER_STYLE, RENDER_COLORS } from './renderConstants.ts';

type TracePath = (ctx: CanvasRenderingContext2D) => void;

// A deposit icon: one body path that is both filled and outlined, plus detail
// strokes drawn on top of the fill.
type DepositShape = {
	viewBoxWidth: number;
	viewBoxHeight: number;
	body: TracePath;
	details: readonly TracePath[];
	// Silicon's pins are drawn at the outline weight with flat ends; the other
	// icons use the thinner default detail stroke.
	detailWidth?: number;
	detailLineCap?: CanvasLineCap;
};

function traceBiomassTopDetail(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.moveTo(50.85, 18.44);
	ctx.bezierCurveTo(41.85, 28.55, 24.78, 31.95, 22.72, 15.51);
	ctx.bezierCurveTo(22.72, 9.34, 31.72, 11.19, 37.85, 7.08);
	ctx.bezierCurveTo(48.13, 0.91, 53.56, -0.94, 56, 9);
	ctx.bezierCurveTo(56.24, 12.79, 53.57, 15.3, 50.85, 18.44);
	ctx.closePath();
}

function traceBiomassBottomDetail(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.moveTo(16, 109.17);
	ctx.bezierCurveTo(21, 112, 27, 116, 34.89, 118);
	ctx.bezierCurveTo(41.11, 119.55, 40.77, 128.67, 34.46, 129.78);
	ctx.bezierCurveTo(32.9, 130.1, 31.2, 130, 29.78, 129.62);
	ctx.bezierCurveTo(29.2, 129.5, 28.6, 129.2, 28.2, 128.83);
	ctx.bezierCurveTo(22.46, 124.9, 17.72, 122.37, 9.32, 122.47);
	ctx.bezierCurveTo(5.25, 123.04, 5.6, 117.9, 6.52, 113.03);
	ctx.bezierCurveTo(6.65, 112.35, 6.82, 111.8, 7.08, 111.41);
	ctx.lineTo(7.14, 111.3);
	ctx.bezierCurveTo(9, 107.8, 13, 107.5, 16, 109.17);
	ctx.closePath();
}

function traceBiomassOutline(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.moveTo(115.43, 79.57);
	ctx.bezierCurveTo(115.43, 90.01, 93.27, 138.3, 59.71, 122.57);
	ctx.bezierCurveTo(39.31, 91.31, 5.51, 103.57, 4, 79.57);
	ctx.bezierCurveTo(4, 13.82, 26.14, 54, 54.5, 28.21);
	ctx.bezierCurveTo(103.23, -16, 115.43, 50.77, 115.43, 79.57);
	ctx.closePath();
}

function traceMetalOutline(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.moveTo(115.87, 54.77);
	ctx.bezierCurveTo(115.71, 53.28, 113.97, 52.16, 112.47, 52.16);
	ctx.bezierCurveTo(107.61, 52.22, 103.23, 49.28, 101.45, 44.76);
	ctx.bezierCurveTo(99.67, 40.24, 100.87, 35.09, 104.47, 31.83);
	ctx.bezierCurveTo(105.61, 30.79, 105.75, 29.04, 104.79, 27.83);
	ctx.bezierCurveTo(102.33, 24.7, 99.52, 21.86, 96.41, 19.37);
	ctx.bezierCurveTo(95.2, 18.41, 93.45, 18.56, 92.41, 19.7);
	ctx.bezierCurveTo(89.02, 23.27, 83.81, 24.46, 79.21, 22.7);
	ctx.bezierCurveTo(74.64, 20.76, 71.79, 16.16, 72.07, 11.21);
	ctx.bezierCurveTo(72.16, 9.65, 71.02, 8.3, 69.47, 8.12);
	ctx.bezierCurveTo(65.52, 7.67, 61.52, 7.67, 57.57, 8.12);
	ctx.bezierCurveTo(56.06, 8.31, 54.94, 9.6, 54.95, 11.12);
	ctx.bezierCurveTo(55.11, 16.02, 52.22, 20.5, 47.7, 22.38);
	ctx.bezierCurveTo(43.13, 24.08, 37.98, 22.9, 34.6, 19.38);
	ctx.bezierCurveTo(33.56, 18.24, 31.81, 18.09, 30.6, 19.05);
	ctx.bezierCurveTo(27.43, 21.53, 24.56, 24.37, 22.04, 27.51);
	ctx.bezierCurveTo(21.11, 28.73, 21.25, 30.45, 22.36, 31.51);
	ctx.bezierCurveTo(26.05, 34.83, 27.26, 40.12, 25.36, 44.71);
	ctx.bezierCurveTo(23.31, 49.2, 18.77, 52.02, 13.84, 51.86);
	ctx.bezierCurveTo(12.29, 51.76, 10.93, 52.91, 10.79, 54.46);
	ctx.bezierCurveTo(10.33, 58.45, 10.33, 62.47, 10.79, 66.46);
	ctx.bezierCurveTo(10.95, 67.95, 12.74, 69.06, 14.26, 69.06);
	ctx.bezierCurveTo(19.03, 69.01, 23.35, 71.89, 25.14, 76.31);
	ctx.bezierCurveTo(26.97, 80.87, 25.77, 86.08, 22.14, 89.39);
	ctx.bezierCurveTo(21.03, 90.45, 20.89, 92.17, 21.82, 93.39);
	ctx.bezierCurveTo(24.28, 96.52, 27.09, 99.36, 30.19, 101.85);
	ctx.bezierCurveTo(31.4, 102.81, 33.15, 102.67, 34.19, 101.53);
	ctx.bezierCurveTo(37.57, 97.96, 42.77, 96.77, 47.37, 98.53);
	ctx.bezierCurveTo(51.95, 100.45, 54.82, 105.05, 54.53, 110.01);
	ctx.bezierCurveTo(54.44, 111.57, 55.58, 112.92, 57.13, 113.1);
	ctx.bezierCurveTo(61.08, 113.55, 65.08, 113.55, 69.03, 113.1);
	ctx.bezierCurveTo(70.54, 112.91, 71.66, 111.62, 71.65, 110.1);
	ctx.bezierCurveTo(71.47, 105.2, 74.36, 100.7, 78.89, 98.82);
	ctx.bezierCurveTo(83.46, 97.11, 88.62, 98.29, 91.99, 101.82);
	ctx.bezierCurveTo(93.04, 102.94, 94.77, 103.09, 95.99, 102.16);
	ctx.bezierCurveTo(99.15, 99.67, 102.03, 96.83, 104.55, 93.69);
	ctx.bezierCurveTo(105.51, 92.48, 105.37, 90.73, 104.23, 89.69);
	ctx.bezierCurveTo(100.54, 86.37, 99.34, 81.09, 101.23, 76.5);
	ctx.bezierCurveTo(103.09, 72.17, 107.34, 69.35, 112.05, 69.33);
	ctx.lineTo(112.7, 69.33);
	ctx.bezierCurveTo(114.26, 69.43, 115.62, 68.29, 115.8, 66.74);
	ctx.bezierCurveTo(116.28, 62.77, 116.3, 58.75, 115.87, 54.77);
	ctx.closePath();
}

function traceMetalTopLeftDetail(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.moveTo(47.71, 22.32);
	ctx.bezierCurveTo(45.77, 21.85, 44.26, 20.35, 43.77, 18.42);
	ctx.bezierCurveTo(43.28, 16.49, 43.9, 14.44, 45.38, 13.11);
	ctx.bezierCurveTo(45.9, 12.63, 45.97, 11.83, 45.53, 11.27);
	ctx.bezierCurveTo(44.39, 9.83, 43.09, 8.52, 41.66, 7.37);
	ctx.bezierCurveTo(41.1, 6.92, 40.29, 6.98, 39.81, 7.52);
	ctx.bezierCurveTo(38.24, 9.16, 35.84, 9.7, 33.72, 8.88);
	ctx.bezierCurveTo(31.62, 7.99, 30.3, 5.87, 30.43, 3.59);
	ctx.bezierCurveTo(30.47, 2.87, 29.95, 2.24, 29.23, 2.16);
	ctx.bezierCurveTo(27.41, 1.95, 25.56, 1.95, 23.74, 2.16);
	ctx.bezierCurveTo(23.04, 2.24, 22.51, 2.84, 22.54, 3.55);
	ctx.bezierCurveTo(22.62, 5.81, 21.29, 7.88, 19.2, 8.75);
	ctx.bezierCurveTo(17.1, 9.52, 14.75, 8.98, 13.2, 7.37);
	ctx.bezierCurveTo(12.72, 6.85, 11.92, 6.78, 11.36, 7.22);
	ctx.bezierCurveTo(9.9, 8.36, 8.57, 9.67, 7.41, 11.12);
	ctx.bezierCurveTo(6.93, 11.67, 6.98, 12.51, 7.52, 13);
	ctx.bezierCurveTo(9.21, 14.54, 9.75, 16.98, 8.88, 19.09);
	ctx.bezierCurveTo(7.94, 21.16, 5.84, 22.46, 3.57, 22.39);
	ctx.bezierCurveTo(2.85, 22.34, 2.23, 22.87, 2.16, 23.59);
	ctx.bezierCurveTo(1.95, 25.43, 1.95, 27.29, 2.16, 29.13);
	ctx.bezierCurveTo(2.35, 29.85, 3.01, 30.35, 3.76, 30.33);
	ctx.bezierCurveTo(5.95, 30.31, 7.94, 31.64, 8.76, 33.67);
	ctx.bezierCurveTo(9.59, 35.76, 9.05, 38.14, 7.4, 39.67);
	ctx.bezierCurveTo(6.88, 40.15, 6.81, 40.94, 7.25, 41.5);
	ctx.bezierCurveTo(8.38, 42.95, 9.68, 44.26, 11.11, 45.41);
	ctx.bezierCurveTo(11.38, 45.64, 11.73, 45.76, 12.08, 45.73);
	ctx.bezierCurveTo(12.44, 45.71, 12.77, 45.54, 13, 45.27);
	ctx.bezierCurveTo(14.57, 43.63, 16.97, 43.09, 19.09, 43.9);
	ctx.bezierCurveTo(21.06, 44.73, 22.35, 46.64, 22.39, 48.77);
}

function traceMetalBottomRightDetail(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.moveTo(130, 84.38);
	ctx.bezierCurveTo(129.94, 84.14, 129.72, 83.98, 129.47, 83.98);
	ctx.bezierCurveTo(128.72, 83.99, 128.04, 83.53, 127.77, 82.83);
	ctx.bezierCurveTo(127.5, 82.13, 127.68, 81.33, 128.24, 80.83);
	ctx.bezierCurveTo(128.41, 80.67, 128.43, 80.41, 128.29, 80.22);
	ctx.bezierCurveTo(127.91, 79.73, 127.47, 79.3, 126.99, 78.91);
	ctx.bezierCurveTo(126.82, 78.74, 126.54, 78.74, 126.37, 78.91);
	ctx.bezierCurveTo(125.85, 79.44, 125.07, 79.62, 124.37, 79.37);
	ctx.bezierCurveTo(123.66, 79.07, 123.22, 78.36, 123.26, 77.59);
	ctx.bezierCurveTo(123.27, 77.35, 123.1, 77.14, 122.86, 77.11);
	ctx.bezierCurveTo(122.25, 77.04, 121.63, 77.04, 121.02, 77.11);
	ctx.bezierCurveTo(120.78, 77.13, 120.6, 77.34, 120.61, 77.58);
	ctx.bezierCurveTo(120.64, 78.34, 120.19, 79.03, 119.49, 79.32);
	ctx.bezierCurveTo(118.79, 79.58, 118.01, 79.4, 117.49, 78.86);
	ctx.bezierCurveTo(117.32, 78.69, 117.04, 78.69, 116.87, 78.86);
	ctx.bezierCurveTo(116.38, 79.24, 115.93, 79.68, 115.54, 80.17);
	ctx.bezierCurveTo(115.37, 80.34, 115.37, 80.62, 115.54, 80.79);
	ctx.bezierCurveTo(116.1, 81.3, 116.28, 82.09, 116, 82.79);
	ctx.bezierCurveTo(115.68, 83.48, 114.98, 83.92, 114.22, 83.9);
	ctx.bezierCurveTo(114.1, 83.89, 113.99, 83.93, 113.9, 84);
	ctx.bezierCurveTo(113.81, 84.08, 113.76, 84.18, 113.75, 84.3);
	ctx.bezierCurveTo(113.67, 84.92, 113.67, 85.54, 113.75, 86.16);
	ctx.bezierCurveTo(113.82, 86.4, 114.04, 86.56, 114.29, 86.56);
	ctx.bezierCurveTo(115.03, 86.55, 115.69, 87, 115.97, 87.68);
	ctx.bezierCurveTo(116.25, 88.38, 116.07, 89.17, 115.52, 89.68);
	ctx.bezierCurveTo(115.35, 89.85, 115.35, 90.13, 115.52, 90.3);
	ctx.bezierCurveTo(115.9, 90.78, 116.33, 91.22, 116.81, 91.6);
	ctx.bezierCurveTo(116.98, 91.77, 117.26, 91.77, 117.43, 91.6);
	ctx.bezierCurveTo(117.94, 91.06, 118.73, 90.88, 119.43, 91.14);
	ctx.bezierCurveTo(120.14, 91.44, 120.58, 92.14, 120.54, 92.91);
	ctx.bezierCurveTo(120.53, 93.15, 120.7, 93.36, 120.94, 93.39);
	ctx.bezierCurveTo(121.27, 93.43, 121.61, 93.45, 121.94, 93.45);
	ctx.bezierCurveTo(122.24, 93.46, 122.53, 93.46, 122.83, 93.45);
	ctx.bezierCurveTo(123.07, 93.42, 123.25, 93.22, 123.24, 92.98);
	ctx.bezierCurveTo(123.21, 92.22, 123.66, 91.52, 124.36, 91.23);
	ctx.bezierCurveTo(125.06, 90.98, 125.84, 91.16, 126.36, 91.69);
	ctx.bezierCurveTo(126.53, 91.85, 126.8, 91.85, 126.97, 91.69);
	ctx.bezierCurveTo(127.46, 91.31, 127.91, 90.87, 128.3, 90.39);
	ctx.bezierCurveTo(128.47, 90.21, 128.47, 89.94, 128.3, 89.76);
	ctx.bezierCurveTo(127.74, 89.25, 127.56, 88.46, 127.84, 87.76);
	ctx.bezierCurveTo(128.13, 87.09, 128.78, 86.66, 129.51, 86.65);
	ctx.lineTo(129.62, 86.65);
	ctx.bezierCurveTo(129.86, 86.65, 130.07, 86.48, 130.1, 86.24);
	ctx.bezierCurveTo(130.14, 85.62, 130.1, 84.99, 130, 84.38);
	ctx.closePath();
}

function traceMistOutline(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.moveTo(68.45, 4.63);
	ctx.lineTo(4.11, 116.07);
	ctx.bezierCurveTo(3.85, 116.52, 3.84, 117.07, 4.1, 117.52);
	ctx.bezierCurveTo(4.36, 117.97, 4.84, 118.24, 5.36, 118.24);
	ctx.lineTo(134, 118.24);
	ctx.bezierCurveTo(134.52, 118.24, 134.99, 117.96, 135.25, 117.51);
	ctx.bezierCurveTo(135.51, 117.07, 135.51, 116.52, 135.25, 116.07);
	ctx.lineTo(71, 4.63);
	ctx.bezierCurveTo(70.75, 4.16, 70.26, 3.87, 69.72, 3.87);
	ctx.bezierCurveTo(69.19, 3.87, 68.7, 4.16, 68.45, 4.63);
	ctx.closePath();
}

function traceMistFunnelDetail(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.moveTo(42.39, 49.77);
	ctx.lineTo(26.24, 49.77);
	ctx.bezierCurveTo(23.62, 49.77, 21.2, 51.17, 19.89, 53.44);
	ctx.bezierCurveTo(18.58, 55.7, 18.57, 58.5, 19.88, 60.77);
	ctx.lineTo(63.34, 136.05);
	ctx.bezierCurveTo(64.65, 138.32, 67.07, 139.72, 69.7, 139.72);
	ctx.bezierCurveTo(72.32, 139.72, 74.74, 138.32, 76.05, 136.05);
	ctx.lineTo(119.51, 60.77);
	ctx.bezierCurveTo(120.82, 58.5, 120.82, 55.71, 119.51, 53.44);
	ctx.bezierCurveTo(118.2, 51.17, 115.78, 49.77, 113.16, 49.77);
	ctx.lineTo(97, 49.77);
}

function traceSiliconOutline(ctx: CanvasRenderingContext2D): void {
	roundedRectPath(ctx, 18.7, 18.7, 90.6, 90.6, 1);
}

// Chip pins: two per side, each running from the body edge to the viewBox edge.
const SILICON_PINS: readonly (readonly [number, number, number, number])[] = [
	[79.1, 109.3, 79.1, 128],
	[48.9, 109.3, 48.9, 128],
	[79.1, 0, 79.1, 18.7],
	[48.9, 0, 48.9, 18.7],
	[18.7, 79.1, 0, 79.1],
	[18.7, 48.9, 0, 48.9],
	[128, 79.1, 109.3, 79.1],
	[128, 48.9, 109.3, 48.9],
];

function traceSiliconPins(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	for (const [x1, y1, x2, y2] of SILICON_PINS) {
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
	}
}

const BIOMASS_SHAPE: DepositShape = {
	viewBoxWidth: 119.43,
	viewBoxHeight: 132,
	body: traceBiomassOutline,
	details: [traceBiomassTopDetail, traceBiomassBottomDetail],
};

const METAL_SHAPE: DepositShape = {
	viewBoxWidth: 132,
	viewBoxHeight: 117.54,
	body: traceMetalOutline,
	details: [traceMetalTopLeftDetail, traceMetalBottomRightDetail],
};

const MIST_SHAPE: DepositShape = {
	viewBoxWidth: 139.4,
	viewBoxHeight: 141.67,
	body: traceMistOutline,
	details: [traceMistFunnelDetail],
};

const SILICON_SHAPE: DepositShape = {
	viewBoxWidth: 128,
	viewBoxHeight: 128,
	body: traceSiliconOutline,
	details: [traceSiliconPins],
	detailWidth: DEPOSIT_RENDER_STYLE.outlineWidth,
	detailLineCap: 'butt',
};

const DEPOSIT_SHAPES: Readonly<Record<string, DepositShape>> = {
	biomass: BIOMASS_SHAPE,
	metal: METAL_SHAPE,
	mist: MIST_SHAPE,
	silicon: SILICON_SHAPE,
};

const DEPOSIT_COLORS: Readonly<Record<string, string>> = {
	biomass: RENDER_COLORS.deposit.biomass,
	metal: RENDER_COLORS.deposit.metal,
	mist: RENDER_COLORS.deposit.mist,
	silicon: RENDER_COLORS.deposit.silicon,
};

function drawDepositShape(
	ctx: CanvasRenderingContext2D,
	shape: DepositShape,
	color: string,
	centerX: number,
	centerY: number,
): void {
	const scale = DEPOSIT_RENDER_STYLE.size / Math.max(shape.viewBoxWidth, shape.viewBoxHeight);
	ctx.save();
	ctx.translate(
		centerX - shape.viewBoxWidth * scale / 2,
		centerY - shape.viewBoxHeight * scale / 2,
	);
	ctx.scale(scale, scale);
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineJoin = 'round';

	ctx.globalAlpha = DEPOSIT_RENDER_STYLE.fillOpacity;
	shape.body(ctx);
	ctx.fill();
	ctx.globalAlpha = 1;

	ctx.lineCap = shape.detailLineCap ?? 'round';
	ctx.lineWidth = (shape.detailWidth ?? DEPOSIT_RENDER_STYLE.detailWidth) / scale;
	for (const trace of shape.details) {
		trace(ctx);
		ctx.stroke();
	}

	ctx.lineCap = 'round';
	ctx.lineWidth = DEPOSIT_RENDER_STYLE.outlineWidth / scale;
	shape.body(ctx);
	ctx.stroke();
	ctx.restore();
}

export function drawDeposit(ctx: CanvasRenderingContext2D, object: FrameObject): void {
	const type = object.depositType ?? '';
	const shape = DEPOSIT_SHAPES[type];
	if (shape === undefined) return;
	drawDepositShape(ctx, shape, DEPOSIT_COLORS[type], object.x + 0.5, object.y + 0.5);
}

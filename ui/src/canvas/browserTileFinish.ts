import type { TileImage } from './roomTiles.ts';

// Browser hooks for the room tile cache (roomTiles.ts).
//
// Tiles are painted on an OffscreenCanvas and handed over as an ImageBitmap.
// transferToImageBitmap() makes the browser rasterise the tile right there,
// inside pump()'s timed region, so the build budget measures the real cost;
// and the result is GPU-resident, so drawing it each frame is a cheap blit.
// Without OffscreenCanvas (older browsers) a plain canvas is used as is.

export function createTileCanvas(width: number, height: number): HTMLCanvasElement {
	if (typeof OffscreenCanvas !== 'undefined') {
		// The painters only use the 2D context API the two canvases share.
		return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

export function finishTile(canvas: HTMLCanvasElement): TileImage {
	const offscreen = canvas as unknown as Partial<OffscreenCanvas>;
	if (typeof offscreen.transferToImageBitmap === 'function') return offscreen.transferToImageBitmap();
	return canvas;
}

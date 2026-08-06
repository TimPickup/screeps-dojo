import swampNoise1Url from '../assets/textures/swamp-noise1.png';
import swampNoise2Url from '../assets/textures/swamp-noise2.png';
import wallNoiseUrl from '../assets/textures/terrain-noise.png';
import type { TerrainTextures } from './terrainTextures.ts';

let terrainTexturesPromise: Promise<TerrainTextures> | null = null;

function loadImage(url: string, description: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Could not load ${description}: ${url}`));
		image.src = url;
	});
}

// Decode both source PNGs once, then share them between terrain caches.
export function loadBrowserTerrainTextures(): Promise<TerrainTextures> {
	if (!terrainTexturesPromise) {
		terrainTexturesPromise = Promise.all([
			loadImage(wallNoiseUrl, 'wall terrain texture'),
			loadImage(swampNoise1Url, 'first swamp terrain texture'),
			loadImage(swampNoise2Url, 'second swamp terrain texture'),
		]).then(([wallNoise, swampNoise1, swampNoise2]) => ({ wallNoise, swampNoise1, swampNoise2 }));
	}
	return terrainTexturesPromise;
}

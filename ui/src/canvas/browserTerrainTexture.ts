import terrainNoiseUrl from '../assets/textures/terrain-noise.png';

let terrainTexturePromise: Promise<HTMLImageElement> | null = null;

// Decode the source PNG once, then share the image between terrain caches.
export function loadBrowserTerrainTexture(): Promise<HTMLImageElement> {
	if (!terrainTexturePromise) {
		terrainTexturePromise = new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error(`Could not load terrain texture: ${terrainNoiseUrl}`));
			image.src = terrainNoiseUrl;
		});
	}
	return terrainTexturePromise;
}

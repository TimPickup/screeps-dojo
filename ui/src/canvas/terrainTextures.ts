import type { ModImages } from './modImages.ts';

export interface TerrainTextures {
	wallNoise?: CanvasImageSource;
	swampNoise1?: CanvasImageSource;
	swampNoise2?: CanvasImageSource;
}

export type CanvasPathFactory = () => Path2D;

export interface TerrainRenderResources {
	textures?: TerrainTextures;
	pathFactory?: CanvasPathFactory;
	// Artwork from a loaded game mod. It rides the same channel as the terrain
	// textures because the static structure layer needs it too (a Thorium
	// mineral is baked in there), and both renderers already thread this object
	// through. See modImages.ts.
	modImages?: ModImages;
}

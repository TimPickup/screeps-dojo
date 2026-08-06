export interface TerrainTextures {
	wallNoise?: CanvasImageSource;
	swampNoise1?: CanvasImageSource;
	swampNoise2?: CanvasImageSource;
}

export type CanvasPathFactory = () => Path2D;

export interface TerrainRenderResources {
	textures?: TerrainTextures;
	pathFactory?: CanvasPathFactory;
}

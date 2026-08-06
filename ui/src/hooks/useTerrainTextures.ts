import { useEffect, useState } from 'react';
import { loadBrowserTerrainTextures } from '../canvas/browserTerrainTextures';
import type { TerrainTextures } from '../canvas/terrainTextures';

export function useTerrainTextures(): TerrainTextures | null {
	const [terrainTextures, setTerrainTextures] = useState<TerrainTextures | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadBrowserTerrainTextures().then((textures) => {
			if (!cancelled) setTerrainTextures(textures);
		}).catch((error) => {
			console.error(error);
		});
		return () => { cancelled = true; };
	}, []);

	return terrainTextures;
}

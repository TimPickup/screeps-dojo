import { useEffect, useState } from 'react';
import { loadBrowserTerrainTexture } from '../canvas/browserTerrainTexture';

export function useTerrainTexture(): HTMLImageElement | null {
	const [terrainTexture, setTerrainTexture] = useState<HTMLImageElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadBrowserTerrainTexture().then((image) => {
			if (!cancelled) setTerrainTexture(image);
		}).catch((error) => {
			console.error(error);
		});
		return () => { cancelled = true; };
	}, []);

	return terrainTexture;
}

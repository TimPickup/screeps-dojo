import { useEffect, useState } from 'react';
import { loadBrowserModImages } from '../canvas/browserModImages';
import type { ModImages } from '../canvas/modImages';

// Artwork a loaded game mod brings (see canvas/modImages.ts). Returns an empty
// object until it resolves, never null: unlike the terrain textures, nothing
// here blocks a first paint — every drawing routine falls back to vectors.
export function useModImages(): ModImages {
	const [modImages, setModImages] = useState<ModImages>({});

	useEffect(() => {
		let cancelled = false;
		loadBrowserModImages().then((images) => {
			if (!cancelled) setModImages(images);
		}).catch((error) => {
			console.error(error);
		});
		return () => { cancelled = true; };
	}, []);

	return modImages;
}

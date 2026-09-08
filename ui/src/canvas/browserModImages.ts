import reactorCoreUrl from '../assets/season5/reactor-core.png';
import reactorEdgeUrl from '../assets/season5/reactor-edge.png';
import thoriumUrl from '../assets/season5/T.png';
import type { ModImages } from './modImages.ts';

let modImagesPromise: Promise<ModImages> | null = null;

function loadImage(url: string): Promise<HTMLImageElement | undefined> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(image);
		// A missing image must never break a replay: the drawing routines fall
		// back to vectors, so resolve rather than reject.
		image.onerror = () => resolve(undefined);
		image.src = url;
	});
}

// Decoded once and shared. Cheap enough to do unconditionally: three small PNGs,
// and a recording carries no reliable signal about which mods it needs until its
// frames are read.
export function loadBrowserModImages(): Promise<ModImages> {
	if (!modImagesPromise) {
		modImagesPromise = Promise.all([
			loadImage(reactorCoreUrl),
			loadImage(reactorEdgeUrl),
			loadImage(thoriumUrl),
		]).then(([reactorCore, reactorEdge, thorium]) => ({ reactorCore, reactorEdge, thorium }));
	}
	return modImagesPromise;
}

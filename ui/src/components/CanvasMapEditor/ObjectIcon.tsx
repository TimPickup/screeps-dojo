// A palette row's icon: the object drawn with the game's own artwork, not a
// stand-in glyph. Each one is a tiny canvas rendered through the same routines
// the map uses, so what you pick looks like what you get.

import { useEffect, useRef } from 'react';
import { useModImages } from '../../hooks/useModImages';
import { useTerrainTextures } from '../../hooks/useTerrainTextures';
import { makeEditableObject } from './mapModel';
import { drawObjectIcon } from './objectPreview';
import styles from './CanvasMapEditor.module.css';

export function ObjectIcon({ type, size = 22, rcl = 8 }: { type: string; size?: number; rcl?: number }) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const modImages = useModImages();
	const terrainTextures = useTerrainTextures();

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		// The icon draws a sample of exactly what the palette would place, so a
		// spawn shows its energy ring and a creep shows a body.
		const sample = makeEditableObject(type, 25, 25, { rcl });
		// A road draws itself from its neighbours, so a lone tile is a dot. The
		// icon shows a short run instead, which is what a road actually looks
		// like on the map.
		const neighbours = type === 'road'
			? [makeEditableObject('road', 24, 25), makeEditableObject('road', 26, 25)]
			: [];
		if (type === 'creep') sample.body = ['move', 'work', 'carry', 'attack'];
		if (type === 'controller') { sample.owner = 'me'; sample.level = 4; }
		if (type === 'source') { sample.energy = 3000; sample.energyCapacity = 3000; }
		if (type === 'extension' || type === 'tower') sample.store = { energy: 40 };
		if (type === 'storage' || type === 'terminal' || type === 'container') sample.store = { energy: 1000 };
		if (type === 'lab') sample.store = { energy: 1500, XUHO2: 2000 };
		if (type === 'constructionSite') sample.progress = 1500;
		try {
			drawObjectIcon(canvas, sample, size, { modImages, terrainTextures }, neighbours);
		} catch {
			// An icon is decoration: a renderer that cannot draw this type must
			// never take the palette down with it.
		}
	}, [type, size, rcl, modImages, terrainTextures]);

	return <canvas ref={canvasRef} className={styles.objectIcon} style={{ width: size, height: size }} aria-hidden />;
}

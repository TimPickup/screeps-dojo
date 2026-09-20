// The map canvas: the room as the replay draws it, plus the editing affordances
// — a ghost of what is about to be placed, a hover highlight, a coordinate
// badge, the selection ring, dragging, and the picker that appears when a click
// lands on a tile holding several things.
//
// Every object is drawn by objectPreview.ts, which the palette icons also use,
// so what you pick, what hovers under the cursor and what lands on the map are
// unmistakably the same thing.

import { useEffect, useRef, useState } from 'react';
import type { Frame, StageLayout } from '../../api/types';
import { drawRoomNames, drawTerrainScene } from '../../canvas/staticLayers';
import { CreepRenderer } from '../../canvas/creeps';
import { populateFrameMy } from '../../canvas/ownership';
import { computeStageLayout } from '../../render/geometry';
import type { TerrainTextures } from '../../canvas/terrainTextures';
import type { ModImages } from '../../canvas/modImages';
import { glyphFor, labelFor } from './gameData';
import { drawPreviewFrame, toFrameObject } from './objectPreview';
import { makeEditableObject, mapRcl, selectionRank, type EditableMap } from './mapModel';
import type { EditorMode } from './ModeRail';
import { ERASER } from './ConstructPanel';
import styles from './CanvasMapEditor.module.css';

export type Selection = { kind: 'structure' | 'flag'; index: number } | null;

const ROOM_TILES = 50;

// The editable model as the renderer's Frame.
export function frameFor(map: EditableMap): Frame {
	return populateFrameMy({
		gameTime: 0,
		objects: map.structures.map((object, index) => toFrameObject(object, map.room, index)),
		flags: map.flags.map((flag) => ({ room: map.room, ...flag })),
	});
}

interface Props {
	map: EditableMap;
	mode: EditorMode;
	buildType: string | null;
	terrainBrush: string;
	brushSize: number;
	selection: Selection;
	fontsReady: boolean;
	terrainTextures: TerrainTextures | null;
	modImages: ModImages;
	onSelect: (selection: Selection) => void;
	onPaint: (x: number, y: number) => void;
	onPaintEnd: () => void;
	onMoveObject: (index: number, x: number, y: number) => void;
	onHover: (tile: { x: number; y: number } | null) => void;
}

export function EditorCanvas({
	map, mode, buildType, terrainBrush, brushSize, selection, fontsReady,
	terrainTextures, modImages, onSelect, onPaint, onPaintEnd, onMoveObject, onHover,
}: Props) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const creepsRef = useRef<CreepRenderer>(new CreepRenderer());
	const paintingRef = useRef(false);
	const lastTileRef = useRef('');
	// Which object is being dragged, and whether the pointer has actually moved
	// (so a click that happens to land on a creep still selects rather than
	// counting as a zero-distance drag).
	const dragRef = useRef<{ index: number; moved: boolean } | null>(null);
	const [size, setSize] = useState(1);
	const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
	const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
	const [picker, setPicker] = useState<{ x: number; y: number; items: Array<{ selection: Selection; label: string; glyph: string }> } | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const resize = () => setSize(Math.max(1, Math.min(host.clientWidth - 20, host.clientHeight - 20, 980)));
		const observer = new ResizeObserver(resize);
		observer.observe(host);
		resize();
		return () => observer.disconnect();
	}, []);

	// A brush covers an odd-sided square centred on the cursor.
	const brushTiles = (x: number, y: number): Array<{ x: number; y: number }> => {
		const radius = Math.floor(brushSize / 2);
		const tiles: Array<{ x: number; y: number }> = [];
		for (let dy = -radius; dy <= radius; dy++) {
			for (let dx = -radius; dx <= radius; dx++) {
				const tx = x + dx;
				const ty = y + dy;
				if (tx >= 0 && tx < ROOM_TILES && ty >= 0 && ty < ROOM_TILES) tiles.push({ x: tx, y: ty });
			}
		}
		return tiles;
	};

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !fontsReady || !terrainTextures) return;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = Math.max(1, Math.floor(size * dpr));
		canvas.height = Math.max(1, Math.floor(size * dpr));
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = '#0e0e0e';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		const scale = size * dpr / ROOM_TILES;
		ctx.setTransform(scale, 0, 0, scale, 0, 0);

		const layout: StageLayout = computeStageLayout([map.room]);
		const frame = frameFor(map);
		const terrain = { [map.room]: map.terrain };
		drawTerrainScene(ctx, terrain, layout, terrainTextures);
		drawPreviewFrame(ctx, frame, layout, { terrainTextures, modImages, creeps: creepsRef.current, terrain });
		drawRoomNames(ctx, layout);


		// --- ghost of what the next click would do ---
		if (hover && mode !== 'select') {
			ctx.save();
			if (mode === 'terrain') {
				const fill = terrainBrush === '#' ? 'rgba(20,20,20,0.75)'
					: terrainBrush === '~' ? 'rgba(90,100,40,0.5)' : 'rgba(190,190,190,0.28)';
				ctx.fillStyle = fill;
				for (const tile of brushTiles(hover.x, hover.y)) ctx.fillRect(tile.x, tile.y, 1, 1);
				ctx.strokeStyle = 'rgba(255,255,255,0.5)';
				ctx.lineWidth = 0.06;
				const radius = Math.floor(brushSize / 2);
				ctx.strokeRect(hover.x - radius, hover.y - radius, brushSize, brushSize);
			} else if (buildType === ERASER) {
				ctx.strokeStyle = '#cc4444';
				ctx.lineWidth = 0.09;
				ctx.strokeRect(hover.x + 0.1, hover.y + 0.1, 0.8, 0.8);
				ctx.beginPath();
				ctx.moveTo(hover.x + 0.2, hover.y + 0.2);
				ctx.lineTo(hover.x + 0.8, hover.y + 0.8);
				ctx.moveTo(hover.x + 0.8, hover.y + 0.2);
				ctx.lineTo(hover.x + 0.2, hover.y + 0.8);
				ctx.stroke();
			} else if (buildType) {
				ctx.globalAlpha = 0.55;
				const ghost = makeEditableObject(buildType, hover.x, hover.y, {
					terrainTile: map.terrain[hover.y]?.[hover.x],
					existing: map.structures,
					rcl: mapRcl(map),
				});
				const ghostFrame = populateFrameMy({
					gameTime: 0,
					objects: buildType === 'flag' ? [] : [toFrameObject(ghost, map.room, 0)],
					flags: buildType === 'flag' ? [{ room: map.room, name: '', x: hover.x, y: hover.y }] : [],
				});
				drawPreviewFrame(ctx, ghostFrame, layout, {
					terrainTextures, modImages, creeps: creepsRef.current,
					// A ghost wall merges against the real terrain, so it previews the
					// shape it will actually take once placed.
					terrain: buildType === 'constructedWall' ? { [map.room]: map.terrain } : {},
				});
				ctx.globalAlpha = 1;
				ctx.strokeStyle = 'rgba(101,253,98,0.75)';
				ctx.lineWidth = 0.05;
				ctx.strokeRect(hover.x + 0.02, hover.y + 0.02, 0.96, 0.96);
			}
			ctx.restore();
		}

		// --- hover highlight (select mode has no ghost, so it gets the tint) ---
		if (hover && mode === 'select') {
			ctx.fillStyle = 'rgba(255,255,255,0.10)';
			ctx.fillRect(hover.x, hover.y, 1, 1);
		}

		// --- selection ring ---
		if (selection) {
			const selected = selection.kind === 'structure'
				? map.structures[selection.index]
				: map.flags[selection.index];
			if (selected) {
				ctx.strokeStyle = '#65fd62';
				ctx.lineWidth = 0.07;
				ctx.beginPath();
				ctx.arc(selected.x + 0.5, selected.y + 0.5, 0.62, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
	}, [map, mode, buildType, terrainBrush, brushSize, selection, hover, size, fontsReady, terrainTextures, modImages]);

	const tileFromPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			x: Math.max(0, Math.min(49, Math.floor((event.clientX - rect.left) * ROOM_TILES / rect.width))),
			y: Math.max(0, Math.min(49, Math.floor((event.clientY - rect.top) * ROOM_TILES / rect.height))),
		};
	};

	// Everything sitting on a tile, in the order a person most likely meant.
	const hitsAt = (x: number, y: number) => {
		const hits: Array<{ selection: Selection; label: string; glyph: string; rank: number }> = [];
		map.structures.forEach((object, index) => {
			if (object.x !== x || object.y !== y) return;
			const name = typeof object.name === 'string' && object.name ? ` · ${object.name}` : '';
			hits.push({
				selection: { kind: 'structure', index },
				label: labelFor(object.type) + name,
				glyph: glyphFor(object.type),
				rank: selectionRank(object.type),
			});
		});
		map.flags.forEach((flag, index) => {
			if (flag.x !== x || flag.y !== y) return;
			hits.push({ selection: { kind: 'flag', index }, label: `Flag · ${flag.name}`, glyph: '⚑', rank: 0 });
		});
		hits.sort((a, b) => a.rank - b.rank);
		return hits;
	};

	const cursorClass = mode === 'select'
		? (dragRef.current ? styles.cursorGrabbing : styles.cursorSelect)
		: (mode === 'build' && buildType === ERASER ? styles.cursorErase : styles.cursorPaint);

	const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
		if (event.button !== 0) return;
		setPicker(null);
		event.currentTarget.setPointerCapture(event.pointerId);
		const tile = tileFromPointer(event);
		lastTileRef.current = `${tile.x},${tile.y}`;

		if (mode === 'select') {
			const hits = hitsAt(tile.x, tile.y);
			if (!hits.length) { onSelect(null); return; }
			// A movable object under the pointer arms a drag; the click still
			// selects unless the pointer actually travels.
			const first = hits[0];
			if (first.selection?.kind === 'structure') {
				dragRef.current = { index: first.selection.index, moved: false };
			}
			if (hits.length === 1) { onSelect(first.selection); return; }
			const rect = hostRef.current!.getBoundingClientRect();
			setPicker({ x: event.clientX - rect.left, y: event.clientY - rect.top, items: hits });
			return;
		}

		paintingRef.current = true;
		if (mode === 'terrain') for (const t of brushTiles(tile.x, tile.y)) onPaint(t.x, t.y);
		else onPaint(tile.x, tile.y);
	};

	const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
		const tile = tileFromPointer(event);
		const rect = hostRef.current?.getBoundingClientRect();
		if (rect) setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
		if (!hover || hover.x !== tile.x || hover.y !== tile.y) { setHover(tile); onHover(tile); }

		const key = `${tile.x},${tile.y}`;
		if (dragRef.current && (event.buttons & 1)) {
			if (key !== lastTileRef.current) {
				lastTileRef.current = key;
				dragRef.current.moved = true;
				setPicker(null);
				onMoveObject(dragRef.current.index, tile.x, tile.y);
			}
			return;
		}
		if (!paintingRef.current || !(event.buttons & 1)) return;
		if (key === lastTileRef.current) return;
		lastTileRef.current = key;
		if (mode === 'terrain') for (const t of brushTiles(tile.x, tile.y)) onPaint(t.x, t.y);
		else onPaint(tile.x, tile.y);
	};

	const endPointer = () => {
		if (paintingRef.current || dragRef.current?.moved) onPaintEnd();
		paintingRef.current = false;
		dragRef.current = null;
		lastTileRef.current = '';
	};

	return (
		<div ref={hostRef} className={styles.canvasHost}>
			<canvas ref={canvasRef} className={`${styles.canvas} ${cursorClass}`}
				style={{ width: size, height: size }}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endPointer}
				onPointerCancel={endPointer}
				onPointerLeave={() => { endPointer(); setHover(null); setPointer(null); onHover(null); }} />

			{hover && pointer && (
				<div className={styles.cursorBadge} style={{ left: pointer.x, top: pointer.y }}>
					{hover.x}, {hover.y}
					{mode === 'build' && buildType && buildType !== ERASER && (
						<span className={styles.cursorBadgeSub}> · {labelFor(buildType)}</span>
					)}
					{mode === 'terrain' && (
						<span className={styles.cursorBadgeSub}> · {map.terrain[hover.y]?.[hover.x] ?? '?'}</span>
					)}
				</div>
			)}

			<div className={styles.hint}>
				{mode === 'select' ? 'click to select · drag to move · Del to delete'
					: mode === 'terrain' ? 'drag to paint'
						: buildType ? 'click or drag to place' : 'pick something to place →'}
			</div>

			{picker && (
				<div className={styles.picker} style={{ left: picker.x, top: picker.y }}
					onPointerDown={(event) => event.stopPropagation()}>
					<div className={styles.pickerHead}>{picker.items.length} things here</div>
					{picker.items.map((item, index) => {
						const isSelected = selection && item.selection
							&& selection.kind === item.selection.kind && selection.index === item.selection.index;
						return (
							<button key={index} type="button"
								className={isSelected ? `${styles.pickerItem} ${styles.pickerItemSel}` : styles.pickerItem}
								onClick={() => { onSelect(item.selection); setPicker(null); }}>
								<span className={styles.pickerGlyph}>{item.glyph}</span>
								{item.label}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

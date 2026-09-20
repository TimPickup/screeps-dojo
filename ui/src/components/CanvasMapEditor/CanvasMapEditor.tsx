import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRenderFonts } from '../../hooks/useRenderFonts';
import { useTerrainTextures } from '../../hooks/useTerrainTextures';
import { useModImages } from '../../hooks/useModImages';
import {
	canRedo, canUndo, pushHistory, redo, resetHistory, undo, type History,
} from './history';
import {
	countByType, makeEditableObject, mapRcl, nextCreepName, nextFlagName, parseEditableMap,
	serializeEditableMap, structureLayer, type EditableFlag, type EditableMap, type EditableObject,
} from './mapModel';
import { explicitCapacityFor } from './storeRules';
import { ModeRail, ROOM_RE, type EditorMode } from './ModeRail';
import { ConstructPanel, ERASER } from './ConstructPanel';
import { TerrainPanel } from './TerrainPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { EditorCanvas, type Selection } from './EditorCanvas';
import { labelFor } from './gameData';
import styles from './CanvasMapEditor.module.css';

export type CanvasMapEditorChangeKind = 'load' | 'edit';

interface Props {
	value: string;
	onChange: (value: string, kind: CanvasMapEditorChangeKind) => void;
	// Curated game mods this scenario selects (settings.json "mods"). They add
	// placeable objects and resources — a reactor is only offered where a run
	// would actually understand one.
	mods?: string[];
	// Player side names from the scenario's settings.json "bots". They are the
	// owner labels a map may use, so the owner dropdown offers exactly the ones
	// this scenario can actually run a codebase for.
	ownerLabels?: string[];
}

// Which edge tiles are not solid wall — i.e. where a creep can leave the room.
function exitSummary(terrain: string[]): string {
	const open = { top: 0, bottom: 0, left: 0, right: 0 };
	for (let i = 0; i < 50; i++) {
		if (terrain[0]?.[i] !== '#') open.top++;
		if (terrain[49]?.[i] !== '#') open.bottom++;
		if (terrain[i]?.[0] !== '#') open.left++;
		if (terrain[i]?.[49] !== '#') open.right++;
	}
	const parts = Object.entries(open).filter(([, count]) => count > 0).map(([edge, count]) => `${edge} ${count}`);
	return parts.length ? parts.join(', ') : 'none — the room is sealed';
}

export function CanvasMapEditor({ value, onChange, mods, ownerLabels }: Props) {
	const fontsReady = useRenderFonts();
	const terrainTextures = useTerrainTextures();
	const modImages = useModImages();

	const [history, setHistory] = useState<History<EditableMap> | null>(null);
	const historyRef = useRef<History<EditableMap> | null>(null);
	const coalesceRef = useRef<string | undefined>(undefined);
	const gestureRef = useRef(0);
	const onChangeRef = useRef(onChange);
	const lastEmittedRef = useRef<string | null>(null);
	const processedValueRef = useRef<string | null>(null);
	onChangeRef.current = onChange;

	const [error, setError] = useState<string | null>(null);
	const [mode, setMode] = useState<EditorMode>('select');
	const [buildType, setBuildType] = useState<string | null>('extension');
	const [terrainBrush, setTerrainBrush] = useState('.');
	const [brushSize, setBrushSize] = useState(1);
	const [lockBorder, setLockBorder] = useState(true);
	const [selection, setSelection] = useState<Selection>(null);
	const [roomText, setRoomText] = useState('');
	const [hovered, setHovered] = useState<{ x: number; y: number } | null>(null);

	const model = history?.present ?? null;

	// --- loading from outside (file switch, JSON view edit) -------------------
	useEffect(() => {
		if (processedValueRef.current === value) return;
		processedValueRef.current = value;
		if (lastEmittedRef.current === value) return;
		const parsed = parseEditableMap(value);
		setError(parsed.error);
		if (!parsed.map) return;
		const next = resetHistory(parsed.map);
		historyRef.current = next;
		setHistory(next);
		setRoomText(parsed.map.room);
		setSelection(null);
		coalesceRef.current = undefined;
		const normalized = serializeEditableMap(parsed.map);
		if (normalized !== value) {
			lastEmittedRef.current = normalized;
			onChangeRef.current(normalized, 'load');
		}
	}, [value]);

	const emit = useCallback((next: EditableMap) => {
		const serialized = serializeEditableMap(next);
		lastEmittedRef.current = serialized;
		onChangeRef.current(serialized, 'edit');
	}, []);

	// One edit. `coalesceKey` merges a whole drag stroke into a single undo
	// step; undefined always starts a new one.
	const commit = useCallback((next: EditableMap, coalesceKey?: string) => {
		const current = historyRef.current;
		if (!current) return;
		const pushed = pushHistory(current, next, coalesceKey, coalesceRef.current);
		coalesceRef.current = pushed.key;
		historyRef.current = pushed.history;
		setHistory(pushed.history);
		emit(next);
	}, [emit]);

	const applyHistory = useCallback((step: (history: History<EditableMap>) => History<EditableMap>) => {
		const current = historyRef.current;
		if (!current) return;
		const next = step(current);
		if (next === current) return;
		coalesceRef.current = undefined;
		historyRef.current = next;
		setHistory(next);
		setSelection(null);
		emit(next.present);
	}, [emit]);

	// --- editing operations ---------------------------------------------------
	const paintTerrain = useCallback((x: number, y: number) => {
		const current = historyRef.current?.present;
		if (!current) return;
		const onBorder = x === 0 || x === 49 || y === 0 || y === 49;
		const tile = lockBorder && onBorder ? '#' : terrainBrush;
		if (current.terrain[y][x] === tile) return;
		const terrain = current.terrain.slice();
		terrain[y] = terrain[y].slice(0, x) + tile + terrain[y].slice(x + 1);
		commit({ ...current, terrain }, `terrain:${gestureRef.current}`);
	}, [commit, lockBorder, terrainBrush]);

	const placeObject = useCallback((x: number, y: number) => {
		const current = historyRef.current?.present;
		if (!current || !buildType) return;

		if (buildType === ERASER) {
			const structures = current.structures.filter((object) => !(object.x === x && object.y === y));
			const flags = current.flags.filter((flag) => !(flag.x === x && flag.y === y));
			if (structures.length === current.structures.length && flags.length === current.flags.length) return;
			setSelection(null);
			commit({ ...current, structures, flags }, `erase:${gestureRef.current}`);
			return;
		}

		if (buildType === 'flag') {
			if (current.flags.some((flag) => flag.x === x && flag.y === y)) return;
			setSelection(null);
			commit({ ...current, flags: current.flags.concat({ name: nextFlagName(current.flags), x, y }) },
				`place:${gestureRef.current}`);
			return;
		}

		let structures = current.structures;
		// One controller per room: placing another moves it.
		if (buildType === 'controller') structures = structures.filter((object) => object.type !== 'controller');
		const layer = structureLayer(buildType);
		structures = structures.filter((object) => {
			if (object.x !== x || object.y !== y) return true;
			// Loose objects stack (a tile can hold energy AND a tombstone), so
			// only an identical type is replaced; everything else displaces
			// whatever shares its layer.
			if (layer === 'loose') return object.type !== buildType;
			return structureLayer(object.type) !== layer;
		});
		const created = makeEditableObject(buildType, x, y, {
			terrainTile: current.terrain[y]?.[x],
			existing: current.structures,
			rcl: mapRcl(current),
		});
		setSelection(null);
		commit({ ...current, structures: structures.concat(created) }, `place:${gestureRef.current}`);
	}, [buildType, commit]);

	const onPaint = mode === 'terrain' ? paintTerrain : placeObject;
	const onPaintEnd = useCallback(() => { gestureRef.current++; coalesceRef.current = undefined; }, []);

	// `field` names which control produced the edit. Consecutive edits from the
	// SAME control merge into one undo step, so typing "1000" into a number box
	// is one step, not four — while moving to another field starts a new one.
	const updateSelectedObject = useCallback((change: (object: EditableObject) => EditableObject, field?: string) => {
		const current = historyRef.current?.present;
		if (!current || selection?.kind !== 'structure') return;
		const existing = current.structures[selection.index];
		if (!existing) return;
		let next = change({ ...existing });
		// A lab holding a mineral, or a high-RCL extension, needs its capacity
		// written out — the loader's own default would be too small.
		const capacity = explicitCapacityFor(next, mapRcl(current));
		if (capacity) next = { ...next, storeCapacityResource: capacity };
		else if (next.storeCapacityResource && (next.type === 'lab' || next.type === 'extension')) {
			next = { ...next };
			delete next.storeCapacityResource;
		}
		const structures = current.structures.slice();
		structures[selection.index] = next;
		commit({ ...current, structures }, field && `prop:structure:${selection.index}:${field}`);
	}, [commit, selection]);

	const updateSelectedFlag = useCallback((change: (flag: EditableFlag) => EditableFlag, field?: string) => {
		const current = historyRef.current?.present;
		if (!current || selection?.kind !== 'flag') return;
		const flags = current.flags.slice();
		if (!flags[selection.index]) return;
		flags[selection.index] = change({ ...flags[selection.index] });
		commit({ ...current, flags }, field && `prop:flag:${selection.index}:${field}`);
	}, [commit, selection]);

	const moveObject = useCallback((index: number, x: number, y: number) => {
		const current = historyRef.current?.present;
		if (!current) return;
		const object = current.structures[index];
		if (!object || (object.x === x && object.y === y)) return;
		const structures = current.structures.slice();
		structures[index] = { ...object, x, y };
		commit({ ...current, structures }, `move:${gestureRef.current}:${index}`);
	}, [commit]);

	const deleteSelection = useCallback(() => {
		const current = historyRef.current?.present;
		if (!current || !selection) return;
		if (selection.kind === 'structure') {
			commit({ ...current, structures: current.structures.filter((_, index) => index !== selection.index) });
		} else {
			commit({ ...current, flags: current.flags.filter((_, index) => index !== selection.index) });
		}
		setSelection(null);
	}, [commit, selection]);

	const duplicateSelection = useCallback(() => {
		const current = historyRef.current?.present;
		if (!current || !selection) return;
		if (selection.kind === 'structure') {
			const object = current.structures[selection.index];
			if (!object) return;
			const copy: EditableObject = { ...object, x: Math.min(49, object.x + 1) };
			// Identity must not be duplicated: two objects with one id, or two
			// creeps with one name, is a broken world.
			delete copy.id;
			delete copy._id;
			if (copy.type === 'creep') copy.name = nextCreepName(current.structures);
			const structures = current.structures.concat(copy);
			commit({ ...current, structures });
			setSelection({ kind: 'structure', index: structures.length - 1 });
		} else {
			const flag = current.flags[selection.index];
			if (!flag) return;
			const flags = current.flags.concat({ ...flag, name: nextFlagName(current.flags), x: Math.min(49, flag.x + 1) });
			commit({ ...current, flags });
			setSelection({ kind: 'flag', index: flags.length - 1 });
		}
	}, [commit, selection]);

	const nudgeSelection = useCallback((dx: number, dy: number) => {
		const current = historyRef.current?.present;
		if (!current || !selection) return;
		if (selection.kind === 'structure') {
			const object = current.structures[selection.index];
			if (!object) return;
			moveObject(selection.index, Math.max(0, Math.min(49, object.x + dx)), Math.max(0, Math.min(49, object.y + dy)));
		} else {
			const flag = current.flags[selection.index];
			if (!flag) return;
			const flags = current.flags.slice();
			flags[selection.index] = { ...flag, x: Math.max(0, Math.min(49, flag.x + dx)), y: Math.max(0, Math.min(49, flag.y + dy)) };
			commit({ ...current, flags }, `nudge:${selection.index}`);
		}
	}, [commit, moveObject, selection]);

	// Selecting something else ends whatever editing run was in progress, so the
	// next field edit starts its own undo step.
	useEffect(() => { coalesceRef.current = undefined; }, [selection]);

	// --- keyboard -------------------------------------------------------------
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			// Never steal a key from a field the user is typing in.
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
				if (event.key === 'Escape') target.blur();
				return;
			}
			const meta = event.ctrlKey || event.metaKey;
			if (meta && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				applyHistory(event.shiftKey ? redo : undo);
				return;
			}
			if (meta && event.key.toLowerCase() === 'y') { event.preventDefault(); applyHistory(redo); return; }
			if (meta) return;
			if (event.key === '1') { setMode('select'); return; }
			if (event.key === '2') { setMode('terrain'); return; }
			if (event.key === '3') { setMode('build'); return; }
			if (event.key === 'Escape') { setSelection(null); return; }
			if (event.key === 'Delete' || event.key === 'Backspace') {
				if (selection) { event.preventDefault(); deleteSelection(); }
				return;
			}
			if (event.key === 'ArrowUp') { if (selection) { event.preventDefault(); nudgeSelection(0, -1); } return; }
			if (event.key === 'ArrowDown') { if (selection) { event.preventDefault(); nudgeSelection(0, 1); } return; }
			if (event.key === 'ArrowLeft') { if (selection) { event.preventDefault(); nudgeSelection(-1, 0); } return; }
			if (event.key === 'ArrowRight') { if (selection) { event.preventDefault(); nudgeSelection(1, 0); } return; }
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [applyHistory, deleteSelection, nudgeSelection, selection]);

	// --- derived --------------------------------------------------------------
	const rcl = useMemo(() => mapRcl(model), [model]);
	const counts = useMemo(() => countByType(model), [model]);
	const selectedObject = selection?.kind === 'structure' && model ? model.structures[selection.index] ?? null : null;
	const selectedFlag = selection?.kind === 'flag' && model ? model.flags[selection.index] ?? null : null;

	const panelTitle = mode === 'build' ? 'Construct' : mode === 'terrain' ? 'Terrain' : 'Selected';
	const panelBadge = mode === 'build'
		? `RCL ${rcl}`
		: mode === 'terrain'
			? `${terrainBrush === '#' ? 'wall' : terrainBrush === '~' ? 'swamp' : 'plain'} ${brushSize}×${brushSize}`
			: selectedObject ? labelFor(selectedObject.type) : selectedFlag ? 'Flag' : '';

	return (
		<div className={styles.root}>
			<ModeRail
				mode={mode} onMode={setMode}
				room={roomText}
				onRoom={(next) => {
					setRoomText(next);
					const current = historyRef.current?.present;
					const trimmed = next.trim();
					if (current && ROOM_RE.test(trimmed) && trimmed !== current.room) commit({ ...current, room: trimmed });
				}}
				hovered={hovered}
				canUndo={!!history && canUndo(history)}
				canRedo={!!history && canRedo(history)}
				onUndo={() => applyHistory(undo)}
				onRedo={() => applyHistory(redo)}
			/>

			{model ? (
				<EditorCanvas
					map={model}
					mode={mode}
					buildType={mode === 'build' ? buildType : null}
					terrainBrush={terrainBrush}
					brushSize={brushSize}
					selection={selection}
					fontsReady={fontsReady}
					terrainTextures={terrainTextures}
					modImages={modImages}
					onSelect={setSelection}
					onPaint={onPaint}
					onPaintEnd={onPaintEnd}
					onMoveObject={moveObject}
					onHover={setHovered}
				/>
			) : (
				<div className={styles.canvasHost}>
					{error && <div className={styles.error}>Cannot render map: {error}</div>}
				</div>
			)}

			<aside className={styles.panel}>
				<div className={styles.panelHead}>
					<span className={styles.panelTitle}>{panelTitle}</span>
					{panelBadge && <span className={styles.panelBadge}>{panelBadge}</span>}
				</div>
				<div className={styles.panelBody}>
					{mode === 'build' && (
						<ConstructPanel mods={mods} counts={counts} rcl={rcl} selected={buildType} onSelect={setBuildType} />
					)}
					{mode === 'terrain' && model && (
						<TerrainPanel
							brush={terrainBrush} onBrush={setTerrainBrush}
							size={brushSize} onSize={setBrushSize}
							lockBorder={lockBorder} onLockBorder={setLockBorder}
							exitSummary={exitSummary(model.terrain)}
						/>
					)}
					{mode === 'select' && (
						<PropertiesPanel
							object={selectedObject}
							flag={selectedFlag}
							rcl={rcl}
							mods={mods}
							ownerLabels={ownerLabels || []}
							onChangeObject={updateSelectedObject}
							onChangeFlag={updateSelectedFlag}
							onDelete={deleteSelection}
							onDuplicate={duplicateSelection}
						/>
					)}
				</div>
			</aside>
		</div>
	);
}

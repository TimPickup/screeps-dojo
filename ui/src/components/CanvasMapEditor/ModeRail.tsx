// The left rail: which of the three modes you are in, undo/redo, the room
// name, and a live readout of the tile under the cursor.

import styles from './CanvasMapEditor.module.css';

export type EditorMode = 'select' | 'terrain' | 'build';

export const MODES: Array<{ mode: EditorMode; glyph: string; label: string; key: string; title: string }> = [
	{ mode: 'select', glyph: '▣', label: 'Select', key: '1', title: 'Select and edit what is already on the map. Drag creeps to move them.' },
	{ mode: 'terrain', glyph: '⛰', label: 'Terrain', key: '2', title: 'Paint plain, swamp and natural wall. Drag to paint a stroke.' },
	{ mode: 'build', glyph: '⊞', label: 'Build', key: '3', title: 'Place structures, room features, creeps and flags.' },
];

const ROOM_RE = /^[WE]\d+[NS]\d+$/;

export function ModeRail({
	mode, onMode, room, onRoom, hovered, canUndo, canRedo, onUndo, onRedo,
}: {
	mode: EditorMode;
	onMode: (mode: EditorMode) => void;
	room: string;
	onRoom: (room: string) => void;
	hovered: { x: number; y: number } | null;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
}) {
	return (
		<aside className={styles.rail}>
			<div className={styles.railModes}>
				{MODES.map((entry) => (
					<button key={entry.mode} type="button" title={`${entry.title}  (${entry.key})`}
						className={mode === entry.mode ? styles.modeActive : styles.mode}
						onClick={() => onMode(entry.mode)}>
						<span className={styles.modeGlyph}>{entry.glyph}</span>
						<span className={styles.modeLabel}>{entry.label}</span>
						<span className={styles.modeKey}>{entry.key}</span>
					</button>
				))}
			</div>

			<div className={styles.railSpacer} />

			<div className={styles.railBlock}>
				<div className={styles.railLabel}>History</div>
				<div className={styles.historyRow}>
					<button type="button" className={styles.iconButton} title="Undo (Ctrl+Z)"
						disabled={!canUndo} onClick={onUndo}>↶</button>
					<button type="button" className={styles.iconButton} title="Redo (Ctrl+Shift+Z)"
						disabled={!canRedo} onClick={onRedo}>↷</button>
				</div>
			</div>


			<div className={styles.railBlock}>
				<div className={styles.railLabel}>Room</div>
				<input className={ROOM_RE.test(room.trim()) ? styles.roomInput : `${styles.roomInput} ${styles.invalid}`}
					value={room} spellCheck={false} onChange={(event) => onRoom(event.target.value)} />
			</div>

			<div className={hovered ? `${styles.coords} ${styles.coordsLive}` : styles.coords}>
				{hovered ? `${hovered.x}, ${hovered.y}` : '– , –'}
			</div>
		</aside>
	);
}

export { ROOM_RE };

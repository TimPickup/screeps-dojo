// Terrain mode's right panel: the three brushes, a brush size, and the border
// latch that used to be called "auto-wall border".
//
// That checkbox was never about walls in general — it stops a terrain brush
// from painting the outer ring, which is the only way to open or close a room
// EXIT. Renamed and explained rather than left as a mystery tick box.

import styles from './CanvasMapEditor.module.css';

// The engine's own terrain colours are #2b2b2b / #3a4429 / #101010 — three
// near-blacks that are indistinguishable in an 18px swatch. These are the
// same hues lifted until they read at a glance.
export const TERRAIN_BRUSHES = [
	{ value: '.', label: 'Plain', swatch: '#6e6e6e' },
	{ value: '~', label: 'Swamp', swatch: '#7d9152' },
	{ value: '#', label: 'Wall', swatch: '#2a2a2a' },
];

export const BRUSH_SIZES = [1, 3, 5];

export function TerrainPanel({ brush, onBrush, size, onSize, lockBorder, onLockBorder, exitSummary }: {
	brush: string;
	onBrush: (value: string) => void;
	size: number;
	onSize: (value: number) => void;
	lockBorder: boolean;
	onLockBorder: (value: boolean) => void;
	exitSummary: string;
}) {
	return (
		<>
			<div className={styles.section}>
				<div className={styles.sectionLabel}>Brush</div>
				<div className={styles.brushRow}>
					{TERRAIN_BRUSHES.map((entry) => (
						<button key={entry.value} type="button"
							className={brush === entry.value ? styles.brushActive : styles.brush}
							onClick={() => onBrush(entry.value)}>
							<span className={styles.brushSwatch} style={{ background: entry.swatch, border: '1px solid #1a1a1a' }} />
							{entry.label}
						</button>
					))}
				</div>
			</div>

			<div className={styles.section}>
				<div className={styles.sectionLabel}>Brush size</div>
				<div className={styles.brushRow}>
					{BRUSH_SIZES.map((value) => (
						<button key={value} type="button"
							className={size === value ? styles.brushActive : styles.brush}
							onClick={() => onSize(value)}>{value}×{value}</button>
					))}
				</div>
			</div>

			<div className={styles.section}>
				<div className={styles.sectionLabel}>Room border</div>
				<label className={styles.checkRow}>
					<input type="checkbox" checked={lockBorder} onChange={(event) => onLockBorder(event.target.checked)} />
					Lock border to wall
				</label>
				<div className={styles.fieldHint}>
					Stops the brush opening a room exit by accident. Turn it off to cut or seal one —
					a non-wall tile on the edge IS an exit.
				</div>
				<div className={styles.fieldHint} style={{ marginTop: 7, color: '#8a8a8a' }}>
					Exits now: {exitSummary}
				</div>
			</div>

		</>
	);
}

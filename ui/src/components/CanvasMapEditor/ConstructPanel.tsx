// Build mode's right panel: one row per placeable thing, grouped, each showing
// how many the room already has against what this RCL allows.
//
// The limit is advisory on purpose — a scenario often WANTS an over-limit base
// (that is what an imported enemy room looks like at a lower RCL, and what a
// siege test needs). Over the limit the current count goes bold red rather
// than blocking the click.

import { GROUP_LABELS, placeablesFor, rclLimit, type PlaceableGroup } from './gameData';
import { ObjectIcon } from './ObjectIcon';
import styles from './CanvasMapEditor.module.css';

export const ERASER = '__eraser__';

export function ConstructPanel({ mods, counts, rcl, selected, onSelect }: {
	mods: string[] | undefined;
	counts: Record<string, number>;
	rcl: number;
	selected: string | null;
	onSelect: (type: string) => void;
}) {
	const items = placeablesFor(mods);
	const groups: PlaceableGroup[] = ['structure', 'natural', 'npc', 'loose', 'unit', 'marker'];

	return (
		<>
			{groups.map((group) => {
				const rows = items.filter((item) => item.group === group);
				if (!rows.length) return null;
				return (
					<div key={group}>
						<div className={styles.groupHead}>{GROUP_LABELS[group]}</div>
						{rows.map((item) => {
							const count = counts[item.type] || 0;
							const limit = rclLimit(item.type, rcl);
							const over = limit !== null && count > limit;
							const active = selected === item.type;
							return (
								<div key={item.type}>
									<button type="button" title={item.hint || item.label}
										className={active ? styles.paletteRowActive : styles.paletteRow}
										onClick={() => onSelect(item.type)}>
										<ObjectIcon type={item.type} rcl={rcl} />
										<span className={styles.paletteName}>{item.label}</span>
										<span className={styles.paletteCount}>
											<span className={over ? styles.countOver : styles.countNow}>{count}</span>
											<span className={styles.countLimit}>{limit === null ? ' / —' : ` / ${limit}`}</span>
										</span>
									</button>
									{active && item.hint && <div className={styles.paletteHint}>{item.hint}</div>}
									{active && over && (
										<div className={styles.paletteHint} style={{ color: '#ff8080' }}>
											Over the RCL {rcl} limit of {limit} — it will still load.
										</div>
									)}
								</div>
							);
						})}
					</div>
				);
			})}

			<div className={styles.groupHead}>Tools</div>
			<button type="button" title="Click or drag to remove whatever is on a tile"
				className={selected === ERASER ? styles.paletteRowActive : styles.paletteRow}
				onClick={() => onSelect(ERASER)}>
				<span className={styles.paletteGlyph}>⌫</span>
				<span className={styles.paletteName}>Eraser</span>
			</button>
		</>
	);
}

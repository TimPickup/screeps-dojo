// The creep body editor: an ordered list of segments, plus the flat part grid
// the replay inspector shows.
//
// Order is the point. `1 move, 10 work, 9 move` is a different creep from
// `11 move, 10 work` — damage eats parts from the front — so segments can be
// added, reordered and removed rather than being one fixed row per part type.
// A segment never holds zero parts; removing the last one deletes the row.

import {
	BODY_PARTS, BODY_PART_COLORS, BODY_PART_LABELS, BOOSTS, MAX_CREEP_SIZE,
} from './gameData';
import {
	addSegment, moveSegment, removeSegment, segmentsHits, segmentsPartCount,
	segmentsToParts, setSegmentBoost, setSegmentCount, setSegmentPart,
	type BodySegment,
} from './bodyModel';
import styles from './CanvasMapEditor.module.css';

function boostTitle(part: string, boost: string | undefined): string {
	const label = BODY_PART_LABELS[part] || part;
	if (!boost) return `${label} — unboosted`;
	const effect = BOOSTS[part]?.find((entry) => entry.compound === boost)?.effect;
	return effect ? `${label} — ${boost} (${effect})` : `${label} — ${boost}`;
}

export function BodyEditor({ segments, onChange }: {
	segments: BodySegment[];
	onChange: (segments: BodySegment[]) => void;
}) {
	const total = segmentsPartCount(segments);
	const over = total > MAX_CREEP_SIZE;
	const parts = segmentsToParts(segments);

	return (
		<div className={styles.section}>
			<div className={styles.sectionLabel} style={{ display: 'flex', justifyContent: 'space-between' }}>
				<span>Body</span>
				<span className={over ? styles.countOver : styles.countNow} style={{ fontFamily: 'monospace' }}>
					{total} / {MAX_CREEP_SIZE}
				</span>
			</div>

			{segments.length === 0 && <div className={styles.muted}>No parts. Add a segment below.</div>}

			{segments.map((segment, index) => {
				const boosts = BOOSTS[segment.part] || [];
				return (
					<div className={styles.bodySegment} key={index}>
						<div className={styles.bodyRow}>
							<span className={styles.bodySwatch} style={{ background: BODY_PART_COLORS[segment.part] || '#888' }} />
							<input className={`${styles.input} ${styles.bodyCount}`} type="number" min={1} max={MAX_CREEP_SIZE}
								value={segment.count} title="How many of this part, in a row"
								onChange={(event) => onChange(setSegmentCount(segments, index, Number(event.target.value)))} />
							<select className={`${styles.select} ${styles.bodyPart}`} value={segment.part}
								onChange={(event) => onChange(setSegmentPart(segments, index, event.target.value))}>
								{BODY_PARTS.map((part) => <option key={part} value={part}>{BODY_PART_LABELS[part]}</option>)}
							</select>
							<span className={styles.bodyMove}>
								<button type="button" className={styles.bodyMoveButton} title="Move earlier in the body"
									disabled={index === 0} onClick={() => onChange(moveSegment(segments, index, -1))}>▲</button>
								<button type="button" className={styles.bodyMoveButton} title="Move later in the body"
									disabled={index === segments.length - 1} onClick={() => onChange(moveSegment(segments, index, 1))}>▼</button>
							</span>
							<button type="button" className={`${styles.rowButton} ${styles.rowDanger}`} title="Remove this segment"
								onClick={() => onChange(removeSegment(segments, index))}>✕</button>
						</div>
						<select className={`${styles.select} ${styles.bodyBoost}`} value={segment.boost || ''}
							disabled={boosts.length === 0}
							title={boosts.length === 0 ? 'This part type has no boosts' : 'Boost compound'}
							onChange={(event) => onChange(setSegmentBoost(segments, index, event.target.value))}>
							<option value="">{boosts.length === 0 ? 'no boost for this part' : 'unboosted'}</option>
							{boosts.map((boost) => (
								<option key={boost.compound} value={boost.compound}>{boost.compound} — {boost.effect}</option>
							))}
						</select>
					</div>
				);
			})}

			<div className={styles.addRow}>
				<button type="button" className={styles.addButton} onClick={() => onChange(addSegment(segments))}>
					+ Add segment
				</button>
				<span className={styles.fieldHint} style={{ alignSelf: 'center' }}>
					hits {segmentsHits(segments).toLocaleString()}
				</span>
			</div>

			{parts.length > 0 && (
				<>
					<div className={styles.bodyGrid}>
						{parts.map((part, index) => (
							<span key={index}
								className={part.boost ? `${styles.bodyCell} ${styles.bodyCellBoosted}` : styles.bodyCell}
								title={boostTitle(part.part, part.boost)}
								style={{ background: BODY_PART_COLORS[part.part] || '#888' }} />
						))}
					</div>
					<div className={styles.fieldHint} style={{ marginTop: 5 }}>
						Front first. White outline = boosted; hover for the compound.
					</div>
				</>
			)}
			{over && (
				<div className={styles.warn}>
					Over {MAX_CREEP_SIZE} parts — it will load, but no spawn could build it.
				</div>
			)}
		</div>
	);
}

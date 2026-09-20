// The small labelled controls the properties panel is built from. They are
// deliberately dumb: value in, change out, no knowledge of maps or objects.

import { useEffect, useState } from 'react';
import styles from './CanvasMapEditor.module.css';

export function FieldShell({ label, value, hint, children }: {
	label: string;
	value?: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<label className={styles.field}>
			<span className={styles.fieldLabel}>
				<span>{label}</span>
				{value !== undefined && <span className={styles.fieldValue}>{value}</span>}
			</span>
			{children}
			{hint && <span className={styles.fieldHint}>{hint}</span>}
		</label>
	);
}

// A text box that keeps what you typed while you type it, and only reports up
// when the value actually parses — so clearing the box to retype a number does
// not momentarily write 0 into the map.
export function TextField({ label, value, onChange, hint, placeholder, invalid }: {
	label: string; value: string; onChange: (value: string) => void;
	hint?: string; placeholder?: string; invalid?: boolean;
}) {
	return (
		<FieldShell label={label} hint={hint}>
			<input className={invalid ? `${styles.input} ${styles.invalid}` : styles.input}
				value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
		</FieldShell>
	);
}

export function NumberField({ label, value, onChange, min, max, step, hint, suffix, allowEmpty }: {
	label: string; value: number | undefined; onChange: (value: number | null) => void;
	min?: number; max?: number; step?: number; hint?: string; suffix?: string; allowEmpty?: boolean;
}) {
	const [text, setText] = useState(value === undefined ? '' : String(value));
	// Re-sync when the selection changes underneath us, but never while the box
	// holds a half-typed number the user is still working on.
	useEffect(() => { setText(value === undefined ? '' : String(value)); }, [value]);

	const commit = (raw: string) => {
		setText(raw);
		if (raw.trim() === '') { if (allowEmpty) onChange(null); return; }
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return;
		let next = parsed;
		if (min !== undefined) next = Math.max(min, next);
		if (max !== undefined) next = Math.min(max, next);
		onChange(next);
	};

	return (
		<FieldShell label={label} value={suffix} hint={hint}>
			<input className={styles.input} type="number" inputMode="numeric"
				min={min} max={max} step={step ?? 1} value={text}
				onChange={(event) => commit(event.target.value)}
				onBlur={() => setText(value === undefined ? '' : String(value))} />
		</FieldShell>
	);
}

export function SliderField({ label, value, onChange, min, max, step, hint, format }: {
	label: string; value: number; onChange: (value: number) => void;
	min: number; max: number; step?: number; hint?: string; format?: (value: number) => string;
}) {
	const safeMax = Math.max(min, max);
	return (
		<FieldShell label={label} value={(format || ((v: number) => v.toLocaleString()))(value)} hint={hint}>
			<div className={styles.inlineRow}>
				<input className={styles.range} type="range" min={min} max={safeMax} step={step ?? 1}
					value={Math.max(min, Math.min(safeMax, value))}
					onChange={(event) => onChange(Number(event.target.value))} />
			</div>
		</FieldShell>
	);
}

export function SelectField({ label, value, onChange, options, hint, groups }: {
	label: string; value: string; onChange: (value: string) => void;
	options?: Array<{ value: string; label: string }>;
	groups?: Array<{ label: string; options: Array<{ value: string; label: string }> }>;
	hint?: string;
}) {
	return (
		<FieldShell label={label} hint={hint}>
			<select className={styles.select} value={value} onChange={(event) => onChange(event.target.value)}>
				{options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
				{groups?.map((group) => (
					<optgroup key={group.label} label={group.label}>
						{group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
					</optgroup>
				))}
			</select>
		</FieldShell>
	);
}

export function ToggleField({ label, value, onChange, hint }: {
	label: string; value: boolean; onChange: (value: boolean) => void; hint?: string;
}) {
	return (
		<>
			<label className={styles.checkRow}>
				<input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
				{label}
			</label>
			{hint && <div className={styles.fieldHint} style={{ margin: '-4px 0 8px 22px' }}>{hint}</div>}
		</>
	);
}

export function HitsField({ hits, hitsMax, onChange }: {
	hits: number; hitsMax: number; onChange: (hits: number) => void;
}) {
	const fraction = hitsMax > 0 ? Math.max(0, Math.min(1, hits / hitsMax)) : 0;
	const color = fraction > 0.6 ? '#65fd62' : fraction > 0.3 ? '#e0b054' : '#cc3333';
	return (
		<FieldShell label="hits" value={`${hits.toLocaleString()} / ${hitsMax.toLocaleString()}`}>
			<div className={styles.hitsBar}>
				<div className={styles.hitsFill} style={{ width: `${fraction * 100}%`, background: color }} />
			</div>
			<input className={styles.range} type="range" min={0} max={Math.max(1, hitsMax)}
				step={Math.max(1, Math.round(hitsMax / 200))} value={Math.min(hits, hitsMax)}
				onChange={(event) => onChange(Number(event.target.value))} />
		</FieldShell>
	);
}

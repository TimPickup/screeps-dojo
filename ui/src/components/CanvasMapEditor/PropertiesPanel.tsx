// Select mode's right panel: everything about the one thing you have selected.
//
// Layout is always the same, so the panel is predictable whatever you click:
// identity, position, owner, the type's own properties, hit points, store,
// body (creeps), then a raw block holding any field the schema does not model —
// so nothing on an imported object is ever out of reach.

import { useEffect, useState } from 'react';
import {
	BUILTIN_OWNERS, OWNABLE, STRUCTURE_HITS, allResources, labelFor, isClaimed,
} from './gameData';
import { ObjectIcon } from './ObjectIcon';
import { FLAG_COLORS, fieldsFor, handledKeys, ticksValue, withTicks } from './objectFields';
import { hasStore } from './storeRules';
import { bodyToSegments, segmentsToBody } from './bodyModel';
import { HitsField, NumberField, SelectField, SliderField, TextField, ToggleField, FieldShell } from './controls';
import { StoreEditor } from './StoreEditor';
import { BodyEditor } from './BodyEditor';
import type { EditableFlag, EditableObject } from './mapModel';
import styles from './CanvasMapEditor.module.css';

interface Props {
	object: EditableObject | null;
	flag: EditableFlag | null;
	rcl: number;
	mods: string[] | undefined;
	// Player labels this scenario's settings.json binds a bot codebase to.
	ownerLabels: string[];
	// `field` identifies the control, so consecutive edits from it collapse into
	// a single undo step (see CanvasMapEditor.updateSelectedObject).
	onChangeObject: (change: (object: EditableObject) => EditableObject, field?: string) => void;
	onChangeFlag: (change: (flag: EditableFlag) => EditableFlag, field?: string) => void;
	onDelete: () => void;
	onDuplicate: () => void;
}

// Fields the panel draws itself, on top of whatever the type schema handles.
const PANEL_OWNED = new Set(['name', 'notifyWhenAttacked', 'ticksToDecay', 'ticksToRegeneration', 'resourceType', 'amount']);

export function PropertiesPanel(props: Props) {
	const { object, flag } = props;
	if (flag) return <FlagProperties {...props} flag={flag} />;
	if (!object) {
		return (
			<div className={styles.section}>
				<div className={styles.muted}>
					Nothing selected. Click something on the map; drag it to move it.
				</div>
			</div>
		);
	}
	return <ObjectProperties {...props} object={object} />;
}

function ObjectProperties({ object, rcl, mods, ownerLabels, onChangeObject, onDelete, onDuplicate }: Props & { object: EditableObject }) {
	const set = (key: string, value: unknown) => onChangeObject((current) => {
		const next = { ...current };
		if (value === null || value === undefined) delete next[key];
		else next[key] = value;
		return next;
	}, key);

	const fields = fieldsFor(object, { mods, rcl });
	const ownerOptions = BUILTIN_OWNERS.concat(
		ownerLabels.filter((label) => !BUILTIN_OWNERS.some((entry) => entry.value === label))
			.map((label) => ({ value: label, label: `${label} (player)` })),
	);
	const ownerValue = object.owner == null
		? (object.type === 'controller' ? 'unclaimed' : 'me')
		: (object.owner === 'neutral' ? 'unclaimed' : object.owner);

	const hitsMax = Number(object.hitsMax) || STRUCTURE_HITS[object.type] || 0;
	const hits = Number(object.hits);

	return (
		<>
			<div className={styles.section}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
					<ObjectIcon type={object.type} size={20} rcl={rcl} />
					<span style={{ color: '#e4e4e4', fontSize: 13, fontWeight: 600 }}>{labelFor(object.type)}</span>
					{typeof object.name === 'string' && object.name && (
						<span style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>{object.name}</span>
					)}
				</div>
				<div className={styles.inlineRow}>
					<NumberField label="x" value={object.x} min={0} max={49} onChange={(value) => set('x', value ?? 0)} />
					<NumberField label="y" value={object.y} min={0} max={49} onChange={(value) => set('y', value ?? 0)} />
				</div>

				{OWNABLE.has(object.type) && (
					<SelectField label="owner" value={ownerValue} options={ownerOptions}
						hint={ownerLabels.length ? undefined : 'Add player sides in the scenario\'s ⚙ to use another bot.'}
						onChange={(value) => onChangeObject((current) => {
							const next = { ...current, owner: value };
							if (next.type === 'controller') next.level = isClaimed(value) ? (Number(next.level) || 1) : 0;
							return next;
						})} />
				)}

				{typeof object.name === 'string' && object.type !== 'spawn' && object.type !== 'creep' && (
					<TextField label="name" value={String(object.name)} onChange={(value) => set('name', value)} />
				)}

				{/* The engine ties objects together by id — a keeper is named after
				    its lair's id — so an imported one has to stay editable. */}
				<TextField label="id" value={String(object.id ?? '')} placeholder="(none)"
					hint="The engine's object id."
					onChange={(value) => set('id', value.trim() || null)} />
			</div>

			{fields.length > 0 && (
				<div className={styles.section}>
					<div className={styles.sectionLabel}>Properties</div>
					{fields.map((field) => {
						switch (field.kind) {
							case 'text':
								return <TextField key={field.key} label={field.label} hint={field.hint}
									value={String(object[field.key] ?? '')} onChange={(value) => set(field.key, value)} />;
							case 'number':
								return <NumberField key={field.key} label={field.label} hint={field.hint} suffix={field.suffix}
									min={field.min} max={field.max} step={field.step} allowEmpty
									value={typeof object[field.key] === 'number' ? (object[field.key] as number) : undefined}
									onChange={(value) => set(field.key, value)} />;
							case 'slider':
								return <SliderField key={field.key} label={field.label} hint={field.hint}
									min={field.min} max={field.max} step={field.step}
									value={Number(object[field.key]) || 0}
									onChange={(value) => set(field.key, value)} />;
							case 'select':
								return <SelectField key={field.key} label={field.label} hint={field.hint} options={field.options}
									value={String(object[field.key] ?? field.options[0]?.value ?? '')}
									onChange={(value) => {
										// Numeric selects (density) must not be written back as strings.
										const numeric = field.options.every((option) => /^-?\d+$/.test(option.value));
										set(field.key, numeric ? Number(value) : value);
									}} />;
							case 'toggle':
								return <ToggleField key={field.key} label={field.label} hint={field.hint}
									value={object[field.key] !== false}
									onChange={(value) => set(field.key, value)} />;
							case 'ticks':
								return <NumberField key={field.key} label={field.label} hint={field.hint} suffix="ticks"
									min={0} allowEmpty value={ticksValue(object, field.key)}
									onChange={(value) => onChangeObject((current) => withTicks(current, field.key, value), field.key)} />;
							case 'position':
								return <PositionField key={field.key} label={field.label}
									value={object[field.key] as { room?: string; x?: number; y?: number } | undefined}
									onChange={(value) => set(field.key, value)} />;
						}
					})}
				</div>
			)}

			{hitsMax > 0 && (
				<div className={styles.section}>
					{/* Max hits is derived — from the body for a creep, from the type
					    (and RCL, for a rampart) otherwise — so it is shown, not typed. */}
					<HitsField hits={Number.isFinite(hits) ? hits : hitsMax} hitsMax={hitsMax}
						onChange={(value) => onChangeObject((current) => ({ ...current, hits: value, hitsMax }), 'hits')} />
				</div>
			)}

			{object.type === 'creep' && (
				<BodyEditor segments={bodyToSegments(object.body, object.boosts)}
					onChange={(segments) => onChangeObject((current) => {
						const { body, boosts } = segmentsToBody(segments);
						const next = { ...current, body } as EditableObject;
						if (boosts) next.boosts = boosts; else delete next.boosts;
						// hitsMax always follows the body. hits follow it too while
						// the creep is undamaged; a deliberately wounded creep keeps
						// its own value (clamped), so editing the body does not
						// silently heal it.
						const previousMax = Number(current.hitsMax) || 0;
						const previousHits = Number(current.hits);
						const wasFull = !Number.isFinite(previousHits) || previousMax === 0 || previousHits >= previousMax;
						const max = body.length * 100;
						next.hitsMax = max;
						next.hits = wasFull ? max : Math.min(previousHits, max);
						return next;
					}, 'body')} />
			)}

			{hasStore(object, rcl, mods) && (
				<StoreEditor object={object} rcl={rcl} mods={mods} everyResource={allResources(mods)}
					onChange={(store, field) => onChangeObject((current) => ({ ...current, store }), field)} />
			)}

			<AdvancedBlock object={object} handled={handledKeys(object, { mods, rcl })} extraHandled={PANEL_OWNED}
				onReplace={(patch) => onChangeObject((current) => mergeAdvanced(current, patch, handledKeys(current, { mods, rcl })), 'advanced')} />

			<div className={styles.panelFoot}>
				<button type="button" className={styles.secondary} onClick={onDuplicate}>Duplicate</button>
				<button type="button" className={styles.delete} onClick={onDelete}>Delete</button>
			</div>
		</>
	);
}

function FlagProperties({ flag, onChangeFlag, onDelete, onDuplicate }: Props & { flag: EditableFlag }) {
	return (
		<>
			<div className={styles.section}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
					<span style={{ fontSize: 17, opacity: 0.85 }}>⚑</span>
					<span style={{ color: '#e4e4e4', fontSize: 13, fontWeight: 600 }}>Flag</span>
				</div>
				<TextField label="name" value={flag.name}
					hint="Unique per room."
					onChange={(value) => onChangeFlag((current) => ({ ...current, name: value }), 'name')} />
				<div className={styles.inlineRow}>
					<NumberField label="x" value={flag.x} min={0} max={49}
						onChange={(value) => onChangeFlag((current) => ({ ...current, x: value ?? 0 }), 'x')} />
					<NumberField label="y" value={flag.y} min={0} max={49}
						onChange={(value) => onChangeFlag((current) => ({ ...current, y: value ?? 0 }), 'y')} />
				</div>
				<ColorField label="colour" value={flag.color} onChange={(value) =>
					onChangeFlag((current) => ({ ...current, color: value ?? undefined }))} />
				<ColorField label="secondary colour" value={flag.secondaryColor} onChange={(value) =>
					onChangeFlag((current) => ({ ...current, secondaryColor: value ?? undefined }))} />
			</div>
			<div className={styles.panelFoot}>
				<button type="button" className={styles.secondary} onClick={onDuplicate}>Duplicate</button>
				<button type="button" className={styles.delete} onClick={onDelete}>Delete</button>
			</div>
		</>
	);
}

function ColorField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number | null) => void }) {
	const current = FLAG_COLORS.find((entry) => entry.value === value);
	return (
		<FieldShell label={label}>
			<div className={styles.inlineRow}>
				<span style={{
					width: 16, height: 16, flex: 'none', borderRadius: 3,
					background: current?.css || 'transparent', border: '1px solid #444',
				}} />
				<select className={styles.select} value={value === undefined ? '' : String(value)}
					onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}>
					<option value="">default (white)</option>
					{FLAG_COLORS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
				</select>
			</div>
		</FieldShell>
	);
}

function PositionField({ label, value, onChange }: {
	label: string;
	value: { room?: string; x?: number; y?: number } | undefined;
	onChange: (value: { room: string; x: number; y: number }) => void;
}) {
	const room = value?.room ?? 'W1N1';
	const x = value?.x ?? 25;
	const y = value?.y ?? 25;
	return (
		<>
			<TextField label={`${label} room`} value={room} onChange={(next) => onChange({ room: next, x, y })} />
			<div className={styles.inlineRow}>
				<NumberField label={`${label} x`} value={x} min={0} max={49} onChange={(next) => onChange({ room, x: next ?? 0, y })} />
				<NumberField label={`${label} y`} value={y} min={0} max={49} onChange={(next) => onChange({ room, x, y: next ?? 0 })} />
			</div>
		</>
	);
}

// Everything the schema does not model, as editable JSON. An imported object
// carries fields the editor has never heard of; they stay visible and editable
// instead of being silently un-editable.
function AdvancedBlock({ object, handled, extraHandled, onReplace }: {
	object: EditableObject;
	handled: Set<string>;
	extraHandled: Set<string>;
	onReplace: (patch: Record<string, unknown>) => void;
}) {
	const [open, setOpen] = useState(false);
	const rest: Record<string, unknown> = {};
	for (const key of Object.keys(object)) {
		if (handled.has(key) || extraHandled.has(key)) continue;
		rest[key] = object[key];
	}
	const serialized = JSON.stringify(rest, null, 2);
	const [text, setText] = useState(serialized);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => { setText(serialized); setError(null); }, [serialized]);

	const count = Object.keys(rest).length;
	return (
		<div className={styles.section}>
			<button type="button" className={styles.advancedToggle} onClick={() => setOpen(!open)}>
				{open ? '▾' : '▸'} Advanced — other fields ({count})
			</button>
			{open && (
				<>
					<textarea className={error ? `${styles.rawArea} ${styles.invalid}` : styles.rawArea}
						spellCheck={false} value={text}
						onChange={(event) => {
							setText(event.target.value);
							try {
								const parsed = JSON.parse(event.target.value || '{}');
								if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be an object');
								setError(null);
								onReplace(parsed as Record<string, unknown>);
							} catch (parseError) {
								setError(String((parseError as Error).message || parseError));
							}
						}} />
					{error && <div className={styles.warn}>{error}</div>}
					<div className={styles.fieldHint}>
						Written to the map exactly as typed.
					</div>
				</>
			)}
		</div>
	);
}

// Replaces the unmodelled half of an object with `patch`, leaving every field
// the panel's own controls own untouched.
function mergeAdvanced(object: EditableObject, patch: Record<string, unknown>, handled: Set<string>): EditableObject {
	const next: EditableObject = { type: object.type, x: object.x, y: object.y };
	for (const key of Object.keys(object)) {
		if (handled.has(key) || PANEL_OWNED.has(key)) next[key] = object[key];
	}
	for (const key of Object.keys(patch)) next[key] = patch[key];
	return next;
}

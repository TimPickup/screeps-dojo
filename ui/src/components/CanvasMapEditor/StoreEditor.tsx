// The store panel.
//
// Two layouts, because Screeps has two kinds of store (see storeRules.ts):
//
//   FIXED   the slots ARE the structure. A nuker shows energy and G, each with
//           its own ceiling; a lab shows energy and one mineral you pick from a
//           dropdown. Nothing to add, nothing to delete — you cannot put
//           Ghodium in a spawn, so the UI never offers it.
//   FREE    a shared pool that takes anything, so adding and removing
//           resources is the whole point: storage, terminal, container,
//           factory, a creep, a tombstone.

import { useState } from 'react';
import { ResourceIcon } from '../ObjectInspector/pieces';
import { RESOURCE_GROUPS } from './gameData';
import {
	addableResources, choiceResource, maxAmountFor, storeModel, storeSummary,
	unexpectedResources, type ChoiceSlot, type StoreObjectLike, type StoreSlot,
} from './storeRules';
import styles from './CanvasMapEditor.module.css';

function optionGroups(allowed: string[], mods: string[] | undefined) {
	const allowedSet = new Set(allowed);
	const groups = RESOURCE_GROUPS
		.map((group) => ({ label: group.label, resources: group.resources.filter((r) => allowedSet.has(r)) }))
		.filter((group) => group.resources.length);
	const known = new Set(groups.flatMap((group) => group.resources));
	// Mod resources (a Season 5 Thorium) are not in the vanilla groups.
	const extras = allowed.filter((resource) => !known.has(resource));
	if (extras.length) groups.push({ label: (mods || []).join(', ') || 'Mod', resources: extras });
	return groups;
}

function AmountRow({ resource, amount, max, onAmount, onRemove, children }: {
	resource: string | null;
	amount: number;
	max: number | null;
	onAmount: (amount: number) => void;
	onRemove?: () => void;
	children?: React.ReactNode;
}) {
	const [editing, setEditing] = useState(false);
	const over = max !== null && amount > max;
	const disabled = resource === null;
	return (
		<div>
			<div className={styles.storeRow}>
				{resource ? <ResourceIcon resource={resource} size={15} /> : <span className={styles.storeIconGap} />}
				{children ?? <span className={styles.storeName} title={resource || ''}>{resource}</span>}
				{editing && !disabled ? (
					<input className={`${styles.input} ${styles.storeAmount}`} type="number" autoFocus
						min={0} max={max ?? undefined} value={amount}
						onChange={(event) => onAmount(Number(event.target.value) || 0)}
						onBlur={() => setEditing(false)}
						onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') setEditing(false); }} />
				) : (
					<button type="button" className={styles.storeAmountButton} disabled={disabled}
						style={{ color: over ? '#ff5f5f' : undefined }}
						title={disabled ? 'Pick a resource first' : 'Click to type an exact amount'}
						onClick={() => setEditing(true)}>{amount.toLocaleString()}</button>
				)}
				{max !== null && <span className={styles.storeMax}>/ {max.toLocaleString()}</span>}
				{onRemove && (
					<button type="button" className={`${styles.rowButton} ${styles.rowDanger}`}
						title={`Remove ${resource}`} onClick={onRemove}>✕</button>
				)}
			</div>
			{!disabled && max !== null && max > 0 && (
				<div className={styles.storeSlider}>
					<input className={styles.range} type="range" min={0} max={max}
						step={Math.max(1, Math.round(max / 200))} value={Math.min(amount, max)}
						onChange={(event) => onAmount(Number(event.target.value))} />
				</div>
			)}
		</div>
	);
}

export function StoreEditor({ object, rcl, mods, everyResource, onChange }: {
	object: StoreObjectLike;
	rcl: number;
	mods: string[] | undefined;
	everyResource: string[];
	// The second argument names the control that produced the edit, so dragging
	// one resource's slider is a single undo step.
	onChange: (store: Record<string, number>, field?: string) => void;
}) {
	const [pending, setPending] = useState('');

	const model = storeModel(object, rcl, mods);
	if (model.kind === 'none') return null;

	const store = object.store || {};
	const summary = storeSummary(model, store);

	// A zero amount is written as an absent key: that is how the importer emits
	// stores (roomToMap cleanStore keeps only > 0), so the editor matches.
	//
	// `keepZero` is for a choice slot, where the KEY IS THE SELECTION: dropping
	// an empty lab's mineral would silently deselect the mineral you just
	// picked, and there would be no way to fill it again.
	const setAmount = (resource: string, amount: number, field: string, keepZero = false) => {
		const next = { ...store };
		const value = Math.max(0, Math.round(amount));
		if (value > 0 || keepZero) next[resource] = value;
		else delete next[resource];
		onChange(next, field);
	};
	const remove = (resource: string) => {
		const next = { ...store };
		delete next[resource];
		onChange(next);
	};

	const fraction = summary.capacity ? Math.min(1, summary.used / summary.capacity) : 0;
	const capacityText = summary.capacity === null
		? `${summary.used.toLocaleString()} — no capacity limit`
		: `${summary.used.toLocaleString()} / ${summary.capacity.toLocaleString()}`;

	const header = (
		<>
			<div className={styles.storeHead}>
				<span className={summary.over ? styles.storeOver : undefined}>{capacityText}</span>
				{summary.over && <span className={styles.storeOver}>over capacity</span>}
			</div>
			{summary.capacity !== null && (
				<div className={styles.storeBar}>
					<div className={summary.over ? styles.storeBarFillOver : styles.storeBarFill}
						style={{ width: `${Math.max(2, fraction * 100)}%` }} />
				</div>
			)}
		</>
	);

	// ---------------------------------------------------------------- fixed
	if (model.kind === 'fixed') {
		const chosen = choiceResource(model.slots, store);
		const stray = unexpectedResources(model, store);
		return (
			<div className={styles.section}>
				<div className={styles.sectionLabel}>Store</div>
				{header}
				{model.slots.map((slot: StoreSlot, index) => {
					if (slot.kind === 'resource') {
						return (
							<AmountRow key={slot.resource} resource={slot.resource}
								amount={Number(store[slot.resource]) || 0} max={slot.capacity}
								onAmount={(value) => setAmount(slot.resource, value, `store:${slot.resource}`)} />
						);
					}
					return (
						<ChoiceRow key={`choice-${index}`} slot={slot} mods={mods}
							resource={chosen} amount={chosen ? Number(store[chosen]) || 0 : 0}
							onPick={(next) => {
								// Swapping the mineral carries the amount across
								// rather than silently emptying the lab. Picking
								// one into an empty lab writes the key at 0, so
								// the amount control has something to edit.
								const carried = chosen ? Number(store[chosen]) || 0 : 0;
								const updated = { ...store };
								if (chosen) delete updated[chosen];
								if (next) updated[next] = Math.min(carried, slot.capacity);
								onChange(updated);
							}}
							onAmount={(value) => chosen && setAmount(chosen, value, `store:${chosen}`, true)} />
					);
				})}
				{stray.map((resource) => (
					<div key={resource}>
						<AmountRow resource={resource} amount={Number(store[resource]) || 0} max={null}
							onAmount={(value) => setAmount(resource, value, `store:${resource}`)}
							onRemove={() => remove(resource)} />
						<div className={styles.warn}>
							A {object.type} cannot hold {resource}. It came from the file — remove it, or leave it as it is.
						</div>
					</div>
				))}
			</div>
		);
	}

	// ----------------------------------------------------------------- free
	const entries = Object.keys(store);
	const addable = addableResources(model, store, everyResource);
	const groups = optionGroups(addable, mods);
	const add = () => {
		if (!pending || store[pending] !== undefined) return;
		onChange({ ...store, [pending]: 1 });
		setPending('');
	};

	return (
		<div className={styles.section}>
			<div className={styles.sectionLabel}>Store</div>
			{header}
			{entries.length === 0 && <div className={styles.muted}>Empty. Add a resource below.</div>}
			{entries.map((resource) => (
				<AmountRow key={resource} resource={resource}
					amount={Number(store[resource]) || 0} max={maxAmountFor(model, store, resource)}
					onAmount={(value) => setAmount(resource, value, `store:${resource}`)}
					onRemove={() => remove(resource)} />
			))}
			<div className={styles.addRow}>
				<select className={styles.select} value={pending} onChange={(event) => setPending(event.target.value)}
					disabled={addable.length === 0}>
					<option value="">{addable.length ? 'Add item…' : 'Nothing left to add'}</option>
					{groups.map((group) => (
						<optgroup key={group.label} label={group.label}>
							{group.resources.map((resource) => <option key={resource} value={resource}>{resource}</option>)}
						</optgroup>
					))}
				</select>
				<button type="button" className={styles.addButton} disabled={!pending} onClick={add}>Add</button>
			</div>
			{object.type === 'creep' && (
				<div className={styles.fieldHint} style={{ marginTop: 6 }}>50 per CARRY part, more if boosted.</div>
			)}
		</div>
	);
}

function ChoiceRow({ slot, resource, amount, mods, onPick, onAmount }: {
	slot: ChoiceSlot;
	resource: string | undefined;
	amount: number;
	mods: string[] | undefined;
	onPick: (resource: string) => void;
	onAmount: (amount: number) => void;
}) {
	const groups = optionGroups(slot.options, mods);
	return (
		<AmountRow resource={resource ?? null} amount={amount} max={slot.capacity} onAmount={onAmount}>
			<select className={`${styles.select} ${styles.storeChoice}`} value={resource ?? ''}
				title={`Which ${slot.label} this holds`}
				onChange={(event) => onPick(event.target.value)}>
				<option value="">({slot.label}: empty)</option>
				{groups.map((group) => (
					<optgroup key={group.label} label={group.label}>
						{group.resources.map((option) => <option key={option} value={option}>{option}</option>)}
					</optgroup>
				))}
			</select>
		</AmountRow>
	);
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { ScenarioTemplate, CopyableScenario } from '../../api/types';
import styles from './EntryDialog.module.css';

export interface FolderOption { path: string; label: string }

export interface PromptSpec {
  kind: 'prompt';
  title: string;
  label: string;
  value: string;
  confirmLabel: string;
  onConfirm: (value: string) => Promise<unknown>;
}

export interface ConfirmSpec {
  kind: 'confirm';
  title: string;
  /** Plain sentence. Shown above `warning`, if any. */
  body: string;
  /** The "this is not just a delete" line — rendered in the danger colour. */
  warning?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
}

/** Rename and move in one form: both are "where does this live", and doing
 *  them in two dialogs made moving without a mouse impossible. */
export interface RenameSpec {
  kind: 'rename';
  title: string;
  value: string;
  folders: FolderOption[];
  currentParent: string;
  /** A folder cannot be moved into its own subtree; those options are hidden. */
  excludeSubtreeOf?: string;
  onConfirm: (value: { name: string; parent: string }) => Promise<unknown>;
}

export interface NewScenarioSpec {
  kind: 'newScenario';
  title: string;
  folders: FolderOption[];
  /** Where it lands unless you change it — the folder you last worked in. */
  defaultParent: string;
  onConfirm: (value: { name: string; parent: string; template: string }) => Promise<unknown>;
}

export type DialogSpec = PromptSpec | ConfirmSpec | RenameSpec | NewScenarioSpec;

// The "duplicate one of mine" entry in the Start-from picker. Choosing it
// reveals a second picker of your own scenarios; keeping them out of the first
// one is what stops a workspace of forty scenarios burying Basic and Blank.
const COPY_MINE = '__copy_scenario__';

/**
 * One modal for renaming, moving, creating and deleting.
 *
 * Deliberately not window.prompt/confirm: those cannot show the extra warning
 * a non-empty folder needs, cannot hold a template picker, cannot style the
 * destructive action differently, and are suppressed outright by some
 * browsers. Escape cancels, Enter confirms, focus lands in the field (or on
 * the safe button), and the backdrop closes it.
 */
export function EntryDialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const named = spec.kind === 'prompt' || spec.kind === 'rename' || spec.kind === 'newScenario';
  const isNew = spec.kind === 'newScenario';

  const [value, setValue] = useState(
    spec.kind === 'prompt' ? spec.value : spec.kind === 'rename' ? spec.value : ''
  );
  const [parent, setParent] = useState(
    spec.kind === 'newScenario' ? spec.defaultParent : spec.kind === 'rename' ? spec.currentParent : ''
  );
  const [template, setTemplate] = useState('basic');
  const [copyFrom, setCopyFrom] = useState('');
  const [catalog, setCatalog] = useState<{ templates: ScenarioTemplate[]; scenarios: CopyableScenario[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Fetched here rather than by the list: the picker is the only thing that
  // wants it, and a list that never opens this dialog should not pay for it.
  useEffect(() => {
    if (!isNew) return;
    let cancelled = false;
    api.scenarioTemplates()
      .then((r) => {
        if (cancelled) return;
        setCatalog(r);
        if (r.scenarios.length) setCopyFrom(r.scenarios[0].id);
      })
      .catch(() => { if (!cancelled) setCatalog({ templates: [], scenarios: [] }); });
    return () => { cancelled = true; };
  }, [isNew]);

  useEffect(() => {
    if (named) {
      const input = inputRef.current;
      if (input) { input.focus(); input.select(); }
    } else {
      cancelRef.current?.focus();
    }
  }, [named]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Your own scenarios, grouped by the folder they are in. optgroups cannot
  // nest, so a nested folder's full path is its heading.
  const scenarioGroups = useMemo(() => {
    const groups: { name: string; items: CopyableScenario[] }[] = [];
    for (const s of catalog?.scenarios || []) {
      const name = s.group || '(top level)';
      const existing = groups.find((g) => g.name === name);
      if (existing) existing.items.push(s);
      else groups.push({ name, items: [s] });
    }
    return groups;
  }, [catalog]);

  const templateGroups = useMemo(() => {
    const groups: { name: string; items: ScenarioTemplate[] }[] = [];
    for (const t of catalog?.templates || []) {
      const existing = groups.find((g) => g.name === t.group);
      if (existing) existing.items.push(t);
      else groups.push({ name: t.group, items: [t] });
    }
    return groups;
  }, [catalog]);

  const chosenTemplate = catalog?.templates.find((t) => t.id === template);
  const effectiveTemplate = template === COPY_MINE ? copyFrom : template;

  const submit = async () => {
    if (busy) return;
    const trimmed = value.trim();
    if (named && !trimmed) return;
    if (isNew && template === COPY_MINE && !copyFrom) return;
    setBusy(true);
    setError(null);
    try {
      if (spec.kind === 'prompt') await spec.onConfirm(trimmed);
      else if (spec.kind === 'rename') await spec.onConfirm({ name: trimmed, parent });
      else if (spec.kind === 'newScenario') await spec.onConfirm({ name: trimmed, parent, template: effectiveTemplate });
      else await spec.onConfirm();
      onClose();
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusy(false);
    }
  };

  const folderPicker = (folders: FolderOption[], id: string, label: string) => (
    <>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <select id={id} className={styles.input} value={parent} disabled={busy} onChange={(e) => setParent(e.target.value)}>
        {folders.map((f) => <option key={f.path || '/'} value={f.path}>{f.label}</option>)}
      </select>
    </>
  );

  const confirmLabel = spec.kind === 'confirm' ? spec.confirmLabel
    : spec.kind === 'prompt' ? spec.confirmLabel
      : spec.kind === 'rename' ? 'Save' : 'Create';
  const confirmClass = spec.kind === 'confirm' && spec.danger ? styles.danger : styles.primary;

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={spec.title}>
        <h3 className={styles.title}>{spec.title}</h3>

        {named ? (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label className={styles.label} htmlFor="entry-dialog-input">
              {spec.kind === 'prompt' ? spec.label : 'Name'}
            </label>
            <input
              id="entry-dialog-input"
              ref={inputRef}
              className={styles.input}
              value={value}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
            />

            {/* Only offered when there is somewhere other than the top level
                to put it. */}
            {spec.kind === 'rename' && spec.folders.length > 1
              && folderPicker(spec.folders, 'entry-dialog-folder', 'Folder')}

            {spec.kind === 'newScenario' && (
              <>
                {spec.folders.length > 1 && folderPicker(spec.folders, 'entry-dialog-folder', 'Folder')}

                <label className={styles.label} htmlFor="entry-dialog-template">Start from</label>
                <select
                  id="entry-dialog-template"
                  className={styles.input}
                  value={template}
                  disabled={busy || catalog === null}
                  onChange={(e) => setTemplate(e.target.value)}
                >
                  {catalog === null && <option value="basic">Loading…</option>}
                  {templateGroups.map((g) => (
                    <optgroup key={g.name} label={g.name}>
                      {g.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  ))}
                  {scenarioGroups.length > 0 && (
                    <optgroup label="Your scenarios">
                      <option value={COPY_MINE}>Duplicate one of mine…</option>
                    </optgroup>
                  )}
                </select>
                {template === COPY_MINE ? (
                  <>
                    <label className={styles.label} htmlFor="entry-dialog-copy">Duplicate</label>
                    <select
                      id="entry-dialog-copy"
                      className={styles.input}
                      value={copyFrom}
                      disabled={busy}
                      onChange={(e) => setCopyFrom(e.target.value)}
                    >
                      {scenarioGroups.map((g) => (
                        <optgroup key={g.name} label={g.name}>
                          {g.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <p className={styles.hint}>Copies its files — maps, main.js, settings.json. Saved replays stay with the original.</p>
                  </>
                ) : (
                  chosenTemplate?.description && <p className={styles.hint}>{chosenTemplate.description}</p>
                )}
              </>
            )}
          </form>
        ) : (
          <>
            <p className={styles.body}>{spec.body}</p>
            {spec.warning && <p className={styles.warning}>{spec.warning}</p>}
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button ref={cancelRef} className={styles.cancel} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={confirmClass}
            onClick={submit}
            disabled={busy || (named && !value.trim())}
          >{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

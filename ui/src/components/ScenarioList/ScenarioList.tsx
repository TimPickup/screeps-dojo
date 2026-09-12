import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { api } from '../../api/client';
import { useScenarioTree } from '../../hooks/useScenarioTree';
import { UpdateNotice } from '../UpdateNotice/UpdateNotice';
import { EntryDialog } from './EntryDialog';
import type { DialogSpec, FolderOption } from './EntryDialog';
import { RowMenu } from './RowMenu';
import type { MenuItem, MenuState } from './RowMenu';
import { TreeRow } from './TreeRow';
import { ancestorsOf, buildTree, isInside } from './tree';
import type { TreeNode } from './tree';
import logo from '../../assets/logo.png';
import styles from './ScenarioList.module.css';

interface VersionInfo { current: string; latest: string | null; updateAvailable: boolean; repoUrl: string; }
interface Props {
  enabled?: boolean;
  version?: VersionInfo | null;
  onSelect: (path: string) => void;
  onCreated: (path: string) => void;
  /** A folder to open and scroll to — set by clicking a header breadcrumb. */
  reveal?: string | null;
  onRevealed?: () => void;
}

// Folders start collapsed, and which ones you opened is remembered per browser
// — a workspace you organise once shouldn't need re-opening every visit.
const EXPANDED_KEY = 'dojo.expandedFolders';
// The folder you last worked in, so "+ New" defaults to it instead of always
// dropping scenarios at the top level. Remembered across visits for the same
// reason the expansion set is.
const LAST_FOLDER_KEY = 'dojo.lastFolder';
// Two non-breaking spaces per level, to show folder nesting in a <select>,
// which collapses ordinary leading whitespace.
const INDENT = '\xa0\xa0';

function readExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function writeExpanded(set: Set<string>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

function readLastFolder(): string {
  try { return localStorage.getItem(LAST_FOLDER_KEY) || ''; } catch { return ''; }
}

function writeLastFolder(path: string) {
  try { localStorage.setItem(LAST_FOLDER_KEY, path); } catch { /* ignore */ }
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

// Landing view: the scenario tree on the left, welcome panel on the right.
export function ScenarioList({ enabled = true, version, onSelect, onCreated, reveal, onRevealed }: Props) {
  const { tree, loading, error, reload } = useScenarioTree(enabled);
  const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [lastFolder, setLastFolderState] = useState<string>(readLastFolder);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  // '' is the root drop zone; null is "not over anything".
  const [dropPath, setDropPath] = useState<string | null>(null);

  const nodes = useMemo(() => buildTree(tree), [tree]);
  const folderPaths = useMemo(() => new Set(tree.folders.map((f) => f.path)), [tree.folders]);

  // Leaf names that appear more than once anywhere in the tree. Only those
  // rows get their folder shown beside them — qualifying every row is noise.
  const ambiguous = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of tree.scenarios) seen.set(s.name, (seen.get(s.name) || 0) + 1);
    for (const f of tree.folders) seen.set(f.name, (seen.get(f.name) || 0) + 1);
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name));
  }, [tree]);

  // '' (the top level) first, then every folder, indented to show the nesting
  // — a flat list of 'A/B/C' paths is unreadable once there are a few.
  const folderOptions: FolderOption[] = useMemo(() => {
    const sorted = [...tree.folders].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    return [{ path: '', label: '(top level)' } as FolderOption].concat(sorted.map((f) => ({
      path: f.path,
      label: INDENT.repeat(f.path.split('/').length - 1) + f.name
    })));
  }, [tree.folders]);

  const setLastFolder = useCallback((path: string) => {
    setLastFolderState(path);
    writeLastFolder(path);
  }, []);

  // A folder that has since been deleted must not keep being the default.
  const defaultParent = folderPaths.has(lastFolder) ? lastFolder : '';

  // Drop a folder that no longer exists, so a stale entry can't keep a
  // since-recreated folder of the same name permanently open.
  useEffect(() => {
    setExpanded((current) => {
      const kept = new Set([...current].filter((p) => folderPaths.has(p)));
      if (kept.size === current.size) return current;
      writeExpanded(kept);
      return kept;
    });
  }, [folderPaths]);

  // Coming back from a scenario via a breadcrumb: open the folder that was
  // clicked, and every folder above it, then put the keyboard on it. Waits for
  // the tree, so a reveal issued before the first load still lands.
  useEffect(() => {
    if (!reveal) return;
    if (!folderPaths.has(reveal)) { if (!loading) onRevealed?.(); return; }
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestor of ancestorsOf(reveal)) next.add(ancestor);
      next.add(reveal);
      writeExpanded(next);
      return next;
    });
    setLastFolder(reveal);
    setFocusPath(reveal);
    onRevealed?.();
  }, [reveal, folderPaths, loading, onRevealed, setLastFolder]);

  const toggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      // Opening a folder is the clearest signal of "this is where I am
      // working"; closing it says the opposite, so fall back to its parent.
      if (next.has(path)) { next.delete(path); setLastFolder(parentOf(path)); }
      else { next.add(path); setLastFolder(path); }
      writeExpanded(next);
      return next;
    });
  }, [setLastFolder]);

  const expand = useCallback((path: string, open: boolean) => {
    setExpanded((current) => {
      if (current.has(path) === open) return current;
      const next = new Set(current);
      if (open) next.add(path); else next.delete(path);
      writeExpanded(next);
      return next;
    });
  }, []);

  // ---- actions ---------------------------------------------------------

  const newScenario = (parent: string) => setDialog({
    kind: 'newScenario',
    title: 'New scenario',
    folders: folderOptions,
    defaultParent: parent,
    onConfirm: async ({ name, parent: target, template }) => {
      const r = await api.createScenario(name, target, template);
      setLastFolder(target);
      onCreated(r.path);
    }
  });

  // Shares the rename form: a name plus where it goes is exactly the same
  // question, so it is the same control.
  const newFolder = (parent: string) => setDialog({
    kind: 'rename',
    title: 'New folder',
    value: '',
    folders: folderOptions,
    currentParent: parent,
    onConfirm: async ({ name, parent: target }) => {
      const r = await api.createFolder(name, target);
      // A folder you just made is one you are about to put something in.
      setExpanded((current) => {
        const next = new Set(current).add(r.path);
        writeExpanded(next);
        return next;
      });
      setLastFolder(r.path);
    }
  });

  // Rename and move are the same question — "where does this live" — so they
  // are one form. Either half may be left alone.
  const rename = (node: TreeNode) => setDialog({
    kind: 'rename',
    title: node.kind === 'folder' ? 'Rename or move folder' : 'Rename or move scenario',
    value: node.name,
    // A folder cannot hold itself, so its own subtree is not offered.
    folders: node.kind === 'folder'
      ? folderOptions.filter((f) => !isInside(f.path, node.path))
      : folderOptions,
    currentParent: parentOf(node.path),
    onConfirm: async ({ name, parent: target }) => {
      // Move first, then rename: the reverse would have to guess the new path
      // before the server has told us what it is.
      let path = node.path;
      if (target !== parentOf(path)) path = (await api.moveEntry(path, target)).path;
      if (name !== node.name) path = (await api.renameEntry(path, name)).path;
      setFocusPath(path);
      setLastFolder(target);
    }
  });

  // Two requests on purpose: ask the server what is actually in there, then
  // confirm against the real numbers. A warning that says "3 scenarios" is
  // worth far more than one that says "this may contain things".
  const remove = async (node: TreeNode) => {
    let info: Awaited<ReturnType<typeof api.scenarioEntry>>;
    try { info = await api.scenarioEntry(node.path); }
    catch (e) {
      setDialog({ kind: 'confirm', title: 'Delete failed', body: String((e as Error).message || e), confirmLabel: 'Close', onConfirm: async () => {} });
      return;
    }

    if (info.kind === 'scenario') {
      const replays = info.recordings;
      setDialog({
        kind: 'confirm',
        title: 'Delete scenario',
        body: 'Delete "' + node.name + '" and everything in it? This cannot be undone.',
        warning: replays > 0
          ? 'Its ' + replays + ' saved replay' + (replays === 1 ? '' : 's') + ' will be deleted too — replays live inside the scenario.'
          : undefined,
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: () => api.deleteEntry(node.path, true)
      });
      return;
    }

    const { folders, scenarios } = info;
    const empty = folders === 0 && scenarios === 0;
    const parts: string[] = [];
    if (scenarios) parts.push(scenarios + ' scenario' + (scenarios === 1 ? '' : 's'));
    if (folders) parts.push(folders + ' folder' + (folders === 1 ? '' : 's'));
    setDialog({
      kind: 'confirm',
      title: 'Delete folder',
      body: 'Delete the folder "' + node.name + '"?',
      warning: empty
        ? undefined
        : 'This folder is NOT empty — it holds ' + parts.join(' and ')
          + '. All of it, including saved replays, will be deleted. This cannot be undone.',
      confirmLabel: empty ? 'Delete' : 'Delete everything',
      danger: true,
      onConfirm: () => api.deleteEntry(node.path, true)
    });
  };

  const move = async (path: string, parent: string) => {
    try { await api.moveEntry(path, parent); setLastFolder(parent); }
    catch (e) {
      setDialog({ kind: 'confirm', title: 'Could not move', body: String((e as Error).message || e), confirmLabel: 'Close', onConfirm: async () => {} });
    }
  };

  // ---- drag and drop ---------------------------------------------------

  // Allowed onto a folder or the root zone. Dragging a folder into its own
  // subtree would detach it, so that is refused here as well as on the server.
  const canDropFor = useCallback((path: string, target: string) => {
    if (target !== '' && !folderPaths.has(target)) return false;
    if (isInside(target, path)) return false;
    return parentOf(path) !== target;
  }, [folderPaths]);

  const dragOver = (target: string) => (e: DragEvent) => {
    if (dragPath === null || !canDropFor(dragPath, target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropPath(target);
  };

  const drop = (target: string) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // A drop handler can fire after dragEnd has cleared state, so fall back to
    // what the drag itself carried and re-check against that.
    const path = dragPath || e.dataTransfer.getData('text/plain');
    setDropPath(null);
    setDragPath(null);
    if (path && canDropFor(path, target)) move(path, target);
  };

  // ---- the flattened view: what renders, and what the keyboard walks ----

  const rows = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = [];
    const walk = (list: TreeNode[], depth: number) => {
      for (const node of list) {
        out.push({ node, depth });
        if (node.kind === 'folder' && expanded.has(node.path)) walk(node.children, depth + 1);
      }
    };
    walk(nodes, 0);
    return out;
  }, [nodes, expanded]);

  // Keep the keyboard on a row that still exists — after a delete, land on
  // whatever is there now rather than dropping focus to the page.
  useEffect(() => {
    if (focusPath === null) return;
    if (rows.some((r) => r.node.path === focusPath)) return;
    setFocusPath(rows.length ? rows[0].node.path : null);
  }, [rows, focusPath]);

  const onRowKeyDown = (index: number) => (e: ReactKeyboardEvent) => {
    const { node } = rows[index];
    const isFolder = node.kind === 'folder';
    const focusAt = (i: number) => { if (rows[i]) setFocusPath(rows[i].node.path); };

    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(index + 1); return;
      case 'ArrowUp': e.preventDefault(); focusAt(index - 1); return;
      case 'Home': e.preventDefault(); focusAt(0); return;
      case 'End': e.preventDefault(); focusAt(rows.length - 1); return;
      case 'ArrowRight':
        e.preventDefault();
        // Standard tree behaviour: open a closed folder, then step into it.
        if (isFolder && !expanded.has(node.path)) expand(node.path, true);
        else focusAt(index + 1);
        return;
      case 'ArrowLeft': {
        e.preventDefault();
        if (isFolder && expanded.has(node.path)) { expand(node.path, false); return; }
        const parent = parentOf(node.path);
        if (parent) setFocusPath(parent);
        return;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isFolder) toggle(node.path);
        else { setLastFolder(parentOf(node.path)); onSelect(node.path); }
        return;
      case 'F2': e.preventDefault(); rename(node); return;
      case 'Delete': e.preventDefault(); remove(node); return;
      default:
    }
  };

  // ---- context menu ----------------------------------------------------

  const openMenu = (e: ReactMouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    // On a folder, "here" is inside it; on a scenario, alongside it.
    const here = node === null ? defaultParent : node.kind === 'folder' ? node.path : parentOf(node.path);
    const items: MenuItem[] = [];
    if (node && node.kind === 'scenario') {
      items.push({ label: 'Open', onSelect: () => { setLastFolder(here); onSelect(node.path); } });
    }
    items.push({ label: node ? 'New scenario here' : 'New scenario', onSelect: () => newScenario(here) });
    items.push({ label: node ? 'New folder here' : 'New folder', onSelect: () => newFolder(here) });
    if (node) {
      items.push({ label: 'Rename or move…', onSelect: () => rename(node) });
      items.push({ label: 'Delete…', danger: true, onSelect: () => remove(node) });
      setFocusPath(node.path);
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const count = tree.scenarios.length;
  // Exactly one tabbable row, so Tab moves past the tree rather than through
  // forty scenarios.
  const focused = focusPath !== null && rows.some((r) => r.node.path === focusPath)
    ? focusPath
    : (rows[0]?.node.path ?? null);

  return (
    <div className={styles.wrap}>
      <aside
        className={dropPath === '' ? styles.listDropping : styles.list}
        onDragOver={dragOver('')}
        onDragLeave={() => setDropPath((p) => (p === '' ? null : p))}
        onDrop={drop('')}
        onContextMenu={(e) => openMenu(e, null)}
      >
        <div className={styles.listHead}>
          <span>Scenarios</span>
          <span className={styles.headActions}>
            <button
              className={styles.headButton}
              title={defaultParent ? 'New scenario in ' + defaultParent : 'New scenario'}
              onClick={() => newScenario(defaultParent)}
            >+ New</button>
            <button
              className={styles.headButton}
              title={defaultParent ? 'New folder in ' + defaultParent : 'New folder'}
              onClick={() => newFolder(defaultParent)}
            >+ Folder</button>
          </span>
        </div>

        {loading && <div className={styles.empty}>Loading scenarios…</div>}
        {error && (
          <div className={styles.listError}>
            {error}
            <button className={styles.retry} onClick={reload}>retry</button>
          </div>
        )}
        {/* "no scenarios" is a claim about the disk, so only make it once we
            have actually heard back from the server. */}
        {!loading && !error && count === 0 && tree.folders.length === 0 && (
          <div className={styles.empty}>No scenarios yet. Use <b>+ New</b>, or copy one from <code>examples/</code> into <code>scenarios/</code>.</div>
        )}

        <div role="tree" aria-label="Scenarios">
          {!loading && rows.map(({ node, depth }, index) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={depth}
              expanded={node.kind === 'folder' && expanded.has(node.path)}
              dragging={dragPath === node.path}
              dropTarget={node.kind === 'folder' && dropPath === node.path}
              focused={focused === node.path}
              qualifier={ambiguous.has(node.name) ? (parentOf(node.path) || 'top level') : undefined}
              onToggle={() => toggle(node.path)}
              onOpen={() => { setLastFolder(parentOf(node.path)); onSelect(node.path); }}
              onRename={() => rename(node)}
              onDelete={() => remove(node)}
              onFocus={() => setFocusPath(node.path)}
              onKeyDown={onRowKeyDown(index)}
              onContextMenu={(e) => openMenu(e, node)}
              onDragStart={(e) => {
                setDragPath(node.path);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', node.path);
              }}
              onDragEnd={() => { setDragPath(null); setDropPath(null); }}
              onDragOver={node.kind === 'folder' ? dragOver(node.path) : dragOver(parentOf(node.path))}
              onDragLeave={() => setDropPath((p) => (p === node.path ? null : p))}
              onDrop={node.kind === 'folder' ? drop(node.path) : drop(parentOf(node.path))}
            />
          ))}
        </div>

        {/* Always droppable, even on a full list: this is how you get something
            back out to the top level. Also the right-click target for
            "New scenario" with no row under the pointer. */}
        <div className={styles.rootZone} onDragOver={dragOver('')} onDrop={drop('')}>
          {dragPath ? 'Drop here to move to the top level' : ''}
        </div>
      </aside>

      <section className={styles.welcome}>
        <div className={styles.welcomeInner}>
          <img className={styles.welcomeLogo} src={logo} alt="Screeps Dojo" />
          <h2>Welcome to the Dojo</h2>
          {version?.updateAvailable && (
            <UpdateNotice current={version.current} latest={version.latest} repoUrl={version.repoUrl} />
          )}
          <p className={styles.dim}>Pick a scenario on the left to run it live, test it, watch replays, or edit its files.</p>
          <p className={styles.dim}>Group them with folders — drag onto a folder to move, or right-click any row. Replays travel with the scenario.</p>
          <p className={styles.dim}>Arrow keys walk the tree; F2 renames, Delete removes.</p>
        </div>
      </section>

      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)} />}
      {dialog && <EntryDialog spec={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

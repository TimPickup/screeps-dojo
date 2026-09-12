import { useEffect, useRef } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import type { TreeNode } from './tree';
import styles from './ScenarioList.module.css';

// Inline SVG rather than an icon font or an emoji: these two marks carry the
// only "what is this row?" signal in the list, so they have to be the exact
// colours the theme names (folders --warn, scenarios --accent) and stay sharp
// at 13px. Emoji would be neither.
function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg className={styles.folderIcon} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {open ? (
        <path
          fill="currentColor"
          d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.1c.4 0 .78.16 1.06.44L8.2 3.5H13a1.5 1.5 0 0 1 1.5 1.5v.5h-10a1.5 1.5 0 0 0-1.44 1.08L1.5 12.2V3.5Zm1.44 3.9A.6.6 0 0 1 3.5 7H15l-1.6 5.6a1.5 1.5 0 0 1-1.44 1.08H2.2a.7.7 0 0 1-.67-.9l1.41-5.38Z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.1c.4 0 .78.16 1.06.44L8.2 3.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3.5Z"
        />
      )}
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className={styles.playIcon} viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path fill="currentColor" d="M4.5 2.6a.7.7 0 0 1 1.06-.6l7.2 5.4a.75.75 0 0 1 0 1.2l-7.2 5.4a.7.7 0 0 1-1.06-.6V2.6Z" />
    </svg>
  );
}

export interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  dropTarget: boolean;
  dragging: boolean;
  /** The row the keyboard is on. Exactly one row in the tree is tabbable. */
  focused: boolean;
  /** Set when another row shares this leaf name — then the folder is shown. */
  qualifier?: string;
  onToggle: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}

export function TreeRow(props: TreeRowProps) {
  const { node, depth, expanded, dropTarget, dragging, focused, qualifier } = props;
  const isFolder = node.kind === 'folder';
  const empty = isFolder && node.children.length === 0;
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Roving tabindex: the focused row is the only one in the tab order, and
  // taking DOM focus is what makes Arrow/F2/Delete land here.
  useEffect(() => {
    if (!focused) return;
    const el = buttonRef.current;
    if (el && document.activeElement !== el) el.focus({ preventScroll: false });
  }, [focused]);

  const className = [
    styles.row,
    isFolder ? styles.folderRow : styles.scenarioRow,
    dropTarget ? styles.dropTarget : '',
    dragging ? styles.dragging : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      // 12px per level, plus the 14px the chevron occupies, so names in a
      // folder line up under the folder's own name rather than its icon.
      style={{ paddingLeft: 6 + depth * 12 }}
      draggable
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onContextMenu={props.onContextMenu}
    >
      <button
        ref={buttonRef}
        className={styles.main}
        tabIndex={focused ? 0 : -1}
        onFocus={props.onFocus}
        onKeyDown={props.onKeyDown}
        onClick={isFolder ? props.onToggle : props.onOpen}
        title={isFolder ? (expanded ? 'Collapse' : 'Expand') : 'Open ' + node.path}
        aria-expanded={isFolder ? expanded : undefined}
      >
        {isFolder ? (
          <span className={empty ? styles.chevronEmpty : styles.chevron} aria-hidden="true">
            {empty ? '' : expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className={styles.chevronEmpty} aria-hidden="true" />
        )}
        {isFolder ? <FolderIcon open={expanded} /> : <PlayIcon />}
        <span className={styles.name}>{node.name}</span>
        {/* Two scenarios in different folders may share a leaf name, and the
            tree only shows leaf names — so say which one this is. */}
        {qualifier && <span className={styles.qualifier}>{qualifier}</span>}
      </button>
      <span className={styles.rowActions}>
        <button
          className={styles.iconButton}
          tabIndex={-1}
          title={'Rename or move ' + node.name}
          aria-label={'Rename or move ' + node.name}
          onClick={(e) => { e.stopPropagation(); props.onRename(); }}
        >✎</button>
        <button
          className={styles.iconButtonDanger}
          tabIndex={-1}
          title={'Delete ' + node.name}
          aria-label={'Delete ' + node.name}
          onClick={(e) => { e.stopPropagation(); props.onDelete(); }}
        >🗑</button>
      </span>
    </div>
  );
}

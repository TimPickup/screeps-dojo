import type { Scenario, ScenarioFolder, ScenarioTree } from '../../api/types';

export type TreeNode =
  | { kind: 'folder'; name: string; path: string; children: TreeNode[] }
  | { kind: 'scenario'; name: string; path: string; scenario: Scenario };

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

// Folders first, then scenarios, each alphabetical and case-insensitive —
// the ordering every file manager uses, so nobody has to learn this one.
function byKindThenName(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Turns the server's two flat lists into the nested shape the view renders.
 *
 * The server sends paths, not nesting, because paths are what everything else
 * in the app keys off; the tree is a display concern and is rebuilt here.
 * An entry whose parent folder is missing from the list (a race with a delete)
 * is attached to the root rather than dropped, so nothing silently vanishes.
 */
export function buildTree({ folders, scenarios }: ScenarioTree): TreeNode[] {
  const nodes = new Map<string, TreeNode & { kind: 'folder' }>();
  for (const folder of folders as ScenarioFolder[]) {
    nodes.set(folder.path, { kind: 'folder', name: folder.name, path: folder.path, children: [] });
  }

  const roots: TreeNode[] = [];
  const attach = (node: TreeNode) => {
    const parent = nodes.get(parentOf(node.path));
    if (parent) parent.children.push(node);
    else roots.push(node);
  };

  // Shallowest first, so a folder is always attached before its children.
  const sortedFolders = [...folders].sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  for (const folder of sortedFolders) attach(nodes.get(folder.path)!);
  for (const scenario of scenarios) {
    attach({ kind: 'scenario', name: scenario.name, path: scenario.path, scenario });
  }

  const sortDeep = (list: TreeNode[]) => {
    list.sort(byKindThenName);
    for (const node of list) if (node.kind === 'folder') sortDeep(node.children);
  };
  sortDeep(roots);
  return roots;
}

/** Every folder path on the way down to `path`, so revealing a node expands
 *  each folder above it. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'));
  return out;
}

/** True when `folder` is `path` itself or contains it — used to refuse a drop
 *  of a folder into its own subtree. */
export function isInside(folder: string, path: string): boolean {
  return folder === path || folder.startsWith(path + '/');
}

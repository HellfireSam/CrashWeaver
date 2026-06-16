type BuildExplorerTreeOptions = {
  showHiddenEntries?: boolean;
};

export type ExplorerFileKind = 'markdown' | 'crashpad' | 'card';

export type ExplorerEntry =
  | {
      kind: 'file';
      path: string;
      fileKind: ExplorerFileKind;
    }
  | {
      kind: 'folder';
      path: string;
    };

export type ExplorerNode = {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  fileKind?: ExplorerFileKind;
  children: ExplorerNode[];
};

function createFolderNode(name: string, path: string): ExplorerNode {
  return {
    name,
    path,
    kind: 'folder',
    children: [],
  };
}

function createFileNode(name: string, path: string, fileKind: ExplorerFileKind): ExplorerNode {
  return {
    name,
    path,
    kind: 'file',
    fileKind,
    children: [],
  };
}

function sortNodes(nodes: ExplorerNode[]): ExplorerNode[] {
  return nodes
    .map((node): ExplorerNode => {
      if (node.kind === 'folder') {
        return {
          ...node,
          children: sortNodes(node.children),
        };
      }

      return node;
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'folder' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function shouldIncludePath(filePath: string, showHiddenEntries: boolean) {
  if (filePath === '.crashweaver' || filePath.startsWith('.crashweaver/')) {
    return true;
  }

  if (showHiddenEntries) {
    return true;
  }

  return !filePath.split('/').some((part) => part.startsWith('.'));
}

function ensureFolderChild(parent: ExplorerNode, name: string, path: string) {
  let next = parent.children.find((child) => child.kind === 'folder' && child.name === name);

  if (!next) {
    next = createFolderNode(name, path);
    parent.children.push(next);
  }

  return next;
}

export function buildExplorerTree(entries: ExplorerEntry[], options: BuildExplorerTreeOptions = {}): ExplorerNode[] {
  if (!entries.length) {
    return [];
  }

  const showHiddenEntries = options.showHiddenEntries ?? false;

  const root = createFolderNode('root', '');

  for (const entry of entries) {
    if (!shouldIncludePath(entry.path, showHiddenEntries)) {
      continue;
    }

    const parts = entry.path.split('/').filter(Boolean);
    let current = root;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isFile = entry.kind === 'file' && index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isFile) {
        const existingFile = current.children.find((child) => child.kind === 'file' && child.path === currentPath);

        if (!existingFile) {
          current.children.push(createFileNode(part, currentPath, entry.fileKind));
        }
      } else {
        current = ensureFolderChild(current, part, currentPath);
      }
    }
  }

  return sortNodes(root.children);
}

// ── Virtualization helpers ───────────────────────────────────────────────────

/** A single visible row in the flattened tree. */
export interface FlatTreeRow {
  node: ExplorerNode;
  depth: number;
}

/**
 * Flattens the explorer tree into a linear list of visible rows,
 * respecting folder expand/collapse state.
 *
 * Used by the virtualized ExplorerTree to map a scroll offset to
 * the correct tree nodes without rendering the entire tree.
 */
export function flattenVisibleNodes(
  nodes: ExplorerNode[],
  expandedFolders: Record<string, boolean>,
  depth = 0,
): FlatTreeRow[] {
  const result: FlatTreeRow[] = [];

  for (const node of nodes) {
    result.push({ node, depth });

    if (node.kind === 'folder' && expandedFolders[node.path]) {
      result.push(...flattenVisibleNodes(node.children, expandedFolders, depth + 1));
    }
  }

  return result;
}

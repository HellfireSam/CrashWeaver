import type { VaultDescriptor } from '../../electron/vault-contract';

export type ExplorerNode = {
  name: string;
  path: string;
  kind: 'folder' | 'file';
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

function createFileNode(name: string, path: string): ExplorerNode {
  return {
    name,
    path,
    kind: 'file',
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

export function buildExplorerTree(vault: VaultDescriptor | null): ExplorerNode[] {
  if (!vault) {
    return [];
  }

  const root = createFolderNode('root', '');

  for (const note of vault.notes) {
    const parts = note.filePath.split('/').filter(Boolean);
    let current = root;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isFile = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isFile) {
        current.children.push(createFileNode(part, currentPath));
      } else {
        let next = current.children.find((child) => child.kind === 'folder' && child.name === part);

        if (!next) {
          next = createFolderNode(part, currentPath);
          current.children.push(next);
        }

        current = next;
      }
    }
  }

  return sortNodes(root.children);
}

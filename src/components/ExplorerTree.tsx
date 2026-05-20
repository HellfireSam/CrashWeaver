import type { CSSProperties } from 'react';
import type { ExplorerNode } from '../lib/explorerTree';

type ExplorerTreeProps = {
  nodes: ExplorerNode[];
  depth?: number;
  expandedFolders: Record<string, boolean>;
  onToggleFolder: (folderPath: string) => void;
  onSelectFile: (filePath: string) => void;
  selectedFilePath: string;
  isReading: boolean;
};

export function ExplorerTree({
  nodes,
  depth = 0,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
  selectedFilePath,
  isReading,
}: ExplorerTreeProps) {
  return (
    <ul className="treeList" style={{ '--depth': depth } as CSSProperties}>
      {nodes.map((node) => {
        if (node.kind === 'folder') {
          const isExpanded = expandedFolders[node.path] ?? false;

          return (
            <li key={node.path}>
              <button
                type="button"
                className="treeRow folderRow"
                onClick={() => onToggleFolder(node.path)}
                aria-expanded={isExpanded}
                title={node.path}
              >
                <span className="treeGlyph">{isExpanded ? '▾' : '▸'}</span>
                <span className="treeName">{node.name}</span>
              </button>

              {isExpanded ? (
                <ExplorerTree
                  nodes={node.children}
                  depth={depth + 1}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                  selectedFilePath={selectedFilePath}
                  isReading={isReading}
                />
              ) : null}
            </li>
          );
        }

        return (
          <li key={node.path}>
            <button
              type="button"
              className={`treeRow fileRow ${selectedFilePath === node.path ? 'active' : ''}`}
              onClick={() => onSelectFile(node.path)}
              disabled={isReading}
              title={node.path}
            >
              <span className="treeGlyph">•</span>
              <span className="treeName">{node.name.replace(/\.md$/i, '')}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

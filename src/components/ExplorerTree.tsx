/**
 * ExplorerTree — virtualized file-tree component.
 *
 * Uses react-window's FixedSizeList to render only visible rows.
 * Flattens the tree structure into a linear list based on expand/collapse
 * state so that large vaults (1000+ notes) render smoothly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList as List } from 'react-window';
import type { CSSProperties } from 'react';
import type { ExplorerNode } from '../lib/explorerTree';
import { flattenVisibleNodes, type FlatTreeRow } from '../lib/explorerTree';

// ── Constants ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 28;
const MIN_LIST_HEIGHT = 60;
const INDENT_PER_LEVEL = 16;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTreeFileLabel(node: ExplorerNode) {
  if (node.fileKind === 'crashpad') return node.name.replace(/\.crashpad\.json$/i, '');
  if (node.fileKind === 'card') return node.name.replace(/\.json$/i, '');
  return node.name.replace(/\.md$/i, '');
}

// ── Props ────────────────────────────────────────────────────────────────────

interface ExplorerTreeProps {
  nodes: ExplorerNode[];
  expandedFolders: Record<string, boolean>;
  onToggleFolder: (folderPath: string) => void;
  onSelectFile: (filePath: string, fileKind: 'markdown' | 'crashpad' | 'card') => void;
  selectedFilePath: string;
  isReading: boolean;
  height?: number;
}

// ── Row renderer ─────────────────────────────────────────────────────────────

interface RowData {
  rows: FlatTreeRow[];
  expandedFolders: Record<string, boolean>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string, kind: 'markdown' | 'crashpad' | 'card') => void;
  selectedFilePath: string;
  isReading: boolean;
}

function TreeRow({ index, style, data }: { index: number; style: CSSProperties; data: RowData }) {
  const { rows, expandedFolders, onToggleFolder, onSelectFile, selectedFilePath, isReading } = data;
  const { node, depth } = rows[index];

  const indentStyle: CSSProperties = {
    ...style,
    paddingLeft: `${12 + depth * INDENT_PER_LEVEL}px`,
  };

  if (node.kind === 'folder') {
    const isExpanded = expandedFolders[node.path] ?? false;

    return (
      <div style={indentStyle}>
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
      </div>
    );
  }

  return (
    <div style={indentStyle}>
      <button
        type="button"
        className={`treeRow fileRow ${selectedFilePath === node.path ? 'active' : ''}`}
        onClick={() => onSelectFile(node.path, node.fileKind ?? 'markdown')}
        disabled={isReading}
        title={node.path}
      >
        <span className="treeGlyph">•</span>
        <span className="treeName">{formatTreeFileLabel(node)}</span>
      </button>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ExplorerTree({
  nodes,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
  selectedFilePath,
  isReading,
  height,
}: ExplorerTreeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState(height ?? MIN_LIST_HEIGHT);

  // Measure the container so the virtual list fills available space.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setMeasuredHeight(Math.max(MIN_LIST_HEIGHT, entry.contentRect.height));
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo<FlatTreeRow[]>(
    () => flattenVisibleNodes(nodes, expandedFolders),
    [nodes, expandedFolders],
  );

  const rowData: RowData = useMemo(
    () => ({ rows, expandedFolders, onToggleFolder, onSelectFile, selectedFilePath, isReading }),
    [rows, expandedFolders, onToggleFolder, onSelectFile, selectedFilePath, isReading],
  );

  const itemKey = useCallback(
    (index: number) => rows[index]?.node.path ?? `row-${index}`,
    [rows],
  );

  if (rows.length === 0) {
    return (
      <p className="emptyText" style={{ padding: '0.5rem 0.75rem' }}>
        Select a vault to load markdown notes and crashpad files.
      </p>
    );
  }

  // If the caller explicitly provided a height, use it.
  // Otherwise use the ResizeObserver-measured height so the list fills
  // whatever space the parent flex/grid container allocates.
  const effectiveHeight = height ?? measuredHeight;

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: MIN_LIST_HEIGHT, overflow: 'hidden' }}>
      <List
        height={Math.max(MIN_LIST_HEIGHT, effectiveHeight)}
        width="100%"
        itemCount={rows.length}
        itemSize={ROW_HEIGHT}
        itemData={rowData}
        itemKey={itemKey}
        overscanCount={10}
      >
        {TreeRow}
      </List>
    </div>
  );
}

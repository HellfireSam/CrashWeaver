/**
 * AppSidebar — the left sidebar panel (Explorer + Vault Info tabs).
 *
 * Consumes vault/UI state directly from context.
 * Receives event handlers via props (orchestrated by App.tsx).
 */

import { useMemo } from 'react';
import { useVaultState } from '../state/VaultContext';
import { useEditorState } from '../state/EditorContext';
import { useUIState } from '../state/UIContext';
import { ExplorerTree } from './ExplorerTree';
import { buildExplorerTree, type ExplorerEntry } from '../lib/explorerTree';
import { formatCardRebuildSummary } from '../lib/cards';
import { isPathInsideVault, normalizeRelativePath } from '../lib/editorPaths';

interface AppSidebarProps {
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string, fileKind: 'markdown' | 'crashpad' | 'card') => void;
}

export function AppSidebar({ onToggleFolder, onSelectFile }: AppSidebarProps) {
  const { vaultPath, vault, allCards, internalDirectories, crashpadSummaries } = useVaultState();
  const { isReading, selectedExplorerPath } = useEditorState();
  const {
    activeSidebarTab, expandedFolders, showHiddenEntries,
    isSidebarVisible,
    setActiveSidebarTab, setFocusedWindow,
  } = useUIState();

  const explorerItems = useMemo<ExplorerEntry[]>(() => {
    const noteEntries = (vault?.notes ?? []).map((note) => ({
      kind: 'file' as const,
      path: note.filePath,
      fileKind: 'markdown' as const,
    }));
    const crashpadEntries = crashpadSummaries.map((crashpad) => ({
      kind: 'file' as const,
      path: normalizeRelativePath(vaultPath, crashpad.filePath),
      fileKind: 'crashpad' as const,
    }));
    const cardEntries: ExplorerEntry[] = [];
    for (const card of allCards) {
      const cardStorePath = vault?.cardStore?.cardStorePath;
      if (!cardStorePath || !vaultPath) continue;
      const relativePath = normalizeRelativePath(vaultPath, `${cardStorePath.replace(/\\/g, '/')}/${card.uid}.json`);
      if (!isPathInsideVault(relativePath)) continue;
      cardEntries.push({ kind: 'file', path: relativePath, fileKind: 'card' });
    }
    const directoryEntries = internalDirectories.map((directoryPath) => ({
      kind: 'folder' as const,
      path: directoryPath,
    }));
    return [...directoryEntries, ...noteEntries, ...crashpadEntries, ...cardEntries];
  }, [allCards, crashpadSummaries, internalDirectories, vault, vaultPath]);

  const treeNodes = useMemo(
    () => buildExplorerTree(explorerItems, { showHiddenEntries }),
    [explorerItems, showHiddenEntries],
  );

  return (
    <aside
      className={`sidebar ${isSidebarVisible ? '' : 'paneHidden'}`}
      onMouseDown={() => setFocusedWindow('explorer')}
    >
      <div className="sidebarTabs">
        <button
          type="button"
          className={`tabButton ${activeSidebarTab === 'explorer' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('explorer')}
        >
          Explorer
        </button>
        <button
          type="button"
          className={`tabButton ${activeSidebarTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveSidebarTab('search')}
        >
          Vault
        </button>
      </div>

      {activeSidebarTab === 'explorer' ? (
        <div className="sidebarPanel">
          <p className="panelTitle">Files</p>
          {treeNodes.length ? (
            <ExplorerTree
              nodes={treeNodes}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              selectedFilePath={selectedExplorerPath}
              isReading={isReading}
            />
          ) : (
            <p className="emptyText">Select a vault to load markdown notes and crashpad files.</p>
          )}
        </div>
      ) : (
        <div className="sidebarPanel">
          <p className="panelTitle">Vault Info</p>
          <div className="sidebarPanelScroller">
            <p className="detailKey">Path</p>
            <p className="detailValue">{vaultPath ?? 'No vault selected.'}</p>
            <p className="detailKey">Card store</p>
            <p className="detailValue">{vault?.cardStore?.cardStorePath ?? 'Uses the default card store path when a vault is opened.'}</p>
            <p className="detailKey">Markdown files</p>
            <p className="detailValue">{vault?.notes.length ?? 0}</p>
            <p className="detailKey">Crashpads</p>
            <p className="detailValue">{crashpadSummaries.length}</p>
            <p className="detailKey">Indexed entries</p>
            <p className="detailValue">{vault?.index.entries.length ?? 0}</p>
            <p className="detailKey">Last rebuild</p>
            <p className="detailValue">{formatCardRebuildSummary(vault?.lastCardRebuild) ?? 'Card sync has not run yet.'}</p>
          </div>
        </div>
      )}
    </aside>
  );
}

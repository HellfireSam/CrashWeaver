import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import 'katex/dist/katex.min.css';
import type { VaultDescriptor, VaultNoteDocument } from '../electron/vault-contract';
import { ExplorerTree } from './components/ExplorerTree';
import { buildExplorerTree } from './lib/explorerTree';
import { renderMarkdownPreview } from './lib/markdownPreview';

const defaultDraftPath = 'Inbox/Stage-2-scratch.md';
const defaultDraftContent = [
  '# Stage 2 Scratch Note',
  '',
  'CrashWeaver vault write validation note.',
  '',
  '#stage2 #vault',
].join('\n');

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultDescriptor | null>(null);
  const [selectedNotePath, setSelectedNotePath] = useState('');
  const [draftPath, setDraftPath] = useState(defaultDraftPath);
  const [draftContent, setDraftContent] = useState(defaultDraftContent);
  const [activeNote, setActiveNote] = useState<VaultNoteDocument | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingIndex, setIsRefreshingIndex] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [activeSidebarTab, setActiveSidebarTab] = useState<'explorer' | 'search'>('explorer');
  const [sidebarWidth, setSidebarWidth] = useState(270);
  const [inspectorWidth, setInspectorWidth] = useState(280);
  const [activeResizer, setActiveResizer] = useState<'left' | 'right' | null>(null);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isInspectorVisible, setIsInspectorVisible] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [vaultAlias, setVaultAlias] = useState('My Vault');
  const [openFirstNoteOnVaultOpen, setOpenFirstNoteOnVaultOpen] = useState(true);
  const [editorFontSize, setEditorFontSize] = useState(15);
  const [viewMode, setViewMode] = useState<'source' | 'preview' | 'blocks'>('source');
  const [savedContent, setSavedContent] = useState(defaultDraftContent);
  const layoutRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const treeNodes = useMemo(() => buildExplorerTree(vault), [vault]);

  const renderedHtml = useMemo(() => {
    if (viewMode !== 'preview') return '';
    return renderMarkdownPreview(draftContent);
  }, [viewMode, draftContent]);

  useEffect(() => {
    if (!activeResizer) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const layout = layoutRef.current;

      if (!layout) {
        return;
      }

      const rect = layout.getBoundingClientRect();
      const minimumEditorWidth = 420;

      if (activeResizer === 'left' && isSidebarVisible) {
        const nextWidth = event.clientX - rect.left;
        const rightSpace = isInspectorVisible ? inspectorWidth : 0;
        const maxWidth = rect.width - rightSpace - minimumEditorWidth - 16;
        const clamped = Math.max(190, Math.min(nextWidth, Math.max(190, maxWidth)));
        setSidebarWidth(Math.round(clamped));
        return;
      }

      if (activeResizer === 'right' && isInspectorVisible) {
        const rightWidth = rect.right - event.clientX;
        const leftSpace = isSidebarVisible ? sidebarWidth : 0;
        const maxWidth = rect.width - leftSpace - minimumEditorWidth - 16;
        const clamped = Math.max(210, Math.min(rightWidth, Math.max(210, maxWidth)));
        setInspectorWidth(Math.round(clamped));
      }
    }

    function handleMouseUp() {
      setActiveResizer(null);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeResizer, inspectorWidth, isInspectorVisible, isSidebarVisible, sidebarWidth]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsSettingsOpen(false);
      }
    }

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  async function loadVault(rootPath: string, preferredNotePath?: string) {
    const openedVault = await window.crashWeaver.openVault(rootPath);
    const noteToOpen = preferredNotePath ?? (openFirstNoteOnVaultOpen ? openedVault.notes[0]?.filePath : undefined);

    setVaultPath(rootPath);
    setVault(openedVault);
    setExpandedFolders({});

    if (noteToOpen) {
      const note = await window.crashWeaver.readNote(rootPath, noteToOpen);
      setActiveNote(note);
      setSelectedNotePath(note.filePath);
      setDraftPath(note.filePath);
      setDraftContent(note.content);
      setSavedContent(note.content);
      return;
    }

    setActiveNote(null);
    setSelectedNotePath('');
    setDraftPath(defaultDraftPath);
    setDraftContent(defaultDraftContent);
    setSavedContent(defaultDraftContent);
  }

  function handleToggleFolder(folderPath: string) {
    setExpandedFolders((previous) => ({
      ...previous,
      [folderPath]: !(previous[folderPath] ?? false),
    }));
  }

  async function handleSelectVault() {
    setIsPicking(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const selectedPath = await window.crashWeaver.selectVaultFolder();

      if (!selectedPath) {
        setStatusMessage('Vault selection was cancelled.');
        return;
      }

      await loadVault(selectedPath);
      setStatusMessage('Vault opened and index.json synchronized.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected vault selection error.';
      setErrorMessage(message);
    } finally {
      setIsPicking(false);
    }
  }

  async function handleOpenNote(filePath: string) {
    if (!vaultPath) {
      return;
    }

    setIsReading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const note = await window.crashWeaver.readNote(vaultPath, filePath);
      setActiveNote(note);
      setSelectedNotePath(note.filePath);
      setDraftPath(note.filePath);
      setDraftContent(note.content);
      setSavedContent(note.content);
      setStatusMessage(`Loaded ${note.filePath}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected note read error.';
      setErrorMessage(message);
    } finally {
      setIsReading(false);
    }
  }

  async function handleSaveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!vaultPath) {
      setErrorMessage('Select a vault before saving a note.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const result = await window.crashWeaver.writeNote(vaultPath, {
        filePath: draftPath,
        content: draftContent,
      });

      setVault(result.vault);
      setActiveNote(result.note);
      setSelectedNotePath(result.note.filePath);
      setDraftPath(result.note.filePath);
      setDraftContent(result.note.content);
      setSavedContent(result.note.content);
      setStatusMessage(`Saved ${result.note.filePath} and refreshed index.json.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected note write error.';
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  }

  function handleDiscard() {
    setDraftContent(savedContent);
    if (activeNote) setDraftPath(activeNote.filePath);
  }

  function handleUndo() {
    textareaRef.current?.focus();
    document.execCommand('undo');
  }

  function handleRedo() {
    textareaRef.current?.focus();
    document.execCommand('redo');
  }

  async function handleRefreshIndex() {
    if (!vaultPath) {
      setErrorMessage('Select a vault before refreshing the index.');
      return;
    }

    setIsRefreshingIndex(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const refreshedVault = await window.crashWeaver.updateIndex(vaultPath);
      setVault(refreshedVault);
      setStatusMessage('index.json refreshed from the current markdown files.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected index refresh error.';
      setErrorMessage(message);
    } finally {
      setIsRefreshingIndex(false);
    }
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div className="brandCluster">
          <p className="workspaceLabel">CrashWeaver Vault</p>
          <h1>Notes</h1>
        </div>

        <div className="topBarActions">
          <button
            className={`actionButton ghost iconButton ${isSidebarVisible ? 'activePane' : ''}`}
            onClick={() => setIsSidebarVisible((current) => !current)}
            title="Toggle explorer pane"
          >
            ☰
          </button>
          <button
            className={`actionButton ghost iconButton ${isInspectorVisible ? 'activePane' : ''}`}
            onClick={() => setIsInspectorVisible((current) => !current)}
            title="Toggle properties pane"
          >
            ≣
          </button>
          <button className="actionButton" onClick={handleSelectVault} disabled={isPicking}>
            {isPicking ? 'Opening...' : 'Open Vault'}
          </button>
          <button className="actionButton ghost" onClick={handleRefreshIndex} disabled={!vaultPath || isRefreshingIndex}>
            {isRefreshingIndex ? 'Refreshing...' : 'Refresh Index'}
          </button>
        </div>
      </header>

      <section
        className="layoutGrid"
        ref={layoutRef}
        style={
          {
            '--sidebar-width': isSidebarVisible ? `${sidebarWidth}px` : '0px',
            '--left-splitter-width': isSidebarVisible ? '8px' : '0px',
            '--inspector-width': isInspectorVisible ? `${inspectorWidth}px` : '0px',
            '--right-splitter-width': isInspectorVisible ? '8px' : '0px',
            '--editor-font-size': `${editorFontSize}px`,
          } as CSSProperties
        }
      >
        <aside className={`sidebar ${isSidebarVisible ? '' : 'paneHidden'}`}>
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
                  onToggleFolder={handleToggleFolder}
                  onSelectFile={handleOpenNote}
                  selectedFilePath={selectedNotePath}
                  isReading={isReading}
                />
              ) : (
                <p className="emptyText">Select a vault to load markdown files.</p>
              )}
            </div>
          ) : (
            <div className="sidebarPanel">
              <p className="panelTitle">Vault Info</p>
              <p className="detailKey">Path</p>
              <p className="detailValue">{vaultPath ?? 'No vault selected.'}</p>
              <p className="detailKey">Markdown files</p>
              <p className="detailValue">{vault?.notes.length ?? 0}</p>
              <p className="detailKey">Indexed entries</p>
              <p className="detailValue">{vault?.index.entries.length ?? 0}</p>
            </div>
          )}

          <div className="sidebarFooter">
            <button className="settingsIconButton" title="Vault settings" onClick={() => setIsSettingsOpen(true)}>
              ⚙
            </button>
          </div>
        </aside>

        <div
          className={`splitter splitterLeft ${activeResizer === 'left' ? 'active' : ''} ${isSidebarVisible ? '' : 'paneHidden'}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize explorer pane"
          onMouseDown={() => setActiveResizer('left')}
        />

        <section className="editorPane">
          <div className="editorCanvas">

            <div className="viewModeBar">
              <div className="viewModeTabs">
                <button
                  type="button"
                  className={`viewModeTab ${viewMode === 'source' ? 'active' : ''}`}
                  onClick={() => setViewMode('source')}
                >
                  Source
                </button>
                <button
                  type="button"
                  className={`viewModeTab ${viewMode === 'preview' ? 'active' : ''}`}
                  onClick={() => setViewMode('preview')}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className={`viewModeTab ${viewMode === 'blocks' ? 'active' : ''}`}
                  onClick={() => setViewMode('blocks')}
                >
                  Blocks
                </button>
              </div>

              {viewMode === 'source' ? (
                <div className="editorSourceHeader">
                  <input
                    id="draftPath"
                    className="notePathInput"
                    value={draftPath}
                    onChange={(event) => setDraftPath(event.target.value)}
                    placeholder="Inbox/Stage-2-scratch.md"
                  />
                  <div className="sourceActions">
                    <button
                      type="button"
                      className="actionButton ghost"
                      title="Undo"
                      onClick={handleUndo}
                    >
                      ↩ Undo
                    </button>
                    <button
                      type="button"
                      className="actionButton ghost"
                      title="Redo"
                      onClick={handleRedo}
                    >
                      ↪ Redo
                    </button>
                    <button
                      type="button"
                      className="actionButton ghost"
                      title="Discard changes"
                      disabled={draftContent === savedContent && draftPath === (activeNote?.filePath ?? defaultDraftPath)}
                      onClick={handleDiscard}
                    >
                      Discard
                    </button>
                    <button
                      className="actionButton"
                      type="submit"
                      form="noteEditorForm"
                      disabled={!vaultPath || isSaving}
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {viewMode === 'source' ? (
              <form id="noteEditorForm" className="editorForm" onSubmit={handleSaveNote}>
                <textarea
                  id="draftContent"
                  ref={textareaRef}
                  className="editorTextArea"
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  placeholder="Write markdown..."
                />
              </form>
            ) : viewMode === 'preview' ? (
              <div
                className="markdownPreview"
                // Preview HTML is built from the user's own vault content.
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            ) : (
              <div className="blocksPlaceholder">
                <div className="placeholderCard">
                  <p className="placeholderIcon">🧩</p>
                  <p className="placeholderTitle">Knowledge Blocks</p>
                  <p className="placeholderBody">
                    Knowledge block parsing is coming in Stage 3. Once implemented, this view will
                    display all extracted knowledge blocks from the current note.
                  </p>
                </div>
              </div>
            )}

            <div className="statusBar">
              {statusMessage ? <p className="statusText">{statusMessage}</p> : null}
              {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
            </div>
          </div>
        </section>

        <div
          className={`splitter splitterRight ${activeResizer === 'right' ? 'active' : ''} ${isInspectorVisible ? '' : 'paneHidden'}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize properties pane"
          onMouseDown={() => setActiveResizer('right')}
        />

        <aside className={`inspectorPane ${isInspectorVisible ? '' : 'paneHidden'}`}>
          <p className="panelTitle">Properties</p>
          <div className="propertyGroup">
            <p className="detailKey">Active note</p>
            <p className="detailValue">{activeNote?.filePath ?? 'None selected'}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Tags</p>
            <p className="detailValue">{activeNote?.tags.length ? `#${activeNote.tags.join(' #')}` : 'No tags'}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Last modified</p>
            <p className="detailValue">{activeNote?.modifiedAt ?? 'Not available'}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Index file</p>
            <p className="detailValue">{vault?.indexFilePath ?? 'Generated after opening vault'}</p>
          </div>
        </aside>
      </section>

      {!isSidebarVisible ? (
        <button className="floatingSettingsButton" title="Vault settings" onClick={() => setIsSettingsOpen(true)}>
          ⚙
        </button>
      ) : null}

      {isSettingsOpen ? (
        <div className="settingsOverlay" role="dialog" aria-modal="true" onClick={() => setIsSettingsOpen(false)}>
          <section className="settingsModal" onClick={(event) => event.stopPropagation()}>
            <header className="settingsHeader">
              <div>
                <p className="panelTitle">Vault Settings</p>
                <h2>Configuration</h2>
              </div>
              <button className="actionButton ghost" onClick={() => setIsSettingsOpen(false)}>
                Close
              </button>
            </header>

            <div className="settingsGrid">
              <div className="settingSection">
                <label className="settingLabel" htmlFor="vaultAlias">
                  Vault alias
                </label>
                <input
                  id="vaultAlias"
                  className="notePathInput"
                  value={vaultAlias}
                  onChange={(event) => setVaultAlias(event.target.value)}
                  placeholder="My Vault"
                />

                <label className="settingLabel" htmlFor="editorFontSize">
                  Editor font size: {editorFontSize}px
                </label>
                <input
                  id="editorFontSize"
                  className="rangeInput"
                  type="range"
                  min={13}
                  max={20}
                  value={editorFontSize}
                  onChange={(event) => setEditorFontSize(Number(event.target.value))}
                />

                <label className="toggleRow" htmlFor="openFirstNoteOnVaultOpen">
                  <input
                    id="openFirstNoteOnVaultOpen"
                    type="checkbox"
                    checked={openFirstNoteOnVaultOpen}
                    onChange={(event) => setOpenFirstNoteOnVaultOpen(event.target.checked)}
                  />
                  <span>Open first note automatically after vault load</span>
                </label>
              </div>

              <div className="settingSection">
                <p className="panelTitle">Vault Metadata</p>
                <p className="detailKey">Alias</p>
                <p className="detailValue">{vaultAlias || 'Unnamed vault'}</p>
                <p className="detailKey">Vault path</p>
                <p className="detailValue">{vaultPath ?? 'No vault selected.'}</p>
                <p className="detailKey">Markdown notes</p>
                <p className="detailValue">{vault?.notes.length ?? 0}</p>
                <p className="detailKey">Index entries</p>
                <p className="detailValue">{vault?.index.entries.length ?? 0}</p>
                <p className="detailKey">Last index refresh</p>
                <p className="detailValue">{vault?.index.updatedAt ?? 'Not available'}</p>
                <p className="detailKey">Current note</p>
                <p className="detailValue">{activeNote?.filePath ?? 'None selected'}</p>
                <p className="detailKey">Current note size</p>
                <p className="detailValue">{activeNote ? `${activeNote.size} bytes` : 'Not available'}</p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

import { useMemo, useRef } from 'react';
import type { DragEvent, FormEvent, MutableRefObject, RefObject } from 'react';
import type { CardDocument, CardRestoreMode } from '../../electron/vault-contract';
import type { CrashpadTabViewState, MarkdownTabViewState } from '../hooks/useEditorTabViewState';
import { useStoredScrollSync } from '../hooks/useStoredScrollSync';
import type { CardDetailTab, CardViewRecord } from '../lib/cards';
import { getFileName } from '../lib/cards';
import { renderMarkdownPreview } from '../lib/markdownPreview';
import { useEditorState } from '../state/EditorContext';
import { useUIState } from '../state/UIContext';
import { useVaultState } from '../state/VaultContext';
import { CardsWorkspace } from './CardsWorkspace';
import { CrashpadWorkspace } from './CrashpadWorkspace';

type EditorTabsBinding = {
  displayTabs: string[];
  currentEditorPath: string;
  currentTabPath: string;
  hasUnsavedChanges: boolean;
  dragTargetTabPath: string | null;
  onTabDragStart: (event: DragEvent<HTMLDivElement>, filePath: string) => void;
  onTabDragOver: (event: DragEvent<HTMLDivElement>, filePath: string) => void;
  onTabDrop: (filePath: string) => void;
  onTabDragEnd: () => void;
  onActivateTab: (filePath: string) => Promise<void>;
  onCloseTab: (filePath: string) => Promise<void>;
};

type NoteSaveBinding = {
  saveCurrentNote: () => Promise<void>;
  onSaveNote: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onDiscard: () => void;
};

type CardDetailBinding = {
  activeCardDetailTab: CardDetailTab;
  cardDetailPanelRef: RefObject<HTMLElement>;
  focusedCardElement: string;
  revealedQaAnswers: Record<string, boolean>;
  onCardDetailScroll: (scrollTop: number) => void;
  onSetCardFocusElement: (elementKey: string) => void;
  onSwitchCardDetailTab: (nextTab: CardDetailTab, focusElement: string) => void;
  onToggleQaAnswer: (uid: string, index: number) => void;
};

type CrashpadBinding = {
  activeCrashpadViewState: CrashpadTabViewState;
  onActivePanelChange: (panel: 'cards' | 'history') => void;
  onAttachExistingCard: (uid: string) => Promise<boolean>;
  onCreateNewCard: (uid: string) => Promise<boolean>;
  onDeleteFocusedCard: (request: { confirmed: boolean }) => Promise<boolean>;
  onEditorModeChange: (mode: 'edit' | 'preview') => void;
  onPreviewTabChange: (tab: CardDetailTab) => void;
  onRedo: () => Promise<void>;
  onRestoreDeletedCard: (uid: string, deletedAt: string, mode: CardRestoreMode) => Promise<void>;
  onSaveFocusedCard: (card: CardDocument) => Promise<void>;
  onScrollTopChange: (scrollTop: number) => void;
  onTogglePreviewQa: (answerKey: string) => void;
  onUndo: () => Promise<void>;
};

type EditorSurfaceProps = {
  editorPaneRef: MutableRefObject<HTMLElement | null>;
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  isMarkdownEditor: boolean;
  isCrashpadEditor: boolean;
  isCardEditor: boolean;
  visibleCards: CardViewRecord[];
  focusedCard: CardViewRecord | null;
  tabs: EditorTabsBinding;
  noteSave: NoteSaveBinding;
  cardDetail: CardDetailBinding;
  crashpad: CrashpadBinding;
  activeMarkdownViewState: MarkdownTabViewState;
  onMarkdownTabViewStateChange: (
    filePath: string,
    nextState: Partial<MarkdownTabViewState>,
  ) => void;
  onOpenNote: (filePath: string) => Promise<void>;
};

/**
 * The editor surface: the tab strip, the view-mode and card-scope controls, the
 * source/preview/cards/crashpad body, and the status bar. It reads the editor,
 * vault and UI state from their contexts and receives the action bindings the
 * app shell owns, so splitting it out does not move state or grow any existing
 * component's props.
 */
export function EditorSurface({
  editorPaneRef,
  textareaRef,
  isMarkdownEditor,
  isCrashpadEditor,
  isCardEditor,
  visibleCards,
  focusedCard,
  tabs,
  noteSave,
  cardDetail,
  crashpad,
  activeMarkdownViewState,
  onMarkdownTabViewStateChange,
  onOpenNote,
}: EditorSurfaceProps) {
  const {
    selectedNotePath,
    draftPath,
    draftContent,
    activeNote,
    viewMode,
    cardScope,
    isSaving,
    statusMessage,
    errorMessage,
    setDraftPath,
    setDraftContent,
    setViewMode,
    setCardScope,
  } = useEditorState();
  const { vaultPath, vault, activeCrashpad, crashpadDeletePreferences } = useVaultState();
  const { focusedWindow, crashpadPast, crashpadFuture, setFocusedCardUid, setFocusedWindow } =
    useUIState();
  const markdownPreviewRef = useRef<HTMLDivElement | null>(null);

  const { currentEditorPath, currentTabPath, hasUnsavedChanges } = tabs;
  const imageDirectories = vault?.imageDirectories ?? [];

  const renderedHtml = useMemo(() => {
    if (!isMarkdownEditor || viewMode !== 'preview') return '';
    return renderMarkdownPreview(draftContent, vaultPath, vault?.imageDirectories ?? []);
  }, [draftContent, isMarkdownEditor, vault?.imageDirectories, viewMode, vaultPath]);

  const { markLocallyScrolling: markSourceLocallyScrolling } = useStoredScrollSync(
    textareaRef,
    activeMarkdownViewState.sourceScrollTop,
    { enabled: isMarkdownEditor && viewMode === 'source' },
  );
  const { markLocallyScrolling: markPreviewLocallyScrolling } = useStoredScrollSync(
    markdownPreviewRef,
    activeMarkdownViewState.previewScrollTop,
    { enabled: isMarkdownEditor && viewMode === 'preview' },
  );

  function handleUndo() {
    textareaRef.current?.focus();
    document.execCommand('undo');
  }

  function handleRedo() {
    textareaRef.current?.focus();
    document.execCommand('redo');
  }

  return (
    <section className="editorPane" ref={editorPaneRef}>
      <div className="editorCanvas">
        <div className="viewModeBar">
          <div className="editorTabsBar">
            {tabs.displayTabs.map((tabPath) => {
              const isActiveTab =
                tabPath === currentEditorPath ||
                (isMarkdownEditor && !hasUnsavedChanges && tabPath === selectedNotePath);
              const isDirtyTab = hasUnsavedChanges && tabPath === currentEditorPath;

              return (
                <div
                  key={tabPath}
                  className={`editorTabShell ${isActiveTab ? 'active' : ''} ${tabs.dragTargetTabPath === tabPath ? 'dragTarget' : ''}`}
                  draggable
                  onDragStart={(event) => tabs.onTabDragStart(event, tabPath)}
                  onDragOver={(event) => tabs.onTabDragOver(event, tabPath)}
                  onDrop={() => tabs.onTabDrop(tabPath)}
                  onDragEnd={tabs.onTabDragEnd}
                >
                  <button
                    type="button"
                    className="editorTab"
                    onClick={() => void tabs.onActivateTab(tabPath)}
                    title={tabPath}
                  >
                    <span className="editorTabName">{getFileName(tabPath)}</span>
                    {isDirtyTab ? <span className="editorTabDirty">*</span> : null}
                  </button>
                  <button
                    type="button"
                    className="editorTabClose"
                    title={`Close ${getFileName(tabPath)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void tabs.onCloseTab(tabPath);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {isMarkdownEditor ? (
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
                className={`viewModeTab ${viewMode === 'cards' ? 'active' : ''}`}
                onClick={() => setViewMode('cards')}
              >
                Cards
              </button>
            </div>
          ) : null}

          {isMarkdownEditor && viewMode === 'cards' ? (
            <div className="cardsScopeSwitch" aria-label="Cards scope">
              <button
                type="button"
                className={`scopeButton ${cardScope === 'current-note' ? 'active' : ''}`}
                onClick={() => setCardScope('current-note')}
              >
                Note
              </button>
              <button
                type="button"
                className={`scopeButton ${cardScope === 'current-vault' ? 'active' : ''}`}
                onClick={() => setCardScope('current-vault')}
              >
                Vault
              </button>
            </div>
          ) : null}

          {isMarkdownEditor && viewMode === 'source' ? (
            <div className="editorSourceHeader">
              <input
                id="draftPath"
                className="notePathInput"
                value={draftPath}
                onChange={(event) => setDraftPath(event.target.value)}
                onFocus={() => setFocusedWindow('source-editor')}
                placeholder="Inbox/Stage-2-scratch.md"
              />
              <div className="sourceActions">
                <div className="editorActionWidget" aria-label="Editor actions">
                  <button
                    type="button"
                    className="editorIconButton"
                    title="Undo (Ctrl+Z)"
                    onClick={handleUndo}
                  >
                    ↺
                  </button>
                  <button
                    type="button"
                    className="editorIconButton"
                    title="Redo (Ctrl+Shift+Z)"
                    onClick={handleRedo}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    className="editorIconButton"
                    title="Save (Ctrl+S)"
                    onClick={() => void noteSave.saveCurrentNote()}
                    disabled={!vaultPath || isSaving}
                  >
                    ⤓
                  </button>
                </div>
                <button
                  type="button"
                  className="actionButton ghost"
                  title="Discard changes"
                  disabled={!hasUnsavedChanges}
                  onClick={noteSave.onDiscard}
                >
                  Reset
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {isCrashpadEditor ? (
          <CrashpadWorkspace
            activeCrashpad={activeCrashpad}
            activePanel={crashpad.activeCrashpadViewState.activePanel}
            canRedo={crashpadFuture.length > 0}
            canUndo={crashpadPast.length > 0}
            crashpadDeletePreferences={crashpadDeletePreferences}
            editorMode={crashpad.activeCrashpadViewState.editorMode}
            focusedCard={focusedCard}
            statusMessage={statusMessage}
            errorMessage={errorMessage}
            imageDirectories={imageDirectories}
            previewTab={crashpad.activeCrashpadViewState.previewTab}
            revealedQa={crashpad.activeCrashpadViewState.revealedQaAnswers}
            scrollTop={crashpad.activeCrashpadViewState.scrollTop}
            vaultPath={vaultPath}
            visibleCards={visibleCards}
            onActivePanelChange={crashpad.onActivePanelChange}
            onAttachExistingCard={crashpad.onAttachExistingCard}
            onCreateNewCard={crashpad.onCreateNewCard}
            onDeleteFocusedCard={crashpad.onDeleteFocusedCard}
            onEditorModeChange={crashpad.onEditorModeChange}
            onOpenNote={onOpenNote}
            onPreviewTabChange={crashpad.onPreviewTabChange}
            onRedo={crashpad.onRedo}
            onRestoreDeletedCard={crashpad.onRestoreDeletedCard}
            onSaveFocusedCard={crashpad.onSaveFocusedCard}
            onSelectCard={setFocusedCardUid}
            onScrollTopChange={crashpad.onScrollTopChange}
            onTogglePreviewQa={crashpad.onTogglePreviewQa}
            onUndo={crashpad.onUndo}
          />
        ) : isCardEditor || viewMode === 'cards' ? (
          // A card document has no note scope, so it always renders the vault
          // catalog; the note-editor cards view uses the selected scope.
          <CardsWorkspace
            activeCardDetailTab={cardDetail.activeCardDetailTab}
            activeNote={activeNote}
            cardDetailPanelRef={cardDetail.cardDetailPanelRef}
            cardScope={isCardEditor ? 'current-vault' : cardScope}
            focusedCard={focusedCard}
            focusedCardElement={cardDetail.focusedCardElement}
            focusedWindow={focusedWindow}
            imageDirectories={imageDirectories}
            revealedQaAnswers={cardDetail.revealedQaAnswers}
            vaultPath={vaultPath}
            visibleCards={visibleCards}
            onCardDetailScroll={cardDetail.onCardDetailScroll}
            onOpenNote={onOpenNote}
            onSelectCard={setFocusedCardUid}
            onSetCardFocusElement={cardDetail.onSetCardFocusElement}
            onSetFocusedWindow={setFocusedWindow}
            onSwitchCardDetailTab={cardDetail.onSwitchCardDetailTab}
            onToggleQaAnswer={cardDetail.onToggleQaAnswer}
          />
        ) : viewMode === 'source' ? (
          <form
            id="noteEditorForm"
            className="editorForm"
            onSubmit={(event) => {
              void noteSave.onSaveNote(event);
            }}
          >
            <textarea
              id="draftContent"
              ref={textareaRef}
              className="editorTextArea"
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              onScroll={(event) => {
                markSourceLocallyScrolling();

                if (currentTabPath) {
                  onMarkdownTabViewStateChange(currentTabPath, {
                    sourceScrollTop: event.currentTarget.scrollTop,
                  });
                }
              }}
              onFocus={() => setFocusedWindow('source-editor')}
              placeholder="Write markdown..."
            />
          </form>
        ) : viewMode === 'preview' ? (
          <div
            ref={markdownPreviewRef}
            className="markdownPreview"
            onMouseDown={() => setFocusedWindow('preview')}
            onScroll={(event) => {
              markPreviewLocallyScrolling();

              if (currentTabPath) {
                onMarkdownTabViewStateChange(currentTabPath, {
                  previewScrollTop: event.currentTarget.scrollTop,
                });
              }
            }}
            // Preview HTML is built from the user's own vault content.
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        ) : null}

        <div className="statusBar">
          {statusMessage ? <p className="statusText">{statusMessage}</p> : null}
          {errorMessage ? <p className="errorText">{errorMessage}</p> : null}
        </div>
      </div>
    </section>
  );
}

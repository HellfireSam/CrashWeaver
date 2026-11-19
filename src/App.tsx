import { useEffect, useMemo, useRef } from 'react';
import 'katex/dist/katex.min.css';
import { AppChrome } from './components/AppChrome';
import { AppSidebar } from './components/AppSidebar';
import { EditorSurface } from './components/EditorSurface';
import { InspectorPane } from './components/InspectorPane';
import { SettingsModal } from './components/SettingsModal';
import { WeaverConfirmDialog } from './components/WeaverConfirmDialog';
import { projectCards, selectDefaultWeaveCardUid, selectFocusedCard } from './lib/cardProjection';
import { formatCardRestoreStatus } from './lib/crashpadStatus';
import { DEFAULT_DRAFT_CONTENT, DEFAULT_DRAFT_PATH } from './lib/draftDefaults';
import { computeLayoutStyle } from './lib/layout';
import { useCardDetailState } from './hooks/useCardDetailState';
import { useCrashpadActions } from './hooks/useCrashpadActions';
import { useCrashpadCardMutationActions } from './hooks/useCrashpadCardMutationActions';
import { useCrashpadHistoryActions } from './hooks/useCrashpadHistoryActions';
import { useDailyCrashpadActions } from './hooks/useDailyCrashpadActions';
import { useEditorDocumentActions } from './hooks/useEditorDocumentActions';
import {
  DEFAULT_MARKDOWN_TAB_VIEW_STATE,
  useEditorTabViewState,
} from './hooks/useEditorTabViewState';
import { useAppUiInteractions } from './hooks/useAppUiInteractions';
import { useCardRenameActions } from './hooks/useCardRenameActions';
import { useNoteSaveActions } from './hooks/useNoteSaveActions';
import { useSidebarActions } from './hooks/useSidebarActions';
import { useVaultCatalogActions } from './hooks/useVaultCatalogActions';
import { useVaultLoadActions } from './hooks/useVaultLoadActions';
import { useVaultLifecycleActions } from './hooks/useVaultLifecycleActions';
import { useEditorTabs } from './hooks/useEditorTabs';
import { usePaneLayout } from './hooks/usePaneLayout';
import { useReviewSession } from './hooks/useReviewSession';
import { useWeaverController } from './hooks/useWeaverController';

// ── Shared state contexts (replaces 47 local useState calls) ─────────────────
import { useVaultState } from './state/VaultContext';
import { useEditorState } from './state/EditorContext';
import { useUIState } from './state/UIContext';

export default function App() {
  // ── Consume shared state from contexts (replaces 47 useState calls) ──────

  const {
    vaultPath,
    vault,
    vaultAlias,
    allCards,
    activeCrashpad,
    crashpadDeletePreferences,
    setVaultPath,
    setVault,
    setVaultAlias,
    setAllCards,
    setInternalDirectories,
    setCrashpadSummaries,
    setActiveCrashpad,
    setCrashpadDeletePreferences,
  } = useVaultState();

  const {
    activeEditorKind,
    activeCardFilePath,
    activeCardFileUid,
    selectedExplorerPath,
    selectedNotePath,
    draftPath,
    draftContent,
    savedContent,
    activeNote,
    viewMode,
    cardScope,
    isPicking,
    isSaving,
    isRefreshingIndex,
    statusMessage,
    errorMessage,
    editorFontSize,
    setActiveEditorKind,
    setActiveCardFilePath,
    setActiveCardFileUid,
    setSelectedExplorerPath,
    setSelectedNotePath,
    setDraftPath,
    setDraftContent,
    setSavedContent,
    setActiveNote,
    setViewMode,
    setCardScope,
    setIsPicking,
    setIsReading,
    setIsSaving,
    setIsRefreshingIndex,
    setStatusMessage,
    setErrorMessage,
    setEditorFontSize,
    clearEditorState,
  } = useEditorState();

  const {
    isSidebarVisible,
    isInspectorVisible,
    isSettingsOpen,
    openFirstNoteOnVaultOpen,
    showHiddenEntries,
    activeWidgetTool,
    focusedCardUid,
    focusedWindow,
    crashpadPast,
    crashpadFuture,
    setExpandedFolders,
    setActiveSidebarTab,
    setIsSidebarVisible,
    setIsSettingsOpen,
    setOpenFirstNoteOnVaultOpen,
    setShowHiddenEntries,
    setFocusedCardUid,
    setFocusedWindow,
    setActiveWidgetTool,
    setCrashpadPast,
    setCrashpadFuture,
    pushCrashpadHistory,
  } = useUIState();

  // ── Refs (component-local, not shared state) ──────────────────────────────

  const layoutRef = useRef<HTMLElement | null>(null);
  const editorPaneRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isMarkdownEditorRef = useRef(false);
  const isSavingRef = useRef(false);
  const isSettingsOpenRef = useRef(false);
  const vaultPathRef = useRef<string | null>(null);
  const saveCurrentNoteRef = useRef<() => Promise<void>>(async () => {});

  // ── Derived editors & tabs ────────────────────────────────────────────────

  const {
    displayTabs,
    dragTargetTabPath,
    setOpenTabs,
    rememberOpenTab,
    replaceOpenTabPath,
    handleTabDragStart,
    handleTabDragOver,
    handleTabDrop,
    handleTabDragEnd,
  } = useEditorTabs();

  const hasUnsavedChanges =
    activeEditorKind === 'markdown' &&
    (draftContent !== savedContent || draftPath !== (activeNote?.filePath ?? DEFAULT_DRAFT_PATH));
  const currentMarkdownEditorPath = draftPath || activeNote?.filePath || DEFAULT_DRAFT_PATH;
  const currentEditorPath =
    activeEditorKind === 'crashpad'
      ? (activeCrashpad?.filePath ?? '')
      : activeEditorKind === 'card'
        ? activeCardFilePath
        : currentMarkdownEditorPath;
  const currentTabPath =
    activeEditorKind === 'markdown'
      ? selectedNotePath || activeNote?.filePath || currentMarkdownEditorPath
      : currentEditorPath;
  const isMarkdownEditor = activeEditorKind === 'markdown';
  const isCrashpadEditor = activeEditorKind === 'crashpad' && Boolean(activeCrashpad);
  const isCardEditor = activeEditorKind === 'card' && Boolean(activeCardFileUid);
  const cardDetailStorageKey = isCrashpadEditor ? null : currentTabPath;
  const {
    activeCardDetailTab,
    focusedCardElement,
    revealedQaAnswers,
    cardDetailPanelRef,
    handleCardDetailScroll,
    setCardFocusElement,
    switchCardDetailTab,
    toggleQaAnswer,
    renameStoredState: renameCardDetailState,
    resetStoredState: resetCardDetailState,
  } = useCardDetailState(cardDetailStorageKey, focusedCardUid, setFocusedWindow);
  const {
    markdownTabViewStates,
    focusedCardUidByTab,
    updateMarkdownTabViewState,
    updateCrashpadTabViewState,
    moveStoredTabState,
    resetStoredTabState,
    activeCrashpadViewState,
    activeMarkdownViewState,
  } = useEditorTabViewState({
    currentTabPath,
    isMarkdownEditor,
    isCrashpadEditor,
    viewMode,
    cardScope,
    focusedCardUid,
    replaceOpenTabPath,
    renameCardDetailState,
  });
  const { visibleCards, crashpadCards } = useMemo(
    () =>
      projectCards({
        activeNote,
        allCards,
        cardStorePath: vault?.cardStore?.cardStorePath,
        selectedNotePath,
        activeCrashpad,
        activeCardFileUid,
        cardScope,
        isCrashpadEditor,
        isCardEditor,
      }),
    [
      activeNote,
      allCards,
      vault?.cardStore?.cardStorePath,
      selectedNotePath,
      activeCrashpad,
      activeCardFileUid,
      cardScope,
      isCrashpadEditor,
      isCardEditor,
    ],
  );
  const focusedCard = selectFocusedCard(visibleCards, focusedCardUid);
  const crashpadWeaveCardUid = selectDefaultWeaveCardUid(crashpadCards, focusedCardUid);
  const isCardsSurfaceActive =
    isCrashpadEditor || isCardEditor || (isMarkdownEditor && viewMode === 'cards');

  isMarkdownEditorRef.current = isMarkdownEditor;
  isSavingRef.current = isSaving;
  isSettingsOpenRef.current = isSettingsOpen;
  vaultPathRef.current = vaultPath;

  const { sidebarWidth, inspectorWidth, activeResizer, handleResizeStart } = usePaneLayout({
    layoutRef,
    editorPaneRef,
    isSidebarVisible,
    isInspectorVisible,
    isCardsSurfaceActive,
    focusedCardUid,
    activeEditorPath: currentEditorPath,
    statusMessage,
    errorMessage,
    visibleCardsLength: visibleCards.length,
  });

  useEffect(() => {
    if (!visibleCards.length) {
      setFocusedCardUid(null);
      return;
    }

    if (!focusedCardUid || !visibleCards.some((card) => card.uid === focusedCardUid)) {
      setFocusedCardUid(visibleCards[0].uid);
    }
  }, [focusedCardUid, setFocusedCardUid, visibleCards]);

  const { refreshCardsCatalog, refreshInternalDirectories } = useVaultCatalogActions({
    setAllCards,
    setInternalDirectories,
  });

  const {
    refreshCrashpadCatalog,
    persistCrashpad,
    openCrashpadInEditor,
    handleUpdateCrashpadDeletePreferences,
    handleCrashpadActivePanelChange,
    handleCrashpadEditorModeChange,
    handleCrashpadPreviewTabChange,
    handleCrashpadPreviewQaToggle,
    handleCrashpadScrollTopChange,
  } = useCrashpadActions({
    vaultPath,
    activeCrashpad,
    currentTabPath,
    focusedCardUidByTab,
    updateCrashpadTabViewState,
    rememberOpenTab,
    refreshInternalDirectories,
    setCrashpadSummaries,
    setCrashpadDeletePreferences,
    setActiveCrashpad,
    setActiveEditorKind,
    setActiveCardFilePath,
    setActiveCardFileUid,
    setSelectedExplorerPath,
    setFocusedCardUid,
    resetCrashpadHistory: () => {
      setCrashpadPast([]);
      setCrashpadFuture([]);
    },
    setStatusMessage,
    setErrorMessage,
  });

  const { applyCardRenameResult } = useCardRenameActions({
    activeCrashpadId: activeCrashpad?.id ?? null,
    selectedExplorerPath,
    activeCardFileUid,
    activeNoteFilePath: activeNote?.filePath ?? null,
    refreshCardsCatalog,
    refreshCrashpadCatalog,
    moveStoredTabState,
    setVault,
    setSelectedExplorerPath,
    setActiveCardFileUid,
    setActiveCardFilePath,
    setActiveNote,
    setFocusedCardUid,
  });

  const {
    handleAttachExistingCardToCrashpad,
    handleCreateCardFromCrashpad,
    handleSaveCrashpadCard,
    handleDeleteFocusedCrashpadCard,
    restoreCrashpadSnapshot,
    handleRestoreDeletedCard,
  } = useCrashpadCardMutationActions({
    vaultPath,
    activeCrashpad,
    focusedCardUid,
    focusedCard,
    allCards,
    crashpadDeletePreferences,
    persistCrashpad,
    refreshCardsCatalog,
    refreshInternalDirectories,
    applyCardRenameResult,
    pushCrashpadHistory,
    setFocusedCardUid,
    setStatusMessage,
    setErrorMessage,
    formatCardRestoreStatus,
  });

  const { handleUndoCrashpadAction, handleRedoCrashpadAction } = useCrashpadHistoryActions({
    vaultPath,
    activeCrashpad,
    crashpadPast,
    crashpadFuture,
    persistCrashpad,
    refreshCardsCatalog,
    applyCardRenameResult,
    restoreCrashpadSnapshot,
    setFocusedCardUid,
    setCrashpadPast,
    setCrashpadFuture,
    setStatusMessage,
    setErrorMessage,
  });

  const {
    canSwitchEditors,
    openNoteInEditor,
    handleOpenExplorerFile,
    handleOpenNote,
    handleActivateTab,
    handleCloseTab,
  } = useEditorDocumentActions({
    vaultPath,
    isMarkdownEditor,
    hasUnsavedChanges,
    currentEditorPath,
    selectedNotePath,
    focusedCardUidByTab,
    allCards,
    displayTabs,
    setOpenTabs,
    setIsReading,
    setStatusMessage,
    setErrorMessage,
    setActiveNote,
    setActiveEditorKind,
    setActiveCrashpad,
    setActiveCardFilePath,
    setActiveCardFileUid,
    setSelectedNotePath,
    setSelectedExplorerPath,
    setDraftPath,
    setDraftContent,
    setSavedContent,
    setViewMode,
    setCardScope,
    setFocusedCardUid,
    setFocusedWindow,
    rememberOpenTab,
    clearEditorState,
    openCrashpadInEditor,
    getMarkdownTabState: (filePath, restoreStoredState) => {
      if (!restoreStoredState) {
        return DEFAULT_MARKDOWN_TAB_VIEW_STATE;
      }

      return markdownTabViewStates[filePath] ?? DEFAULT_MARKDOWN_TAB_VIEW_STATE;
    },
  });

  const { loadVault } = useVaultLoadActions({
    openFirstNoteOnVaultOpen,
    defaultDraftPath: DEFAULT_DRAFT_PATH,
    defaultDraftContent: DEFAULT_DRAFT_CONTENT,
    defaultMarkdownTabViewState: DEFAULT_MARKDOWN_TAB_VIEW_STATE,
    refreshCardsCatalog,
    refreshInternalDirectories,
    refreshCrashpadCatalog,
    openNoteInEditor,
    setVaultPath,
    setVault,
    setExpandedFolders,
    setOpenTabs,
    resetStoredTabState,
    resetCardDetailState,
    setCrashpadPast,
    setCrashpadFuture,
    setActiveEditorKind,
    setActiveNote,
    setActiveCrashpad,
    setActiveCardFilePath,
    setActiveCardFileUid,
    setSelectedExplorerPath,
    setSelectedNotePath,
    setDraftPath,
    setDraftContent,
    setSavedContent,
    setViewMode,
    setCardScope,
    setFocusedCardUid,
  });

  const {
    handleSelectVault,
    handleSelectCardStore,
    handleSelectImageDirectories,
    handleResetImageDirectories,
    handleRefreshIndex,
  } = useVaultLifecycleActions({
    vaultPath,
    activeCrashpadId: activeCrashpad?.id ?? null,
    isMarkdownEditor,
    selectedNotePath,
    setVault,
    setStatusMessage,
    setErrorMessage,
    setIsPicking,
    setIsRefreshingIndex,
    loadVault,
    refreshCardsCatalog,
    refreshInternalDirectories,
    refreshCrashpadCatalog,
    openNoteInEditor,
  });

  const { handleToggleFolder } = useSidebarActions({
    setExpandedFolders,
  });

  const { saveCurrentNote, handleSaveNote, handleDiscard } = useNoteSaveActions({
    isMarkdownEditor,
    vaultPath,
    currentTabPath,
    draftPath,
    draftContent,
    savedContent,
    activeNoteFilePath: activeNote?.filePath ?? null,
    setIsSaving,
    setErrorMessage,
    setStatusMessage,
    setVault,
    setActiveNote,
    setSelectedNotePath,
    setSelectedExplorerPath,
    setDraftPath,
    setDraftContent,
    setSavedContent,
    moveStoredTabState,
    refreshCardsCatalog,
  });
  saveCurrentNoteRef.current = saveCurrentNote;

  const { openSettings, handleToggleExplorerPane } = useAppUiInteractions({
    isSettingsOpenRef,
    isSavingRef,
    isMarkdownEditorRef,
    vaultPathRef,
    saveCurrentNoteRef,
    setIsSettingsOpen,
    setIsSidebarVisible,
    setActiveSidebarTab,
    setActiveWidgetTool,
    focusSettings: () => setFocusedWindow('settings'),
    focusExplorer: () => setFocusedWindow('explorer'),
  });

  const { handleOpenDailyCrashpad } = useDailyCrashpadActions({
    vaultPath,
    canSwitchEditors,
    refreshInternalDirectories,
    refreshCrashpadCatalog,
    openCrashpadInEditor,
    setIsReading,
    setActiveWidgetTool,
    setFocusedWindow,
    setStatusMessage,
    setErrorMessage,
  });

  const weaver = useWeaverController({
    isCrashpadEditor,
    crashpadWeaveCardUid,
    editorTextareaRef: textareaRef,
    refreshCardsCatalog,
    refreshInternalDirectories,
    refreshCrashpadCatalog,
  });

  const review = useReviewSession({
    vaultPath,
    allCards,
    activeEditorKind,
    activeWidgetTool,
    setAllCards,
    setActiveEditorKind,
    setActiveWidgetTool,
    setStatusMessage,
    setErrorMessage,
  });

  const handleOpenReview = () => {
    if (hasUnsavedChanges) {
      setStatusMessage('Save or discard current changes before starting a review.');
      return;
    }

    review.startReview();
  };

  // ── External vault change subscription (chokidar → renderer) ───────────

  useEffect(() => {
    if (!vaultPath) return;

    const refreshFromExternalChange = async () => {
      try {
        const refreshedVault = await window.crashWeaver.updateIndex(vaultPath);
        setVault(refreshedVault);
        await refreshCardsCatalog(vaultPath);
        await refreshInternalDirectories(vaultPath);
        await refreshCrashpadCatalog(vaultPath, activeCrashpad?.id ?? null);
      } catch {
        // Silently ignore — the next manual refresh will catch up
      }
    };

    // The subscription delivers changes synchronously and ignores what the
    // callback returns, so the refresh runs detached on purpose.
    const unsubscribe = window.crashWeaver.onVaultExternalChange(() => {
      void refreshFromExternalChange();
    });

    return unsubscribe;
  }, [
    vaultPath,
    setVault,
    refreshCardsCatalog,
    refreshInternalDirectories,
    refreshCrashpadCatalog,
    activeCrashpad,
  ]);

  const layoutStyle = computeLayoutStyle({
    isSidebarVisible,
    sidebarWidth,
    isInspectorVisible,
    inspectorWidth,
    editorFontSize,
  });

  return (
    <AppChrome
      layoutRef={layoutRef}
      layoutStyle={layoutStyle}
      onOpenSettings={openSettings}
      onToggleExplorerPane={handleToggleExplorerPane}
      onOpenDailyCrashpad={() => void handleOpenDailyCrashpad()}
      onOpenReview={handleOpenReview}
      overlays={
        <>
          {weaver.pendingDestructiveOps ? (
            <WeaverConfirmDialog
              destructiveOps={weaver.pendingDestructiveOps}
              onConfirm={weaver.confirmPendingOperations}
              onCancel={weaver.cancelPendingOperations}
            />
          ) : null}

          <SettingsModal
            activeNote={activeNote}
            editorFontSize={editorFontSize}
            isOpen={isSettingsOpen}
            isPicking={isPicking}
            isRefreshingIndex={isRefreshingIndex}
            openFirstNoteOnVaultOpen={openFirstNoteOnVaultOpen}
            showHiddenEntries={showHiddenEntries}
            vault={vault}
            vaultAlias={vaultAlias}
            vaultPath={vaultPath}
            onClose={() => setIsSettingsOpen(false)}
            onEditorFontSizeChange={setEditorFontSize}
            onOpenFirstNoteOnVaultOpenChange={setOpenFirstNoteOnVaultOpen}
            onSelectCardStore={handleSelectCardStore}
            onSelectImageDirectories={handleSelectImageDirectories}
            onSelectVault={handleSelectVault}
            onRefreshIndex={handleRefreshIndex}
            onResetImageDirectories={handleResetImageDirectories}
            onShowHiddenEntriesChange={setShowHiddenEntries}
            onVaultAliasChange={setVaultAlias}
            crashpadDeletePreferences={crashpadDeletePreferences}
            onSetDeletePreferences={handleUpdateCrashpadDeletePreferences}
            {...weaver.settingsProps}
          />
        </>
      }
    >
      <AppSidebar
        onToggleFolder={handleToggleFolder}
        onSelectFile={(filePath, fileKind) => {
          void handleOpenExplorerFile(filePath, fileKind);
        }}
      />

      <div
        className={`splitter splitterLeft ${activeResizer === 'left' ? 'active' : ''} ${isSidebarVisible ? '' : 'paneHidden'}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize explorer pane"
        onMouseDown={(event) => handleResizeStart(event, 'left')}
      />

      <EditorSurface
        editorPaneRef={editorPaneRef}
        textareaRef={textareaRef}
        isMarkdownEditor={isMarkdownEditor}
        isCrashpadEditor={isCrashpadEditor}
        isCardEditor={isCardEditor}
        isReviewEditor={activeEditorKind === 'review' && review.isActive}
        visibleCards={visibleCards}
        focusedCard={focusedCard}
        review={review}
        tabs={{
          displayTabs,
          currentEditorPath,
          currentTabPath,
          hasUnsavedChanges,
          dragTargetTabPath,
          onTabDragStart: handleTabDragStart,
          onTabDragOver: handleTabDragOver,
          onTabDrop: handleTabDrop,
          onTabDragEnd: handleTabDragEnd,
          onActivateTab: handleActivateTab,
          onCloseTab: handleCloseTab,
        }}
        noteSave={{
          saveCurrentNote,
          onSaveNote: handleSaveNote,
          onDiscard: handleDiscard,
        }}
        cardDetail={{
          activeCardDetailTab,
          cardDetailPanelRef,
          focusedCardElement,
          revealedQaAnswers,
          onCardDetailScroll: handleCardDetailScroll,
          onSetCardFocusElement: setCardFocusElement,
          onSwitchCardDetailTab: switchCardDetailTab,
          onToggleQaAnswer: toggleQaAnswer,
        }}
        crashpad={{
          activeCrashpadViewState,
          onActivePanelChange: handleCrashpadActivePanelChange,
          onAttachExistingCard: handleAttachExistingCardToCrashpad,
          onCreateNewCard: handleCreateCardFromCrashpad,
          onDeleteFocusedCard: handleDeleteFocusedCrashpadCard,
          onEditorModeChange: handleCrashpadEditorModeChange,
          onPreviewTabChange: handleCrashpadPreviewTabChange,
          onRedo: handleRedoCrashpadAction,
          onRestoreDeletedCard: handleRestoreDeletedCard,
          onSaveFocusedCard: handleSaveCrashpadCard,
          onScrollTopChange: handleCrashpadScrollTopChange,
          onTogglePreviewQa: handleCrashpadPreviewQaToggle,
          onUndo: handleUndoCrashpadAction,
        }}
        activeMarkdownViewState={activeMarkdownViewState}
        onMarkdownTabViewStateChange={updateMarkdownTabViewState}
        onOpenNote={handleOpenNote}
        onOpenVault={() => void handleSelectVault()}
        onOpenSettings={openSettings}
      />

      <div
        className={`splitter splitterRight ${activeResizer === 'right' ? 'active' : ''} ${isInspectorVisible ? '' : 'paneHidden'}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize properties pane"
        onMouseDown={(event) => handleResizeStart(event, 'right')}
      />

      <InspectorPane
        activeCrashpad={activeCrashpad}
        activeNote={activeNote}
        focusedCard={focusedCard}
        focusedCardElement={focusedCardElement}
        focusedWindow={focusedWindow}
        isCardsView={isCardsSurfaceActive}
        isCrashpadEditor={isCrashpadEditor}
        isVisible={isInspectorVisible}
        vault={vault}
        onSetFocusedWindow={setFocusedWindow}
        {...weaver.inspectorProps}
      />
    </AppChrome>
  );
}

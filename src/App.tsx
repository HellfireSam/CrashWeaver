import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import 'katex/dist/katex.min.css';
import type {
  CardDocument,
  VaultDescriptor,
  VaultNoteDocument,
  WeaveApplyResult,
  WeaveKind,
  WeavePlanOperation,
  WeavePlanResult,
  WeaveProviderHealth,
  WeaverSettings,
  WeaveStrength,
} from '../electron/vault-contract';
import { CardsWorkspace } from './components/CardsWorkspace';
import { CrashpadWorkspace } from './components/CrashpadWorkspace';
import { AppSidebar } from './components/AppSidebar';
import { InspectorPane } from './components/InspectorPane';
import type { WeaverSessionSummary, WeaverSessionDetail } from './components/WeaverSessionHistory';
import { WeaverConfirmDialog, isDestructiveOperation } from './components/WeaverConfirmDialog';
import { SettingsModal } from './components/SettingsModal';
import {
  type CardScope,
  type CardViewRecord,
  type FocusWindow,
  formatCardRebuildSummary,
  getFileName,
  sortCardViewRecords,
  toCardViewRecordFromCard,
  toCardViewRecordFromParsedCard,
} from './lib/cards';
import { formatCardRestoreStatus } from './lib/crashpadStatus';
import { renderMarkdownPreview } from './lib/markdownPreview';
import { useCardDetailState } from './hooks/useCardDetailState';
import { useCrashpadActions } from './hooks/useCrashpadActions';
import { useCrashpadCardMutationActions } from './hooks/useCrashpadCardMutationActions';
import { useCrashpadHistoryActions } from './hooks/useCrashpadHistoryActions';
import { useDailyCrashpadActions } from './hooks/useDailyCrashpadActions';
import { useEditorDocumentActions } from './hooks/useEditorDocumentActions';
import {
  DEFAULT_CRASHPAD_TAB_VIEW_STATE,
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
import { useStoredScrollSync } from './hooks/useStoredScrollSync';

// ── Shared state contexts (replaces 47 local useState calls) ─────────────────
import { useVaultState } from './state/VaultContext';
import { useEditorState } from './state/EditorContext';
import type { EditorDocumentKind, MarkdownViewMode } from './state/EditorContext';
import { useWeaverState } from './state/WeaverContext';
import { useUIState } from './state/UIContext';
import type { WidgetTool } from './state/UIContext';

// ── Constants / helpers that don't belong in state ───────────────────────────

const DEFAULT_DRAFT_PATH = 'Inbox/Stage-2-scratch.md';
const DEFAULT_DRAFT_CONTENT = [
  '# Stage 2 Scratch Note',
  '',
  'CrashWeaver vault write validation note.',
  '',
  '#stage2 #vault',
].join('\n');

function getDefaultWeaveCardUid(cards: CardViewRecord[], focusedUid: string | null) {
  if (focusedUid && cards.some((card) => card.uid === focusedUid)) {
    return focusedUid;
  }

  return cards[0]?.uid ?? null;
}

function getSelectedTextareaText(element: HTMLTextAreaElement | null) {
  if (!element) {
    return undefined;
  }

  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? 0;

  if (end <= start) {
    return undefined;
  }

  const selectedText = element.value.slice(start, end);
  return selectedText.trim() ? selectedText : undefined;
}

export default function App() {
  // ── Consume shared state from contexts (replaces 47 useState calls) ──────

  const {
    vaultPath, vault, vaultAlias,
    allCards, internalDirectories,
    crashpadSummaries, activeCrashpad, crashpadDeletePreferences,
    setVaultPath, setVault, setVaultAlias,
    setAllCards, setInternalDirectories,
    setCrashpadSummaries, setActiveCrashpad, setCrashpadDeletePreferences,
  } = useVaultState();

  const {
    activeEditorKind, activeCardFilePath, activeCardFileUid,
    selectedExplorerPath, selectedNotePath,
    draftPath, draftContent, savedContent,
    activeNote, viewMode, cardScope,
    isPicking, isReading, isSaving, isRefreshingIndex,
    statusMessage, errorMessage, editorFontSize,
    setActiveEditorKind, setActiveCardFilePath, setActiveCardFileUid,
    setSelectedExplorerPath, setSelectedNotePath,
    setDraftPath, setDraftContent, setSavedContent,
    setActiveNote, setViewMode, setCardScope,
    setIsPicking, setIsReading, setIsSaving, setIsRefreshingIndex,
    setStatusMessage, setErrorMessage, setEditorFontSize,
    clearEditorState,
  } = useEditorState();

  const {
    weaveModel, weaveKind, weaveEditContent, weaveCreateNote,
    weaveStrength, weaveIntent,
    weavePlanResult, weaveProviderHealth,
    isCheckingWeaveProvider, isGeneratingWeavePlan,
    weaveEvaluatingCardUid,
    weaverSettings, weaveSessions, weaveActiveSessionId,
    weaveApplyResult, isApplyingWeavePlan, weaveApplyError,
    setWeaveModel, setWeaveKind, setWeaveEditContent, setWeaveCreateNote,
    setWeaveStrength, setWeaveIntent,
    setWeavePlanResult, setWeaveProviderHealth,
    setIsCheckingWeaveProvider, setIsGeneratingWeavePlan,
    setWeaveEvaluatingCardUid,
    setWeaverSettings, setWeaveSessions, setWeaveActiveSessionId,
    setWeaveApplyResult, setIsApplyingWeavePlan, setWeaveApplyError,
  } = useWeaverState();

  const {
    expandedFolders, activeSidebarTab,
    isSidebarVisible, isInspectorVisible, isSettingsOpen,
    openFirstNoteOnVaultOpen, showHiddenEntries,
    focusedCardUid, focusedWindow, activeWidgetTool,
    crashpadPast, crashpadFuture,
    setExpandedFolders, setActiveSidebarTab,
    setIsSidebarVisible, setIsInspectorVisible, setIsSettingsOpen,
    setOpenFirstNoteOnVaultOpen, setShowHiddenEntries,
    setFocusedCardUid, setFocusedWindow, setActiveWidgetTool,
    setCrashpadPast, setCrashpadFuture,
    pushCrashpadHistory,
  } = useUIState();

  // ── Confirm dialog state (Stage 6) ────────────────────────────────────────

  const [pendingDestructiveOps, setPendingDestructiveOps] = useState<WeavePlanOperation[] | null>(null);
  const pendingApplyOpsRef = useRef<WeavePlanOperation[]>([]);

  // ── Refs (component-local, not shared state) ──────────────────────────────

  const layoutRef = useRef<HTMLElement | null>(null);
  const editorPaneRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownPreviewRef = useRef<HTMLDivElement | null>(null);
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
    activeEditorKind === 'markdown' && (draftContent !== savedContent || draftPath !== (activeNote?.filePath ?? DEFAULT_DRAFT_PATH));
  const currentMarkdownEditorPath = draftPath || activeNote?.filePath || DEFAULT_DRAFT_PATH;
  const currentEditorPath =
    activeEditorKind === 'crashpad'
      ? activeCrashpad?.filePath ?? ''
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
    crashpadTabViewStates,
    focusedCardUidByTab,
    setMarkdownTabViewStates,
    setCrashpadTabViewStates,
    setFocusedCardUidByTab,
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
  const currentNoteCards = useMemo(
    () => sortCardViewRecords((activeNote?.parsedCards ?? []).map((card) => toCardViewRecordFromParsedCard(card, activeNote?.filePath ?? draftPath))),
    [activeNote, draftPath],
  );
  const currentVaultCards = useMemo(
    () => sortCardViewRecords(allCards.map((card) => toCardViewRecordFromCard(card, vault?.cardStore?.cardStorePath, selectedNotePath || null))),
    [allCards, selectedNotePath, vault?.cardStore?.cardStorePath],
  );
  const cardFileCards = useMemo(() => {
    if (!activeCardFileUid) {
      return [];
    }

    return currentVaultCards.filter((card) => card.uid === activeCardFileUid);
  }, [activeCardFileUid, currentVaultCards]);
  const crashpadCards = useMemo(() => {
    if (!activeCrashpad) {
      return [];
    }

    const cardByUid = new Map(allCards.map((card) => [card.uid, card]));

    return sortCardViewRecords(
      activeCrashpad.cards
        .map((entry) => {
          const card = cardByUid.get(entry.uid);

          if (!card) {
            return null;
          }

          return toCardViewRecordFromCard(
            card,
            vault?.cardStore?.cardStorePath,
            selectedNotePath || null,
            'crashpad',
            entry.origin,
          );
        })
        .filter((card): card is ReturnType<typeof toCardViewRecordFromCard> => card !== null),
    );
  }, [activeCrashpad, allCards, selectedNotePath, vault?.cardStore?.cardStorePath]);
  const visibleCards = useMemo(() => {
    if (isCrashpadEditor) {
      return crashpadCards;
    }

    if (isCardEditor) {
      return cardFileCards;
    }

    return cardScope === 'current-vault' ? currentVaultCards : currentNoteCards;
  }, [cardFileCards, cardScope, crashpadCards, currentNoteCards, currentVaultCards, isCardEditor, isCrashpadEditor]);
  const focusedCard = useMemo(
    () => visibleCards.find((card) => card.uid === focusedCardUid) ?? visibleCards[0] ?? null,
    [focusedCardUid, visibleCards],
  );
  const crashpadWeaveCardUid = useMemo(
    () => getDefaultWeaveCardUid(crashpadCards, focusedCardUid),
    [crashpadCards, focusedCardUid],
  );
  const isCardsSurfaceActive = isCrashpadEditor || isCardEditor || (isMarkdownEditor && viewMode === 'cards');

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

  // clearEditorState is provided by EditorContext

  useEffect(() => {
    if (!visibleCards.length) {
      setFocusedCardUid(null);
      return;
    }

    if (!focusedCardUid || !visibleCards.some((card) => card.uid === focusedCardUid)) {
      setFocusedCardUid(visibleCards[0].uid);
    }
  }, [focusedCardUid, visibleCards]);

  const { refreshCardsCatalog, refreshInternalDirectories } = useVaultCatalogActions({
    setAllCards,
    setInternalDirectories,
  });

  // pushCrashpadHistory is provided by UIContext

  const {
    refreshCrashpadCatalog,
    persistCrashpad,
    openCrashpadInEditor,
    handleOpenCrashpad,
    handleCreateCrashpad,
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

  const {
    handleUndoCrashpadAction,
    handleRedoCrashpadAction,
  } = useCrashpadHistoryActions({
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
    openEditorDocument,
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

  const { handleToggleFolder, handleOpenExtensionsPlaceholder } = useSidebarActions({
    setExpandedFolders,
    setActiveWidgetTool,
    setStatusMessage,
    setErrorMessage,
  });

  const {
    saveCurrentNote,
    handleSaveNote,
    handleDiscard,
  } = useNoteSaveActions({
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

  function handleUndo() {
    textareaRef.current?.focus();
    document.execCommand('undo');
  }

  function handleRedo() {
    textareaRef.current?.focus();
    document.execCommand('redo');
  }

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
  const layoutStyle = {
    '--widgets-width': '56px',
    '--sidebar-width': isSidebarVisible ? `${sidebarWidth}px` : '0px',
    '--left-splitter-width': isSidebarVisible ? '8px' : '0px',
    '--inspector-width': isInspectorVisible ? `${inspectorWidth}px` : '0px',
    '--right-splitter-width': isInspectorVisible ? '8px' : '0px',
    '--editor-font-size': `${editorFontSize}px`,
  } as CSSProperties;

  // Reset Weaver composer when switching crashpads (but preserve plan results
  // so the user can still accept/reject proposals after switching tabs).
  useEffect(() => {
    setWeaveIntent('');
    setWeaveKind('guided-insert');
    setWeaveEditContent(false);
    setWeaveCreateNote(false);
    setWeaveStrength('standard');
    // Only clear the plan result when the crashpad itself changes — not on
    // editor-kind switches, so the user can navigate away and come back.
    setWeavePlanResult(null);
  }, [activeCrashpad?.id]);

  // Sync preferred model from settings on first load
  useEffect(() => {
    setWeaveModel(weaverSettings?.preferredModel ?? 'openai/gpt-4o');
  }, [weaverSettings?.preferredModel]);

  const refreshWeaveProviderHealth = useCallback(async () => {
    setIsCheckingWeaveProvider(true);

    try {
      const health = await window.crashWeaver.checkWeaveProvider();
      setWeaveProviderHealth(health);
      return health;
    } catch (error) {
      setWeaveProviderHealth(null);
      throw error;
    } finally {
      setIsCheckingWeaveProvider(false);
    }
  }, []);

  const handlePrepareWeavePanel = useCallback(async () => {
    if (!vaultPath || !isCrashpadEditor || !activeCrashpad) {
      setWeaveProviderHealth(null);
      return;
    }

    try {
      await refreshWeaveProviderHealth();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to check Weaver provider health.');
    }
  }, [activeCrashpad, isCrashpadEditor, refreshWeaveProviderHealth, vaultPath]);

  const handleGenerateWeavePlan = useCallback(async () => {
    if (!vaultPath || !isCrashpadEditor || !activeCrashpad) {
      setErrorMessage('Open an active crashpad before using Weaver.');
      return;
    }

    if (!crashpadWeaveCardUid) {
      setErrorMessage('Attach or focus a crashpad card before generating a Weaver proposal.');
      return;
    }

    setIsGeneratingWeavePlan(true);
    setWeaveEvaluatingCardUid(crashpadWeaveCardUid);
    setErrorMessage(null);

    try {
      const health = await refreshWeaveProviderHealth();

      if (health && !health.ok && health.errorCategory === 'auth-error') {
        setErrorMessage('Invalid or expired OpenRouter API key. Update your key in Settings → Weaver.');
        return;
      }

      const baseRequest = {
        rootPath: vaultPath,
        preferredModel: weaveModel,
        intent: weaveIntent,
        cardUid: crashpadWeaveCardUid,
        activeNotePath: activeNote?.filePath,
        selectedText: getSelectedTextareaText(textareaRef.current),
        activeCrashpadId: activeCrashpad.id,
        activeCrashpadPath: activeCrashpad.filePath,
      };

      const result = await window.crashWeaver.generateWeavePlan(
        weaveKind === 'guided-insert'
          ? {
              ...baseRequest,
              kind: 'guided-insert',
              permissions: {
                editContent: weaveEditContent,
                createNote: weaveCreateNote,
              },
            }
          : {
              ...baseRequest,
              kind: 'intelligent',
              strength: weaveStrength,
            },
      );
      setWeavePlanResult(result);
      setStatusMessage(`Generated Weaver proposal with ${result.plan.operations.length} staged operations.`);
    } catch (error) {
      setWeavePlanResult(null);
      // Strip Electron's "Error invoking remote method '...': Error: " IPC wrapper from the message
      const raw = error instanceof Error ? error.message : 'Failed to generate Weaver proposal.';
      const ipcMatch = raw.match(/^Error invoking remote method '[^']+':\s*Error:\s*(.+)$/s);
      setErrorMessage(ipcMatch ? ipcMatch[1] : raw);
    } finally {
      setIsGeneratingWeavePlan(false);
      setWeaveEvaluatingCardUid(null);
    }
  }, [
    activeCrashpad,
    activeNote?.filePath,
    crashpadWeaveCardUid,
    isCrashpadEditor,
    refreshWeaveProviderHealth,
    setErrorMessage,
    setStatusMessage,
    vaultPath,
    weaveCreateNote,
    weaveEditContent,
    weaveKind,
    weaveIntent,
    weaveModel,
    weaveStrength,
  ]);

  // ── Stage 6: Apply operations callback ────────────────────────────────────

  const handleApplyWeaveOperations = useCallback(async (operations: WeavePlanOperation[]) => {
    if (!vaultPath) {
      setErrorMessage('No vault open.');
      return;
    }

    if (operations.length === 0) {
      setErrorMessage('No operations selected to apply.');
      return;
    }

    // Check for destructive operations
    const destructiveOps = operations.filter((op) => isDestructiveOperation(op.kind));
    if (destructiveOps.length > 0 && !pendingDestructiveOps) {
      pendingApplyOpsRef.current = operations;
      setPendingDestructiveOps(destructiveOps);
      return;
    }

    setIsApplyingWeavePlan(true);
    setWeaveApplyResult(null);
    setWeaveApplyError(null);

    try {
      const result = await window.crashWeaver.applyWeavePlan(vaultPath, operations);
      setWeaveApplyResult(result);

      if (result.allOk) {
        setStatusMessage(`Applied ${result.appliedCount} Weaver operation(s) successfully.`);
        // Refresh vault state and all catalogs to reflect changes
        if (vaultPath) {
          const updatedVault = await window.crashWeaver.updateIndex(vaultPath);
          setVault(updatedVault);
          await refreshCardsCatalog(vaultPath);
          await refreshInternalDirectories(vaultPath);
          await refreshCrashpadCatalog(vaultPath, activeCrashpad?.id ?? null);
        }
      } else {
        setErrorMessage(
          `Applied ${result.appliedCount}/${operations.length} operation(s). ${result.failedCount} failed. Check the results for details.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply Weaver operations.';
      setWeaveApplyError(message);
      setErrorMessage(message);
    } finally {
      setIsApplyingWeavePlan(false);
      setPendingDestructiveOps(null);
    }
  }, [vaultPath, pendingDestructiveOps, setIsApplyingWeavePlan, setWeaveApplyResult, setWeaveApplyError, setStatusMessage, setErrorMessage, setVault, refreshCardsCatalog, refreshInternalDirectories, refreshCrashpadCatalog, activeCrashpad]);

  useEffect(() => {
    void window.crashWeaver.getWeaverSettings().then((settings) => {
      setWeaverSettings(settings);
      if (settings.preferredModel) {
        setWeaveModel(settings.preferredModel);
      } else {
        setWeaveModel('openai/gpt-4o');
      }
    }).catch(() => undefined);
  }, []);

  // ── External vault change subscription (chokidar → renderer) ───────────

  useEffect(() => {
    if (!vaultPath) return;

    const unsubscribe = window.crashWeaver.onVaultExternalChange(async () => {
      try {
        const refreshedVault = await window.crashWeaver.updateIndex(vaultPath);
        setVault(refreshedVault);
        await refreshCardsCatalog(vaultPath);
        await refreshInternalDirectories(vaultPath);
        await refreshCrashpadCatalog(vaultPath, activeCrashpad?.id ?? null);
      } catch {
        // Silently ignore — the next manual refresh will catch up
      }
    });

    return unsubscribe;
  }, [vaultPath, setVault, refreshCardsCatalog, refreshInternalDirectories, refreshCrashpadCatalog, activeCrashpad]);

  const handleWeaveModelChange = useCallback((nextModel: string) => {
    const previousModel = weaveModel;
    setWeaveModel(nextModel);
    setErrorMessage(null);

    void window.crashWeaver.setWeaverPreferredModel(nextModel)
      .then((updated) => {
        setWeaverSettings(updated);
      })
      .catch((error) => {
        setWeaveModel(previousModel);
        setErrorMessage(error instanceof Error ? error.message : 'Failed to save Weaver preferred model.');
      });
  }, [weaveModel]);

  const handleSetWeaverApiKey = useCallback(async (key: string) => {
    await window.crashWeaver.setWeaverApiKey(key);
    const updated = await window.crashWeaver.getWeaverSettings();
    setWeaverSettings(updated);
    const health = await refreshWeaveProviderHealth().catch(() => undefined);
    if (health && !health.ok && health.errorCategory === 'auth-error') {
      setErrorMessage('API key saved, but OpenRouter rejected it as invalid or expired. Please check your key.');
    } else {
      setStatusMessage('OpenRouter API key saved. Weaver will now use the live provider.');
    }
  }, [refreshWeaveProviderHealth]);

  const handleClearWeaverApiKey = useCallback(async () => {
    await window.crashWeaver.clearWeaverApiKey();
    const updated = await window.crashWeaver.getWeaverSettings();
    setWeaverSettings(updated);
    await refreshWeaveProviderHealth().catch(() => undefined);
    setStatusMessage('OpenRouter API key removed. Weaver is using the stub provider.');
  }, [refreshWeaveProviderHealth]);

  const handleUpdateWeaverSettings = useCallback(async (updates: Partial<WeaverSettings>) => {
    const updated = await window.crashWeaver.updateWeaverSettings(updates);
    setWeaverSettings(updated);
  }, []);

  // ── Session history handlers ─────────────────────────────────────────────

  const fetchWeaverSessions = useCallback(async () => {
    try {
      const list = await window.crashWeaver.listWeaverSessions(vaultPath ?? undefined) as WeaverSessionSummary[];
      setWeaveSessions(list);
    } catch {
      // Silently fail — sessions are not critical
    }
  }, [vaultPath]);

  const handleDeleteWeaverSession = useCallback(async (sessionId: string) => {
    try {
      await window.crashWeaver.deleteWeaverSession(sessionId, vaultPath ?? undefined);
      setWeaveSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch {
      // Silently fail
    }
  }, [vaultPath]);

  const handleClearWeaverSessions = useCallback(async () => {
    try {
      await window.crashWeaver.clearWeaverSessions(vaultPath ?? undefined);
      setWeaveSessions([]);
    } catch {
      // Silently fail
    }
  }, [vaultPath]);

  const handleReRunFromHistory = useCallback((session: WeaverSessionDetail) => {
    if (!session.request) return;
    const req = session.request as Record<string, unknown>;
    if (typeof req.kind === 'string') setWeaveKind(req.kind as WeaveKind);
    if (typeof req.intent === 'string') setWeaveIntent(req.intent);
    if (typeof req.preferredModel === 'string') setWeaveModel(req.preferredModel);
    if (req.kind === 'guided-insert') {
      const perms = req.permissions as Record<string, boolean> | undefined;
      if (perms) {
        if (typeof perms.editContent === 'boolean') setWeaveEditContent(perms.editContent);
        if (typeof perms.createNote === 'boolean') setWeaveCreateNote(perms.createNote);
      }
    } else if (req.kind === 'intelligent') {
      if (typeof req.strength === 'string') setWeaveStrength(req.strength as WeaveStrength);
    }
    setStatusMessage('Re-loaded settings from session. Press Generate to re-run.');
  }, []);

  const handleNewWeaverSession = useCallback(() => {
    setWeavePlanResult(null);
    setWeaveApplyResult(null);
    setWeaveApplyError(null);
    setWeaveIntent('');
    setStatusMessage('Started a new Weaver session.');
  }, []);

  // Fetch sessions on mount and after each generation
  useEffect(() => {
    if (vaultPath) {
      void fetchWeaverSessions();
    }
  }, [vaultPath, fetchWeaverSessions]);

  // Refresh sessions after a plan completes
  useEffect(() => {
    if (!isGeneratingWeavePlan && weavePlanResult) {
      void fetchWeaverSessions();
    }
  }, [isGeneratingWeavePlan, weavePlanResult, fetchWeaverSessions]);

  return (
    <main className="appShell" style={layoutStyle}>
      <div className={`windowUtilityStrip ${isInspectorVisible ? 'inspectorAware' : ''}`}>
        <button
          className={`windowUtilityButton ${isInspectorVisible ? 'active' : ''}`}
          onClick={() => setIsInspectorVisible((current) => !current)}
          title="Toggle right panel"
        >
          ≣
        </button>
        <button className="windowUtilityButton" title="Open settings" onClick={openSettings}>
          ⚙
        </button>
      </div>

      <section
        className="layoutGrid"
        ref={layoutRef}
        style={layoutStyle}
      >
        <aside className="widgetRail">
          <button
            type="button"
            className={`widgetButton ${isSidebarVisible ? 'active' : ''}`}
            title="Toggle explorer pane"
            onClick={handleToggleExplorerPane}
          >
            ☰
          </button>
          <button
            type="button"
            className={`widgetButton ${activeWidgetTool === 'daily-crashpad' ? 'active' : ''}`}
            title="Open daily Crashpad"
            onClick={() => void handleOpenDailyCrashpad()}
            disabled={!vaultPath}
          >
            CP
          </button>
          <button
            type="button"
            className={`widgetButton ${activeWidgetTool === 'extensions' ? 'active' : ''}`}
            title="Extensions placeholder"
            onClick={handleOpenExtensionsPlaceholder}
          >
            +
          </button>
        </aside>

        <AppSidebar
          onToggleFolder={handleToggleFolder}
          onSelectFile={handleOpenExplorerFile}
        />

        <div
          className={`splitter splitterLeft ${activeResizer === 'left' ? 'active' : ''} ${isSidebarVisible ? '' : 'paneHidden'}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize explorer pane"
          onMouseDown={(event) => handleResizeStart(event, 'left')}
        />

        <section className="editorPane" ref={editorPaneRef}>
          <div className="editorCanvas">
            <div className="viewModeBar">
              <div className="editorTabsBar">
                {displayTabs.map((tabPath) => {
                  const isActiveTab = tabPath === currentEditorPath || (isMarkdownEditor && !hasUnsavedChanges && tabPath === selectedNotePath);
                  const isDirtyTab = hasUnsavedChanges && tabPath === currentEditorPath;

                  return (
                    <div
                      key={tabPath}
                      className={`editorTabShell ${isActiveTab ? 'active' : ''} ${dragTargetTabPath === tabPath ? 'dragTarget' : ''}`}
                      draggable
                      onDragStart={(event) => handleTabDragStart(event, tabPath)}
                      onDragOver={(event) => handleTabDragOver(event, tabPath)}
                      onDrop={() => handleTabDrop(tabPath)}
                      onDragEnd={handleTabDragEnd}
                    >
                      <button
                        type="button"
                        className="editorTab"
                        onClick={() => void handleActivateTab(tabPath)}
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
                          void handleCloseTab(tabPath);
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
                      <button type="button" className="editorIconButton" title="Undo (Ctrl+Z)" onClick={handleUndo}>
                        ↺
                      </button>
                      <button type="button" className="editorIconButton" title="Redo (Ctrl+Shift+Z)" onClick={handleRedo}>
                        ↻
                      </button>
                      <button
                        type="button"
                        className="editorIconButton"
                        title="Save (Ctrl+S)"
                        onClick={() => void saveCurrentNote()}
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
                      onClick={handleDiscard}
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
                activePanel={activeCrashpadViewState.activePanel}
                canRedo={crashpadFuture.length > 0}
                canUndo={crashpadPast.length > 0}
                crashpadDeletePreferences={crashpadDeletePreferences}
                editorMode={activeCrashpadViewState.editorMode}
                focusedCard={focusedCard}
                statusMessage={statusMessage}
                errorMessage={errorMessage}
                imageDirectories={vault?.imageDirectories ?? []}
                previewTab={activeCrashpadViewState.previewTab}
                revealedQa={activeCrashpadViewState.revealedQaAnswers}
                scrollTop={activeCrashpadViewState.scrollTop}
                vaultPath={vaultPath}
                visibleCards={visibleCards}
                onActivePanelChange={handleCrashpadActivePanelChange}
                onAttachExistingCard={handleAttachExistingCardToCrashpad}
                onCreateNewCard={handleCreateCardFromCrashpad}
                onDeleteFocusedCard={handleDeleteFocusedCrashpadCard}
                onEditorModeChange={handleCrashpadEditorModeChange}
                onOpenNote={handleOpenNote}
                onPreviewTabChange={handleCrashpadPreviewTabChange}
                onRedo={handleRedoCrashpadAction}
                onRestoreDeletedCard={handleRestoreDeletedCard}
                onSaveFocusedCard={handleSaveCrashpadCard}
                onSelectCard={setFocusedCardUid}
                onScrollTopChange={handleCrashpadScrollTopChange}
                onTogglePreviewQa={handleCrashpadPreviewQaToggle}
                onUndo={handleUndoCrashpadAction}
              />
            ) : isCardEditor ? (
              <CardsWorkspace
                activeCardDetailTab={activeCardDetailTab}
                activeNote={activeNote}
                cardDetailPanelRef={cardDetailPanelRef}
                cardScope="current-vault"
                focusedCard={focusedCard}
                focusedCardElement={focusedCardElement}
                focusedWindow={focusedWindow}
                imageDirectories={vault?.imageDirectories ?? []}
                revealedQaAnswers={revealedQaAnswers}
                vaultPath={vaultPath}
                visibleCards={visibleCards}
                onCardDetailScroll={handleCardDetailScroll}
                onOpenNote={handleOpenNote}
                onSelectCard={setFocusedCardUid}
                onSetCardFocusElement={setCardFocusElement}
                onSetFocusedWindow={setFocusedWindow}
                onSwitchCardDetailTab={switchCardDetailTab}
                onToggleQaAnswer={toggleQaAnswer}
              />
            ) : viewMode === 'source' ? (
              <form id="noteEditorForm" className="editorForm" onSubmit={handleSaveNote}>
                <textarea
                  id="draftContent"
                  ref={textareaRef}
                  className="editorTextArea"
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  onScroll={(event) => {
                    markSourceLocallyScrolling();

                    if (currentTabPath) {
                      updateMarkdownTabViewState(currentTabPath, { sourceScrollTop: event.currentTarget.scrollTop });
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
                    updateMarkdownTabViewState(currentTabPath, { previewScrollTop: event.currentTarget.scrollTop });
                  }
                }}
                // Preview HTML is built from the user's own vault content.
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            ) : (
              <CardsWorkspace
                activeCardDetailTab={activeCardDetailTab}
                activeNote={activeNote}
                cardDetailPanelRef={cardDetailPanelRef}
                cardScope={cardScope}
                focusedCard={focusedCard}
                focusedCardElement={focusedCardElement}
                focusedWindow={focusedWindow}
                imageDirectories={vault?.imageDirectories ?? []}
                revealedQaAnswers={revealedQaAnswers}
                vaultPath={vaultPath}
                visibleCards={visibleCards}
                onCardDetailScroll={handleCardDetailScroll}
                onOpenNote={handleOpenNote}
                onSelectCard={setFocusedCardUid}
                onSetCardFocusElement={setCardFocusElement}
                onSetFocusedWindow={setFocusedWindow}
                onSwitchCardDetailTab={switchCardDetailTab}
                onToggleQaAnswer={toggleQaAnswer}
              />
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
          isCheckingWeaveProvider={isCheckingWeaveProvider}
          isGeneratingWeavePlan={isGeneratingWeavePlan}
          isVisible={isInspectorVisible}
          vault={vault}
          weaveCardUid={crashpadWeaveCardUid}
          weaveEvaluatingCardUid={weaveEvaluatingCardUid}
          weaveIntent={weaveIntent}
          weaveModel={weaveModel}
          weaveKind={weaveKind}
          weaveEditContent={weaveEditContent}
          weaveCreateNote={weaveCreateNote}
          weavePlanResult={weavePlanResult}
          weaveProviderHealth={weaveProviderHealth}
          weaveStrength={weaveStrength}
          weaveSessions={weaveSessions}
          weaveActiveSessionId={weaveActiveSessionId}
          weaveApplyResult={weaveApplyResult}
          isApplyingWeavePlan={isApplyingWeavePlan}
          onGenerateWeavePlan={handleGenerateWeavePlan}
          onPrepareWeavePanel={handlePrepareWeavePanel}
          onSetFocusedWindow={setFocusedWindow}
          onWeaveIntentChange={setWeaveIntent}
          onWeaveModelChange={handleWeaveModelChange}
          onWeaveKindChange={setWeaveKind}
          onWeaveEditContentChange={setWeaveEditContent}
          onWeaveCreateNoteChange={setWeaveCreateNote}
          onWeaveStrengthChange={setWeaveStrength}
          onWeaveApplyOperations={handleApplyWeaveOperations}
          onWeaveNewSession={handleNewWeaverSession}
          onWeaveReRunFromHistory={handleReRunFromHistory}
          onWeaveDeleteSession={handleDeleteWeaverSession}
          onWeaveClearSessions={handleClearWeaverSessions}
        />
      </section>

      {pendingDestructiveOps ? (
        <WeaverConfirmDialog
          destructiveOps={pendingDestructiveOps}
          onConfirm={() => {
            const opsToApply = pendingApplyOpsRef.current;
            setPendingDestructiveOps(null);
            handleApplyWeaveOperations(opsToApply);
          }}
          onCancel={() => {
            setPendingDestructiveOps(null);
            pendingApplyOpsRef.current = [];
          }}
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
        weaverSettings={weaverSettings}
        onSetWeaverApiKey={handleSetWeaverApiKey}
        onClearWeaverApiKey={handleClearWeaverApiKey}
        onUpdateWeaverSettings={handleUpdateWeaverSettings}
      />
    </main>
  );
}

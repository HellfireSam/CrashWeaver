import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import 'katex/dist/katex.min.css';
import type {
  CardDocument,
  CrashpadDeletePreferences,
  CrashpadDocument,
  CrashpadSummary,
  VaultDescriptor,
  VaultNoteDocument,
  WeaveKind,
  WeavePlanResult,
  WeaveProviderHealth,
  WeaverSettings,
  WeaveStrength,
} from '../electron/vault-contract';
import { CardsWorkspace } from './components/CardsWorkspace';
import { CrashpadWorkspace } from './components/CrashpadWorkspace';
import { ExplorerTree } from './components/ExplorerTree';
import { InspectorPane } from './components/InspectorPane';
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
import { buildExplorerTree, type ExplorerEntry } from './lib/explorerTree';
import type { CrashpadHistoryEntry } from './lib/crashpadHistory';
import {
  isPathInsideVault,
  normalizeRelativePath,
} from './lib/editorPaths';
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

const defaultDraftPath = 'Inbox/Stage-2-scratch.md';
const defaultWeaveModel = 'openai/gpt-4o';
const defaultDraftContent = [
  '# Stage 2 Scratch Note',
  '',
  'CrashWeaver vault write validation note.',
  '',
  '#stage2 #vault',
].join('\n');
type WidgetTool = 'explorer' | 'daily-crashpad' | 'extensions';
type EditorDocumentKind = 'markdown' | 'crashpad' | 'card';
type MarkdownViewMode = 'source' | 'preview' | 'cards';

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
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultDescriptor | null>(null);
  const [activeEditorKind, setActiveEditorKind] = useState<EditorDocumentKind>('markdown');
  const [activeCardFilePath, setActiveCardFilePath] = useState('');
  const [activeCardFileUid, setActiveCardFileUid] = useState<string | null>(null);
  const [selectedExplorerPath, setSelectedExplorerPath] = useState('');
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
  const [weaveModel, setWeaveModel] = useState(defaultWeaveModel);
  const [weaveKind, setWeaveKind] = useState<WeaveKind>('guided-insert');
  const [weaveEditContent, setWeaveEditContent] = useState(false);
  const [weaveCreateNote, setWeaveCreateNote] = useState(false);
  const [weaveStrength, setWeaveStrength] = useState<WeaveStrength>('standard');
  const [weaveIntent, setWeaveIntent] = useState('');
  const [weavePlanResult, setWeavePlanResult] = useState<WeavePlanResult | null>(null);
  const [weaveProviderHealth, setWeaveProviderHealth] = useState<WeaveProviderHealth | null>(null);
  const [isCheckingWeaveProvider, setIsCheckingWeaveProvider] = useState(false);
  const [isGeneratingWeavePlan, setIsGeneratingWeavePlan] = useState(false);
  const [weaveEvaluatingCardUid, setWeaveEvaluatingCardUid] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [activeSidebarTab, setActiveSidebarTab] = useState<'explorer' | 'search'>('explorer');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isInspectorVisible, setIsInspectorVisible] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [vaultAlias, setVaultAlias] = useState('My Vault');
  const [openFirstNoteOnVaultOpen, setOpenFirstNoteOnVaultOpen] = useState(true);
  const [showHiddenEntries, setShowHiddenEntries] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState(15);
  const [viewMode, setViewMode] = useState<MarkdownViewMode>('source');
  const [savedContent, setSavedContent] = useState(defaultDraftContent);
  const [allCards, setAllCards] = useState<CardDocument[]>([]);
  const [internalDirectories, setInternalDirectories] = useState<string[]>([]);
  const [cardScope, setCardScope] = useState<CardScope>('current-note');
  const [crashpadSummaries, setCrashpadSummaries] = useState<CrashpadSummary[]>([]);
  const [activeCrashpad, setActiveCrashpad] = useState<CrashpadDocument | null>(null);
  const [crashpadDeletePreferences, setCrashpadDeletePreferences] = useState<CrashpadDeletePreferences>({
    removeNoteBoundariesByDefault: true,
    requireConfirmationForNewCards: true,
    requireStrictConfirmationForExistingCards: true,
  });
  const [weaverSettings, setWeaverSettings] = useState<WeaverSettings | undefined>(undefined);
  const [crashpadPast, setCrashpadPast] = useState<CrashpadHistoryEntry[]>([]);
  const [crashpadFuture, setCrashpadFuture] = useState<CrashpadHistoryEntry[]>([]);
  const [focusedCardUid, setFocusedCardUid] = useState<string | null>(null);
  const [focusedWindow, setFocusedWindow] = useState<FocusWindow>('explorer');
  const [activeWidgetTool, setActiveWidgetTool] = useState<WidgetTool>('explorer');
  const layoutRef = useRef<HTMLElement | null>(null);
  const editorPaneRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownPreviewRef = useRef<HTMLDivElement | null>(null);
  const isMarkdownEditorRef = useRef(false);
  const isSavingRef = useRef(false);
  const isSettingsOpenRef = useRef(false);
  const vaultPathRef = useRef<string | null>(null);
  const saveCurrentNoteRef = useRef<() => Promise<void>>(async () => {});

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

      if (!cardStorePath || !vaultPath) {
        continue;
      }

      const relativePath = normalizeRelativePath(vaultPath, `${cardStorePath.replace(/\\/g, '/')}/${card.uid}.json`);

      if (!isPathInsideVault(relativePath)) {
        continue;
      }

      cardEntries.push({
        kind: 'file',
        path: relativePath,
        fileKind: 'card',
      });
    }
    const directoryEntries = internalDirectories.map((directoryPath) => ({
      kind: 'folder' as const,
      path: directoryPath,
    }));

    return [...directoryEntries, ...noteEntries, ...crashpadEntries, ...cardEntries];
  }, [allCards, crashpadSummaries, internalDirectories, vault, vaultPath]);
  const treeNodes = useMemo(() => buildExplorerTree(explorerItems, { showHiddenEntries }), [explorerItems, showHiddenEntries]);
  const hasUnsavedChanges =
    activeEditorKind === 'markdown' && (draftContent !== savedContent || draftPath !== (activeNote?.filePath ?? defaultDraftPath));
  const currentMarkdownEditorPath = draftPath || activeNote?.filePath || defaultDraftPath;
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

  function clearEditorState() {
    setActiveEditorKind('markdown');
    setActiveCardFilePath('');
    setActiveCardFileUid(null);
    setActiveNote(null);
    setSelectedExplorerPath('');
    setSelectedNotePath('');
    setDraftPath(defaultDraftPath);
    setDraftContent(defaultDraftContent);
    setSavedContent(defaultDraftContent);
  }

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

  function pushCrashpadHistory(entry: CrashpadHistoryEntry) {
    setCrashpadPast((previous) => [...previous, entry]);
    setCrashpadFuture([]);
  }

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
    defaultDraftPath,
    defaultDraftContent,
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

  useEffect(() => {
    setWeavePlanResult(null);
    setWeaveProviderHealth(null);
    setWeaveIntent('');
    setWeaveModel(weaverSettings?.preferredModel ?? defaultWeaveModel);
    setWeaveKind('guided-insert');
    setWeaveEditContent(false);
    setWeaveCreateNote(false);
    setWeaveStrength('standard');
  }, [activeCrashpad?.id, activeEditorKind, weaverSettings?.preferredModel]);

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

  useEffect(() => {
    void window.crashWeaver.getWeaverSettings().then((settings) => {
      setWeaverSettings(settings);
      if (settings.preferredModel) {
        setWeaveModel(settings.preferredModel);
      } else {
        setWeaveModel(defaultWeaveModel);
      }
    }).catch(() => undefined);
  }, []);

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
                  onToggleFolder={handleToggleFolder}
                  onSelectFile={handleOpenExplorerFile}
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
          )}
        </aside>

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
          onGenerateWeavePlan={handleGenerateWeavePlan}
          onPrepareWeavePanel={handlePrepareWeavePanel}
          onSetFocusedWindow={setFocusedWindow}
          onWeaveIntentChange={setWeaveIntent}
          onWeaveModelChange={handleWeaveModelChange}
          onWeaveKindChange={setWeaveKind}
          onWeaveEditContentChange={setWeaveEditContent}
          onWeaveCreateNoteChange={setWeaveCreateNote}
          onWeaveStrengthChange={setWeaveStrength}
        />
      </section>

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
      />
    </main>
  );
}

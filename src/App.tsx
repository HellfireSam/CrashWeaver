import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import 'katex/dist/katex.min.css';
import type {
  CardDeleteResult,
  CardDocument,
  CardRenameResult,
  CardRestoreMode,
  CardRestoreResult,
  CrashpadDeletePreferences,
  CrashpadDeletedCardSnapshot,
  CrashpadDocument,
  CrashpadSummary,
  VaultDescriptor,
  VaultNoteDocument,
} from '../electron/vault-contract';
import { CardsWorkspace } from './components/CardsWorkspace';
import { CrashpadWorkspace } from './components/CrashpadWorkspace';
import { ExplorerTree } from './components/ExplorerTree';
import { InspectorPane } from './components/InspectorPane';
import { SettingsModal } from './components/SettingsModal';
import {
  type CardDetailTab,
  type CardScope,
  type CardViewRecord,
  type FocusWindow,
  formatCardRebuildSummary,
  formatCardSyncSummary,
  getFileName,
  sortCardViewRecords,
  toCardViewRecordFromCard,
  toCardViewRecordFromParsedCard,
} from './lib/cards';
import { buildExplorerTree, type ExplorerEntry, type ExplorerFileKind } from './lib/explorerTree';
import { getErrorMessage } from './lib/errorUtils';
import { renderMarkdownPreview } from './lib/markdownPreview';
import { moveStateKey } from './lib/stateUtils';
import { useCardDetailState } from './hooks/useCardDetailState';
import { useEditorTabs } from './hooks/useEditorTabs';
import { usePaneLayout } from './hooks/usePaneLayout';

const defaultDraftPath = 'Inbox/Stage-2-scratch.md';
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
type CrashpadPanel = 'cards' | 'history';
type CrashpadEditorMode = 'edit' | 'preview';

type MarkdownTabViewState = {
  viewMode: MarkdownViewMode;
  cardScope: CardScope;
  sourceScrollTop: number;
  previewScrollTop: number;
};

type CrashpadTabViewState = {
  activePanel: CrashpadPanel;
  editorMode: CrashpadEditorMode;
  previewTab: CardDetailTab;
  revealedQaAnswers: Record<string, boolean>;
  scrollTop: number;
};

const DEFAULT_MARKDOWN_TAB_VIEW_STATE: MarkdownTabViewState = {
  viewMode: 'source',
  cardScope: 'current-note',
  sourceScrollTop: 0,
  previewScrollTop: 0,
};

const DEFAULT_CRASHPAD_TAB_VIEW_STATE: CrashpadTabViewState = {
  activePanel: 'cards',
  editorMode: 'edit',
  previewTab: 'content',
  revealedQaAnswers: {},
  scrollTop: 0,
};

function normalizeRelativePath(rootPath: string | null, filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedRoot = rootPath?.replace(/\\/g, '/').replace(/\/+$/, '') ?? '';

  if (normalizedRoot && normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath;
}

function isCrashpadFilePath(filePath: string) {
  return filePath.toLowerCase().endsWith('.crashpad.json');
}

function isCardJsonFilePath(filePath: string) {
  return filePath.toLowerCase().endsWith('.json') && !isCrashpadFilePath(filePath);
}

function getCrashpadIdFromPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
  return fileName.replace(/\.crashpad\.json$/i, '');
}

function getCardUidFromPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
  return fileName.replace(/\.json$/i, '');
}

function isPathInsideVault(relativePath: string) {
  return !/^[A-Za-z]:\//i.test(relativePath) && !relativePath.startsWith('../') && relativePath !== '..';
}

function getTodayDateStamp() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCardRestoreStatus(
  uid: string,
  removeNoteBoundaries: boolean,
  mode: CardRestoreMode,
  result: CardRestoreResult,
) {
  const messages = [`Restored card ${uid}.`];

  if (!removeNoteBoundaries) {
    return messages.join(' ');
  }

  if (mode === 'forget-note-references') {
    messages.push(`Forgot ${result.forgottenReferences} saved note references.`);
    return messages.join(' ');
  }

  const linkedNoteCount = result.reinsertedInto + result.alreadyPresentIn;

  if (linkedNoteCount > 0) {
    const linkedParts: string[] = [];

    if (result.reinsertedInto > 0) {
      linkedParts.push(`${result.reinsertedInto} reinserted`);
    }

    if (result.alreadyPresentIn > 0) {
      linkedParts.push(`${result.alreadyPresentIn} already present`);
    }

    messages.push(`Linked it back into ${linkedNoteCount} notes (${linkedParts.join(', ')}).`);
  } else {
    messages.push('No saved note boundaries could be reinserted automatically.');
  }

  if (result.skippedNotePaths.length > 0) {
    messages.push(`Skipped ${result.skippedNotePaths.length} notes whose saved card block could no longer be matched.`);
  }

  return messages.join(' ');
}

type CrashpadHistoryEntry =
  | { kind: 'attach-existing'; uid: string }
  | { kind: 'create-new'; uid: string }
  | { kind: 'update-card'; before: CardDocument; after: CardDocument }
  | {
      kind: 'delete-card';
      card: CardDocument;
      origin: 'existing' | 'new';
      deletedAt: string;
      removeNoteBoundaries: boolean;
      deleteResult: CardDeleteResult;
    };

type CrashpadDeleteRequest = {
  strictConfirmationText: string;
  confirmed: boolean;
  removeNoteBoundaries: boolean;
};

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
  const [markdownTabViewStates, setMarkdownTabViewStates] = useState<Record<string, MarkdownTabViewState>>({});
  const [crashpadTabViewStates, setCrashpadTabViewStates] = useState<Record<string, CrashpadTabViewState>>({});
  const [focusedCardUidByTab, setFocusedCardUidByTab] = useState<Record<string, string | null>>({});
  const [crashpadSummaries, setCrashpadSummaries] = useState<CrashpadSummary[]>([]);
  const [activeCrashpad, setActiveCrashpad] = useState<CrashpadDocument | null>(null);
  const [crashpadDeletePreferences, setCrashpadDeletePreferences] = useState<CrashpadDeletePreferences>({
    removeNoteBoundariesByDefault: true,
    requireConfirmationForNewCards: true,
    requireStrictConfirmationForExistingCards: true,
  });
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
  const isSourceLocallyScrollingRef = useRef(false);
  const isPreviewLocallyScrollingRef = useRef(false);
  const sourceScrollTimerRef = useRef<number | null>(null);
  const previewScrollTimerRef = useRef<number | null>(null);

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
  const isCardsSurfaceActive = isCrashpadEditor || isCardEditor || (isMarkdownEditor && viewMode === 'cards');

  isMarkdownEditorRef.current = isMarkdownEditor;
  isSavingRef.current = isSaving;
  isSettingsOpenRef.current = isSettingsOpen;
  vaultPathRef.current = vaultPath;
  saveCurrentNoteRef.current = saveCurrentNote;

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

  const activeCrashpadViewState = useMemo(
    () => (isCrashpadEditor && currentTabPath ? crashpadTabViewStates[currentTabPath] ?? DEFAULT_CRASHPAD_TAB_VIEW_STATE : DEFAULT_CRASHPAD_TAB_VIEW_STATE),
    [crashpadTabViewStates, currentTabPath, isCrashpadEditor],
  );

  function updateMarkdownTabViewState(
    filePath: string,
    nextState: Partial<MarkdownTabViewState> | ((currentState: MarkdownTabViewState) => MarkdownTabViewState),
  ) {
    setMarkdownTabViewStates((previous) => {
      const currentState = previous[filePath] ?? DEFAULT_MARKDOWN_TAB_VIEW_STATE;
      const resolvedState =
        typeof nextState === 'function' ? nextState(currentState) : { ...currentState, ...nextState };

      if (
        currentState.viewMode === resolvedState.viewMode &&
        currentState.cardScope === resolvedState.cardScope &&
        currentState.sourceScrollTop === resolvedState.sourceScrollTop &&
        currentState.previewScrollTop === resolvedState.previewScrollTop
      ) {
        return previous;
      }

      return {
        ...previous,
        [filePath]: resolvedState,
      };
    });
  }

  function updateCrashpadTabViewState(
    filePath: string,
    nextState: Partial<CrashpadTabViewState> | ((currentState: CrashpadTabViewState) => CrashpadTabViewState),
  ) {
    setCrashpadTabViewStates((previous) => {
      const currentState = previous[filePath] ?? DEFAULT_CRASHPAD_TAB_VIEW_STATE;
      const resolvedState =
        typeof nextState === 'function' ? nextState(currentState) : { ...currentState, ...nextState };

      if (
        currentState.activePanel === resolvedState.activePanel &&
        currentState.editorMode === resolvedState.editorMode &&
        currentState.previewTab === resolvedState.previewTab &&
        currentState.scrollTop === resolvedState.scrollTop &&
        currentState.revealedQaAnswers === resolvedState.revealedQaAnswers
      ) {
        return previous;
      }

      return {
        ...previous,
        [filePath]: resolvedState,
      };
    });
  }

  function moveStoredTabState(previousPath: string, nextPath: string) {
    replaceOpenTabPath(previousPath, nextPath);
    setMarkdownTabViewStates((previous) => moveStateKey(previous, previousPath, nextPath));
    setCrashpadTabViewStates((previous) => moveStateKey(previous, previousPath, nextPath));
    setFocusedCardUidByTab((previous) => moveStateKey(previous, previousPath, nextPath));
    renameCardDetailState(previousPath, nextPath);
  }

  useEffect(() => {
    if (!currentTabPath) {
      return;
    }

    setFocusedCardUidByTab((previous) => {
      if ((previous[currentTabPath] ?? null) === focusedCardUid) {
        return previous;
      }

      return {
        ...previous,
        [currentTabPath]: focusedCardUid,
      };
    });
  }, [currentTabPath, focusedCardUid]);

  useEffect(() => {
    if (!isMarkdownEditor || !currentTabPath) {
      return;
    }

    updateMarkdownTabViewState(currentTabPath, { viewMode, cardScope });
  }, [cardScope, currentTabPath, isMarkdownEditor, viewMode]);

  useEffect(() => {
    if (!isMarkdownEditor || !currentTabPath) {
      return;
    }

    const activeTabState = markdownTabViewStates[currentTabPath] ?? DEFAULT_MARKDOWN_TAB_VIEW_STATE;
    const frame = window.requestAnimationFrame(() => {
      if (viewMode === 'source' && textareaRef.current && !isSourceLocallyScrollingRef.current) {
        textareaRef.current.scrollTop = activeTabState.sourceScrollTop;
      }

      if (viewMode === 'preview' && markdownPreviewRef.current && !isPreviewLocallyScrollingRef.current) {
        markdownPreviewRef.current.scrollTop = activeTabState.previewScrollTop;
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [currentTabPath, isMarkdownEditor, markdownTabViewStates, viewMode]);

  useEffect(() => {
    return () => {
      if (sourceScrollTimerRef.current !== null) {
        window.clearTimeout(sourceScrollTimerRef.current);
      }

      if (previewScrollTimerRef.current !== null) {
        window.clearTimeout(previewScrollTimerRef.current);
      }
    };
  }, []);

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

  function openSettings() {
    setIsSettingsOpen(true);
    setFocusedWindow('settings');
  }

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

  useEffect(() => {
    function handleEditorShortcuts(event: KeyboardEvent) {
      const isModifierPressed = event.ctrlKey || event.metaKey;

      if (!isModifierPressed || isSettingsOpenRef.current) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();

        if (vaultPathRef.current && !isSavingRef.current && isMarkdownEditorRef.current) {
          void saveCurrentNoteRef.current();
        }

        return;
      }
    }

    window.addEventListener('keydown', handleEditorShortcuts);

    return () => {
      window.removeEventListener('keydown', handleEditorShortcuts);
    };
  }, []);

  async function refreshCardsCatalog(rootPath: string) {
    const cards = await window.crashWeaver.listCards(rootPath);
    setAllCards(cards);
    return cards;
  }

  async function refreshInternalDirectories(rootPath: string) {
    const directories = await window.crashWeaver.listInternalDirectories(rootPath);
    setInternalDirectories(directories);
    return directories;
  }

  async function applyCardRenameResult(rootPath: string, renameSummary: CardRenameResult) {
    const refreshedVault = await window.crashWeaver.updateIndex(rootPath);
    setVault(refreshedVault);
    await refreshCardsCatalog(rootPath);
    await refreshCrashpadCatalog(rootPath, activeCrashpad?.id ?? null);

    if (refreshedVault.cardStore) {
      const previousCardPath = normalizeRelativePath(
        rootPath,
        `${refreshedVault.cardStore.cardStorePath.replace(/\\/g, '/')}/${renameSummary.previousUid}.json`,
      );
      const nextCardPath = normalizeRelativePath(
        rootPath,
        `${refreshedVault.cardStore.cardStorePath.replace(/\\/g, '/')}/${renameSummary.card.uid}.json`,
      );

      moveStoredTabState(previousCardPath, nextCardPath);

      if (selectedExplorerPath === previousCardPath) {
        setSelectedExplorerPath(nextCardPath);
      }

      if (activeCardFileUid === renameSummary.previousUid) {
        setActiveCardFileUid(renameSummary.card.uid);
        setActiveCardFilePath(nextCardPath);
      }
    }

    if (activeNote && renameSummary.updatedNotePaths.includes(activeNote.filePath)) {
      const refreshedNote = await window.crashWeaver.readNote(rootPath, activeNote.filePath);
      setActiveNote(refreshedNote);
    }

    setFocusedCardUid(renameSummary.card.uid);
    return refreshedVault;
  }

  function pushCrashpadHistory(entry: CrashpadHistoryEntry) {
    setCrashpadPast((previous) => [...previous, entry]);
    setCrashpadFuture([]);
  }

  async function refreshCrashpadCatalog(rootPath: string, preferredCrashpadId?: string | null) {
    const [rawSummaries, preferences] = await Promise.all([
      window.crashWeaver.listCrashpads(rootPath),
      window.crashWeaver.getCrashpadDeletePreferences(rootPath),
    ]);
    const summaries = rawSummaries.map((summary) => ({
      ...summary,
      filePath: normalizeRelativePath(rootPath, summary.filePath),
    }));

    setCrashpadSummaries(summaries);
    setCrashpadDeletePreferences(preferences);

    const targetCrashpadId = preferredCrashpadId ?? activeCrashpad?.id ?? summaries[0]?.id;

    if (!targetCrashpadId) {
      setActiveCrashpad(null);
      return null;
    }

    const crashpad = await window.crashWeaver.openCrashpad(rootPath, targetCrashpadId);
    const normalizedCrashpad = crashpad
      ? {
          ...crashpad,
          filePath: normalizeRelativePath(rootPath, crashpad.filePath),
        }
      : null;
    setActiveCrashpad(normalizedCrashpad);
    return normalizedCrashpad;
  }

  async function persistCrashpad(nextCrashpad: CrashpadDocument) {
    if (!vaultPath) {
      return null;
    }

    const saved = await window.crashWeaver.saveCrashpad(vaultPath, nextCrashpad);
    const normalizedCrashpad = {
      ...saved,
      filePath: normalizeRelativePath(vaultPath, saved.filePath),
    };
    setActiveCrashpad(normalizedCrashpad);
    await refreshCrashpadCatalog(vaultPath, normalizedCrashpad.id);
    return normalizedCrashpad;
  }

  async function handleCreateCrashpad(name: string) {
    if (!vaultPath) {
      setErrorMessage('Open a vault before creating a crashpad.');
      return false;
    }

    const normalizedName = name.trim();

    if (!normalizedName) {
      setErrorMessage('Crashpad name is required.');
      return false;
    }

    const crashpad = await window.crashWeaver.createCrashpad(vaultPath, normalizedName);
    setCrashpadPast([]);
    setCrashpadFuture([]);
    await refreshInternalDirectories(vaultPath);
    await refreshCrashpadCatalog(vaultPath, crashpad.id);
    await openCrashpadInEditor(vaultPath, crashpad.id);
    setStatusMessage(`Created crashpad ${crashpad.name}.`);
    setErrorMessage(null);
    return true;
  }

  async function openCrashpadInEditor(rootPath: string, crashpadId: string) {
    const crashpad = await window.crashWeaver.openCrashpad(rootPath, crashpadId);

    if (!crashpad) {
      throw new Error(`Crashpad ${crashpadId} was not found.`);
    }

    const normalizedCrashpad = {
      ...crashpad,
      filePath: normalizeRelativePath(rootPath, crashpad.filePath),
    };

    setActiveCrashpad(normalizedCrashpad);
    setActiveEditorKind('crashpad');
    setActiveCardFilePath('');
    setActiveCardFileUid(null);
    setSelectedExplorerPath(normalizedCrashpad.filePath);
    setFocusedCardUid(focusedCardUidByTab[normalizedCrashpad.filePath] ?? null);
    rememberOpenTab(normalizedCrashpad.filePath);
    return normalizedCrashpad;
  }

  async function handleOpenCrashpad(crashpadId: string) {
    if (!vaultPath || !crashpadId) {
      return;
    }

    await openCrashpadInEditor(vaultPath, crashpadId);
    setErrorMessage(null);
    setStatusMessage(`Loaded crashpad ${crashpadId}.`);
  }

  async function handleAttachExistingCardToCrashpad(candidateUid: string) {
    if (!vaultPath || !activeCrashpad) {
      setErrorMessage('Select or create a crashpad before opening existing cards.');
      return false;
    }

    const normalizedUid = candidateUid.trim();

    if (!normalizedUid) {
      setErrorMessage('Card title / ID is required.');
      return false;
    }

    if (activeCrashpad.cards.some((entry) => entry.uid === normalizedUid)) {
      setErrorMessage(`Card ${normalizedUid} is already in this crashpad.`);
      return false;
    }

    if (!allCards.some((card) => card.uid === normalizedUid)) {
      setErrorMessage(`Card ${normalizedUid} was not found in the current card store.`);
      return false;
    }

    const nextCrashpad: CrashpadDocument = {
      ...activeCrashpad,
      cards: [...activeCrashpad.cards, { uid: normalizedUid, origin: 'existing', addedAt: new Date().toISOString() }],
    };

    await persistCrashpad(nextCrashpad);
    pushCrashpadHistory({ kind: 'attach-existing', uid: normalizedUid });
    setFocusedCardUid(normalizedUid);
    setStatusMessage(`Opened existing card ${normalizedUid} in the crashpad.`);
    setErrorMessage(null);
    return true;
  }

  async function handleCreateCardFromCrashpad(candidateUid: string) {
    if (!vaultPath || !activeCrashpad) {
      setErrorMessage('Select or create a crashpad before creating cards.');
      return false;
    }

    const normalizedUid = candidateUid.trim();

    if (!normalizedUid) {
      setErrorMessage('Card title / ID is required.');
      return false;
    }

    if (activeCrashpad.cards.some((entry) => entry.uid === normalizedUid)) {
      setErrorMessage(`Card ${normalizedUid} is already present in this crashpad.`);
      return false;
    }

    try {
      await window.crashWeaver.createCard(vaultPath, normalizedUid);
      const nextCrashpad: CrashpadDocument = {
        ...activeCrashpad,
        cards: [...activeCrashpad.cards, { uid: normalizedUid, origin: 'new', addedAt: new Date().toISOString() }],
      };

      await refreshCardsCatalog(vaultPath);
      await refreshInternalDirectories(vaultPath);
      await persistCrashpad(nextCrashpad);
      pushCrashpadHistory({ kind: 'create-new', uid: normalizedUid });
      setFocusedCardUid(normalizedUid);
      setStatusMessage(`Created card ${normalizedUid} and added it to the crashpad.`);
      setErrorMessage(null);
      return true;
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to create card.'));
      return false;
    }
  }

  async function handleSaveCrashpadCard(card: CardDocument) {
    if (!vaultPath) {
      return;
    }

    const previousUid = focusedCard?.uid ?? focusedCardUid ?? card.uid;
    const previousCard = allCards.find((item) => item.uid === previousUid);
    let saved: CardDocument;
    let renameSummary: CardRenameResult | null = null;

    if (previousUid !== card.uid) {
      renameSummary = await window.crashWeaver.renameCard(vaultPath, previousUid, card);
      saved = renameSummary.card;
      await applyCardRenameResult(vaultPath, renameSummary);
    } else {
      saved = await window.crashWeaver.saveCard(vaultPath, card);
      await refreshCardsCatalog(vaultPath);
      setFocusedCardUid(saved.uid);
    }
    pushCrashpadHistory({ kind: 'update-card', before: previousCard ?? saved, after: saved });
    setStatusMessage(
      renameSummary
        ? `Renamed card ${renameSummary.previousUid} to ${saved.uid}. Updated ${renameSummary.updatedNotePaths.length} notes and ${renameSummary.updatedCrashpads} crashpads.`
        : `Saved card ${saved.uid}.`,
    );
    setErrorMessage(null);
  }

  async function handleDeleteFocusedCrashpadCard(request: CrashpadDeleteRequest) {
    if (!vaultPath || !activeCrashpad || !focusedCardUid) {
      return false;
    }

    const crashpadEntry = activeCrashpad.cards.find((entry) => entry.uid === focusedCardUid);
    const existingCard = allCards.find((card) => card.uid === focusedCardUid);

    if (!crashpadEntry || !existingCard) {
      setErrorMessage('Focused card is no longer available. Refresh the card catalog and retry.');
      return false;
    }

    if (crashpadEntry.origin === 'existing' && crashpadDeletePreferences.requireStrictConfirmationForExistingCards) {
      if (request.strictConfirmationText !== `DELETE ${focusedCardUid}`) {
        setStatusMessage('Delete cancelled. Strict confirmation did not match.');
        return false;
      }
    }

    if (crashpadEntry.origin === 'new' && crashpadDeletePreferences.requireConfirmationForNewCards) {
      if (!request.confirmed) {
        setStatusMessage('Delete cancelled. Confirmation checkbox was not enabled.');
        return false;
      }
    }

    const removeNoteBoundaries = crashpadEntry.origin === 'existing'
      ? request.removeNoteBoundaries
      : crashpadDeletePreferences.removeNoteBoundariesByDefault;

    const deleteResult = await window.crashWeaver.deleteCard(vaultPath, focusedCardUid, {
      removeNoteBoundaries,
    });
    await refreshCardsCatalog(vaultPath);
    await refreshInternalDirectories(vaultPath);

    const deletedAt = new Date().toISOString();
    const nextCrashpad: CrashpadDocument = {
      ...activeCrashpad,
      cards: activeCrashpad.cards.filter((entry) => entry.uid !== focusedCardUid),
      deletedCards: [
        {
          uid: focusedCardUid,
          origin: crashpadEntry.origin,
          deletedAt,
          removeNoteBoundaries,
          card: existingCard,
        },
        ...activeCrashpad.deletedCards,
      ],
    };

    await persistCrashpad(nextCrashpad);
    pushCrashpadHistory({
      kind: 'delete-card',
      card: existingCard,
      origin: crashpadEntry.origin,
      deletedAt,
      removeNoteBoundaries,
      deleteResult,
    });
    setFocusedCardUid(null);
    setStatusMessage(
      `Deleted card ${focusedCardUid}. Removed boundaries from ${deleteResult.removedBoundariesFrom} notes (${deleteResult.removedBoundaryLines} lines).`,
    );
    setErrorMessage(null);
    return true;
  }

  async function restoreCrashpadSnapshot(
    snapshot: CrashpadDeletedCardSnapshot,
    mode: CardRestoreMode,
  ) {
    if (!vaultPath) {
      throw new Error('Open a vault before restoring a card.');
    }

    return window.crashWeaver.restoreDeletedCard(vaultPath, snapshot, { mode });
  }

  async function handleRestoreDeletedCard(uid: string, deletedAt: string, mode: CardRestoreMode) {
    if (!vaultPath || !activeCrashpad) {
      return;
    }

    const snapshot = activeCrashpad.deletedCards.find(
      (s) => s.uid === uid && s.deletedAt === deletedAt,
    );

    if (!snapshot) {
      setErrorMessage(`Could not find deletion snapshot for card ${uid}.`);
      return;
    }

    const restoreMode = snapshot.removeNoteBoundaries ? mode : 'reinsert-note-boundaries';
    const restoreResult = await restoreCrashpadSnapshot(snapshot, restoreMode);
    await refreshCardsCatalog(vaultPath);

    const nextCrashpad: CrashpadDocument = {
      ...activeCrashpad,
      cards: [
        ...activeCrashpad.cards,
        { uid: snapshot.uid, origin: snapshot.origin, addedAt: new Date().toISOString() },
      ],
      deletedCards: activeCrashpad.deletedCards.filter(
        (s) => !(s.uid === uid && s.deletedAt === deletedAt),
      ),
    };

    await persistCrashpad(nextCrashpad);
    setFocusedCardUid(snapshot.uid);
    setStatusMessage(formatCardRestoreStatus(uid, snapshot.removeNoteBoundaries, restoreMode, restoreResult));
    setErrorMessage(null);
  }

  async function handleUndoCrashpadAction() {
    if (!vaultPath || !activeCrashpad || !crashpadPast.length) {
      return;
    }

    const entry = crashpadPast[crashpadPast.length - 1];

    try {
      if (entry.kind === 'attach-existing') {
        await persistCrashpad({
          ...activeCrashpad,
          cards: activeCrashpad.cards.filter((card) => card.uid !== entry.uid),
        });
      } else if (entry.kind === 'create-new') {
        await window.crashWeaver.deleteCard(vaultPath, entry.uid, { removeNoteBoundaries: false });
        await refreshCardsCatalog(vaultPath);
        await persistCrashpad({
          ...activeCrashpad,
          cards: activeCrashpad.cards.filter((card) => card.uid !== entry.uid),
        });
      } else if (entry.kind === 'update-card') {
        if (entry.before.uid !== entry.after.uid) {
          const renameSummary = await window.crashWeaver.renameCard(vaultPath, entry.after.uid, entry.before);
          await applyCardRenameResult(vaultPath, renameSummary);
        } else {
          await window.crashWeaver.saveCard(vaultPath, entry.before);
          await refreshCardsCatalog(vaultPath);
          setFocusedCardUid(entry.before.uid);
        }
      } else if (entry.kind === 'delete-card') {
        const snapshot: CrashpadDeletedCardSnapshot = {
          uid: entry.card.uid,
          origin: entry.origin,
          deletedAt: entry.deletedAt,
          removeNoteBoundaries: entry.removeNoteBoundaries,
          card: entry.card,
        };

        await restoreCrashpadSnapshot(snapshot, 'reinsert-note-boundaries');
        await refreshCardsCatalog(vaultPath);
        await persistCrashpad({
          ...activeCrashpad,
          cards: [...activeCrashpad.cards, { uid: entry.card.uid, origin: entry.origin, addedAt: new Date().toISOString() }],
          deletedCards: activeCrashpad.deletedCards.filter(
            (snapshot) => !(snapshot.uid === entry.card.uid && snapshot.deletedAt === entry.deletedAt),
          ),
        });
      }

      setCrashpadPast((previous) => previous.slice(0, -1));
      setCrashpadFuture((previous) => [entry, ...previous]);
      setStatusMessage('Crashpad undo applied.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to undo crashpad action.'));
    }
  }

  async function handleRedoCrashpadAction() {
    if (!vaultPath || !activeCrashpad || !crashpadFuture.length) {
      return;
    }

    const [entry, ...remainingFuture] = crashpadFuture;

    try {
      if (entry.kind === 'attach-existing') {
        await persistCrashpad({
          ...activeCrashpad,
          cards: [...activeCrashpad.cards, { uid: entry.uid, origin: 'existing', addedAt: new Date().toISOString() }],
        });
      } else if (entry.kind === 'create-new') {
        await window.crashWeaver.createCard(vaultPath, entry.uid);
        await refreshCardsCatalog(vaultPath);
        await persistCrashpad({
          ...activeCrashpad,
          cards: [...activeCrashpad.cards, { uid: entry.uid, origin: 'new', addedAt: new Date().toISOString() }],
        });
      } else if (entry.kind === 'update-card') {
        if (entry.before.uid !== entry.after.uid) {
          const renameSummary = await window.crashWeaver.renameCard(vaultPath, entry.before.uid, entry.after);
          await applyCardRenameResult(vaultPath, renameSummary);
        } else {
          await window.crashWeaver.saveCard(vaultPath, entry.after);
          await refreshCardsCatalog(vaultPath);
          setFocusedCardUid(entry.after.uid);
        }
      } else if (entry.kind === 'delete-card') {
        await window.crashWeaver.deleteCard(vaultPath, entry.card.uid, {
          removeNoteBoundaries: entry.removeNoteBoundaries,
        });
        await refreshCardsCatalog(vaultPath);
        await persistCrashpad({
          ...activeCrashpad,
          cards: activeCrashpad.cards.filter((card) => card.uid !== entry.card.uid),
          deletedCards: [
            {
              uid: entry.card.uid,
              origin: entry.origin,
              deletedAt: entry.deletedAt,
              removeNoteBoundaries: entry.removeNoteBoundaries,
              card: entry.card,
            },
            ...activeCrashpad.deletedCards,
          ],
        });
      }

      setCrashpadFuture(remainingFuture);
      setCrashpadPast((previous) => [...previous, entry]);
      setStatusMessage('Crashpad redo applied.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to redo crashpad action.'));
    }
  }

  async function handleUpdateCrashpadDeletePreferences(nextPreferences: CrashpadDeletePreferences) {
    if (!vaultPath) {
      return;
    }

    const saved = await window.crashWeaver.setCrashpadDeletePreferences(vaultPath, nextPreferences);
    setCrashpadDeletePreferences(saved);
    setStatusMessage('Crashpad delete preferences updated.');
    setErrorMessage(null);
  }

  function handleCrashpadActivePanelChange(nextPanel: CrashpadPanel) {
    if (!currentTabPath) {
      return;
    }

    updateCrashpadTabViewState(currentTabPath, { activePanel: nextPanel });
  }

  function handleCrashpadEditorModeChange(nextMode: CrashpadEditorMode) {
    if (!currentTabPath) {
      return;
    }

    updateCrashpadTabViewState(currentTabPath, { editorMode: nextMode });
  }

  function handleCrashpadPreviewTabChange(nextTab: CardDetailTab) {
    if (!currentTabPath) {
      return;
    }

    updateCrashpadTabViewState(currentTabPath, { previewTab: nextTab });
  }

  function handleCrashpadPreviewQaToggle(answerKey: string) {
    if (!currentTabPath) {
      return;
    }

    updateCrashpadTabViewState(currentTabPath, (currentState) => ({
      ...currentState,
      revealedQaAnswers: {
        ...currentState.revealedQaAnswers,
        [answerKey]: !currentState.revealedQaAnswers[answerKey],
      },
    }));
  }

  function handleCrashpadScrollTopChange(nextScrollTop: number) {
    if (!currentTabPath) {
      return;
    }

    updateCrashpadTabViewState(currentTabPath, { scrollTop: nextScrollTop });
  }

  function canSwitchEditors(targetPath: string) {
    return !hasUnsavedChanges || targetPath === currentEditorPath || targetPath === selectedNotePath;
  }

  async function openNoteInEditor(rootPath: string, filePath: string, options?: { restoreStoredState?: boolean }) {
    const note = await window.crashWeaver.readNote(rootPath, filePath);
    const restoreStoredState = options?.restoreStoredState ?? true;
    const markdownTabState = restoreStoredState
      ? markdownTabViewStates[note.filePath] ?? DEFAULT_MARKDOWN_TAB_VIEW_STATE
      : DEFAULT_MARKDOWN_TAB_VIEW_STATE;
    setActiveNote(note);
    setActiveEditorKind('markdown');
    setActiveCardFilePath('');
    setActiveCardFileUid(null);
    setSelectedNotePath(note.filePath);
    setSelectedExplorerPath(note.filePath);
    setDraftPath(note.filePath);
    setDraftContent(note.content);
    setSavedContent(note.content);
    setViewMode(markdownTabState.viewMode);
    setCardScope(markdownTabState.cardScope);
    setFocusedCardUid(restoreStoredState ? focusedCardUidByTab[note.filePath] ?? null : null);
    rememberOpenTab(note.filePath);
    return note;
  }

  async function openCardInEditor(filePath: string, uid: string) {
    const existingCard = allCards.find((card) => card.uid === uid);

    if (!existingCard) {
      throw new Error(`Card ${uid} was not found in the current card store.`);
    }

    setActiveEditorKind('card');
    setActiveCrashpad(null);
    setActiveCardFilePath(filePath);
    setActiveCardFileUid(uid);
    setSelectedExplorerPath(filePath);
    setFocusedCardUid(focusedCardUidByTab[filePath] ?? uid);
    setFocusedWindow('cards-list');
    rememberOpenTab(filePath);
    return existingCard;
  }

  async function openEditorDocument(rootPath: string, filePath: string, fileKind?: ExplorerFileKind) {
    if (fileKind === 'crashpad' || isCrashpadFilePath(filePath)) {
      const crashpadId = getCrashpadIdFromPath(filePath);
      return openCrashpadInEditor(rootPath, crashpadId);
    }

    if (fileKind === 'card' || isCardJsonFilePath(filePath)) {
      return openCardInEditor(filePath, getCardUidFromPath(filePath));
    }

    return openNoteInEditor(rootPath, filePath);
  }

  async function loadVault(rootPath: string, preferredNotePath?: string) {
    const openedVault = await window.crashWeaver.openVault(rootPath);
    const noteToOpen = preferredNotePath ?? (openFirstNoteOnVaultOpen ? openedVault.notes[0]?.filePath : undefined);

    setVaultPath(rootPath);
    setVault(openedVault);
    setExpandedFolders({});
    setOpenTabs([]);
    setMarkdownTabViewStates({});
    setCrashpadTabViewStates({});
    setFocusedCardUidByTab({});
    resetCardDetailState();
    setCrashpadPast([]);
    setCrashpadFuture([]);
    await refreshCardsCatalog(rootPath);
    await refreshInternalDirectories(rootPath);
    await refreshCrashpadCatalog(rootPath);

    if (noteToOpen) {
      await openNoteInEditor(rootPath, noteToOpen, { restoreStoredState: false });
      return openedVault;
    }

    setActiveEditorKind('markdown');
    setActiveNote(null);
    setActiveCrashpad(null);
    setActiveCardFilePath('');
    setActiveCardFileUid(null);
    setSelectedExplorerPath('');
    setSelectedNotePath('');
    setDraftPath(defaultDraftPath);
    setDraftContent(defaultDraftContent);
    setSavedContent(defaultDraftContent);
    setViewMode(DEFAULT_MARKDOWN_TAB_VIEW_STATE.viewMode);
    setCardScope(DEFAULT_MARKDOWN_TAB_VIEW_STATE.cardScope);
    setFocusedCardUid(null);

    return openedVault;
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

      const openedVault = await loadVault(selectedPath);
      const rebuildSummary = formatCardRebuildSummary(openedVault.lastCardRebuild);
      setStatusMessage(
        rebuildSummary
          ? `Vault opened and .crashweaver/index.json synchronized. ${rebuildSummary}`
          : 'Vault opened and .crashweaver/index.json synchronized.',
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected vault selection error.'));
    } finally {
      setIsPicking(false);
    }
  }

  async function handleOpenExplorerFile(filePath: string, fileKind: ExplorerFileKind) {
    if (!vaultPath) {
      return;
    }

    if (!canSwitchEditors(filePath)) {
      setStatusMessage(null);
      setErrorMessage('Save or discard current changes before switching notes or tabs.');
      return;
    }

    setIsReading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const openedDocument = await openEditorDocument(vaultPath, filePath, fileKind);
      if ('content' in openedDocument) {
        setStatusMessage(`Loaded ${openedDocument.filePath}.`);
      } else if ('raw_content' in openedDocument) {
        setStatusMessage(`Loaded card ${openedDocument.uid}.`);
      } else {
        setStatusMessage(`Loaded ${openedDocument.name}.`);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected file read error.'));
    } finally {
      setIsReading(false);
    }
  }

  async function handleOpenNote(filePath: string) {
    await handleOpenExplorerFile(filePath, 'markdown');
  }

  async function saveCurrentNote() {
    if (!isMarkdownEditor) {
      return;
    }

    if (!vaultPath) {
      setErrorMessage('Select a vault before saving a note.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const previousEditorPath = currentTabPath;
      const result = await window.crashWeaver.writeNote(vaultPath, {
        filePath: draftPath,
        content: draftContent,
      });

      setVault(result.vault);
      setActiveNote(result.note);
      setSelectedNotePath(result.note.filePath);
      setSelectedExplorerPath(result.note.filePath);
      setDraftPath(result.note.filePath);
      setDraftContent(result.note.content);
      setSavedContent(result.note.content);
      moveStoredTabState(previousEditorPath, result.note.filePath);
      await refreshCardsCatalog(vaultPath);
      const syncSummary = formatCardSyncSummary(result.note.cardSync ?? result.vault.lastCardSync);
        setStatusMessage(
          syncSummary
            ? `Saved ${result.note.filePath} and refreshed .crashweaver/index.json. ${syncSummary}`
            : `Saved ${result.note.filePath} and refreshed .crashweaver/index.json.`,
        );
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected note write error.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveCurrentNote();
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

  async function handleSelectCardStore() {
    if (!vaultPath) {
      setErrorMessage('Open a vault before selecting a card store.');
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const selectedPath = await window.crashWeaver.selectCardStoreFolder(vaultPath);

      if (!selectedPath) {
        setStatusMessage('Card store selection was cancelled.');
        return;
      }

      const updatedVault = await window.crashWeaver.setCardStorePath(vaultPath, selectedPath);
      setVault(updatedVault);
      await refreshCardsCatalog(vaultPath);
      await refreshInternalDirectories(vaultPath);
      await refreshCrashpadCatalog(vaultPath, activeCrashpad?.id ?? null);

      if (isMarkdownEditor && selectedNotePath) {
        await openNoteInEditor(vaultPath, selectedNotePath);
      }

      const rebuildSummary = formatCardRebuildSummary(updatedVault.lastCardRebuild);
      setStatusMessage(rebuildSummary ? `Card store updated. ${rebuildSummary}` : 'Card store updated.');
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected card store configuration error.'));
    }
  }

  async function handleSelectImageDirectories() {
    if (!vaultPath) {
      setErrorMessage('Open a vault before selecting image directories.');
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const selectedDirectories = await window.crashWeaver.selectImageDirectories(vaultPath);

      if (!selectedDirectories) {
        setStatusMessage('Image directory selection was cancelled.');
        return;
      }

      const updatedVault = await window.crashWeaver.setImageDirectories(vaultPath, selectedDirectories);
      setVault(updatedVault);
      setStatusMessage(
        updatedVault.imageDirectories.length
          ? `Image directories updated. ${updatedVault.imageDirectories.length} director${updatedVault.imageDirectories.length === 1 ? 'y' : 'ies'} selected.`
          : 'Image directories cleared. Relative image paths now resolve from the vault root only.',
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected image directory configuration error.'));
    }
  }

  async function handleResetImageDirectories() {
    if (!vaultPath) {
      setErrorMessage('Open a vault before resetting image directories.');
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const updatedVault = await window.crashWeaver.setImageDirectories(vaultPath, []);
      setVault(updatedVault);
      setStatusMessage('Image directories cleared. Relative image paths now resolve from the vault root only.');
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected image directory reset error.'));
    }
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
      await refreshCardsCatalog(vaultPath);
      await refreshInternalDirectories(vaultPath);
      await refreshCrashpadCatalog(vaultPath, activeCrashpad?.id ?? null);

      if (isMarkdownEditor && selectedNotePath) {
        await openNoteInEditor(vaultPath, selectedNotePath);
      }

      const rebuildSummary = formatCardRebuildSummary(refreshedVault.lastCardRebuild);
        setStatusMessage(
          rebuildSummary
            ? `.crashweaver/index.json refreshed from the current markdown files. ${rebuildSummary}`
            : '.crashweaver/index.json refreshed from the current markdown files.',
        );
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected index refresh error.'));
    } finally {
      setIsRefreshingIndex(false);
    }
  }

  async function handleActivateTab(filePath: string) {
    if (filePath === currentEditorPath || (isMarkdownEditor && filePath === selectedNotePath)) {
      return;
    }

    if (!vaultPath) {
      return;
    }

    setIsReading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await openEditorDocument(vaultPath, filePath);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected tab activation error.'));
    } finally {
      setIsReading(false);
    }
  }

  async function handleCloseTab(filePath: string) {
    const isCurrentTab = filePath === currentEditorPath || (isMarkdownEditor && filePath === selectedNotePath);

    if (isCurrentTab && hasUnsavedChanges) {
      setStatusMessage(null);
      setErrorMessage('Save or discard current changes before closing the active tab.');
      return;
    }

    const currentTabs = displayTabs;
    const currentIndex = currentTabs.indexOf(filePath);
    const nextTabs = currentTabs.filter((path) => path !== filePath);
    setOpenTabs(nextTabs);

    if (!isCurrentTab) {
      return;
    }

    const fallbackPath = nextTabs[currentIndex] ?? nextTabs[currentIndex - 1] ?? null;

    if (fallbackPath && vaultPath) {
      await openEditorDocument(vaultPath, fallbackPath);
      return;
    }

    clearEditorState();
  }

  async function handleOpenDailyCrashpad() {
    if (!vaultPath) {
      return;
    }

    const dateStamp = getTodayDateStamp();
    const dailyCrashpadPath = `.crashweaver/crashpads/${dateStamp}.crashpad.json`;

    if (!canSwitchEditors(dailyCrashpadPath)) {
      setStatusMessage(null);
      setErrorMessage('Save or discard current changes before switching files.');
      return;
    }

    setIsReading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const existingCrashpad = await window.crashWeaver.openCrashpad(vaultPath, dateStamp);

      if (!existingCrashpad) {
        await window.crashWeaver.createCrashpad(vaultPath, dateStamp);
      }

      await refreshInternalDirectories(vaultPath);
      await refreshCrashpadCatalog(vaultPath, dateStamp);
      await openCrashpadInEditor(vaultPath, dateStamp);
      setActiveWidgetTool('daily-crashpad');
      setFocusedWindow('cards-list');
      setStatusMessage(`Loaded daily crashpad ${dateStamp}.`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to open the daily crashpad.'));
    } finally {
      setIsReading(false);
    }
  }

  function handleToggleExplorerPane() {
    setFocusedWindow('explorer');
    setIsSidebarVisible((current) => {
      const next = !current;

      if (next) {
        setActiveSidebarTab('explorer');
        setActiveWidgetTool('explorer');
      }

      return next;
    });
  }

  return (
    <main className="appShell">
      <div className="windowUtilityStrip">
        <button
          className={`windowUtilityButton ${isInspectorVisible ? 'active' : ''}`}
          onClick={() => setIsInspectorVisible((current) => !current)}
          title="Toggle properties pane"
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
        style={
          {
            '--widgets-width': '56px',
            '--sidebar-width': isSidebarVisible ? `${sidebarWidth}px` : '0px',
            '--left-splitter-width': isSidebarVisible ? '8px' : '0px',
            '--inspector-width': isInspectorVisible ? `${inspectorWidth}px` : '0px',
            '--right-splitter-width': isInspectorVisible ? '8px' : '0px',
            '--editor-font-size': `${editorFontSize}px`,
          } as CSSProperties
        }
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
            onClick={() => {
              setActiveWidgetTool('extensions');
              setStatusMessage('Widget extensions will be added here in a later stage.');
              setErrorMessage(null);
            }}
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
                    isSourceLocallyScrollingRef.current = true;

                    if (sourceScrollTimerRef.current !== null) {
                      window.clearTimeout(sourceScrollTimerRef.current);
                    }

                    sourceScrollTimerRef.current = window.setTimeout(() => {
                      isSourceLocallyScrollingRef.current = false;
                      sourceScrollTimerRef.current = null;
                    }, 120);

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
                  isPreviewLocallyScrollingRef.current = true;

                  if (previewScrollTimerRef.current !== null) {
                    window.clearTimeout(previewScrollTimerRef.current);
                  }

                  previewScrollTimerRef.current = window.setTimeout(() => {
                    isPreviewLocallyScrollingRef.current = false;
                    previewScrollTimerRef.current = null;
                  }, 120);

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
          activeNote={activeNote}
          focusedCard={focusedCard}
          focusedCardElement={focusedCardElement}
          focusedWindow={focusedWindow}
          isCardsView={isCardsSurfaceActive}
          isVisible={isInspectorVisible}
          vault={vault}
          onSetFocusedWindow={setFocusedWindow}
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
      />
    </main>
  );
}

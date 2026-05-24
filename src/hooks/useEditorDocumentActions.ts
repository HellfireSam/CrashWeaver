import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CardScope } from '../lib/cards';
import {
  getCardUidFromPath,
  getCrashpadIdFromPath,
  isCardJsonFilePath,
  isCrashpadFilePath,
} from '../lib/editorPaths';
import { getErrorMessage } from '../lib/errorUtils';
import type { ExplorerFileKind } from '../lib/explorerTree';
import type { CrashpadDocument } from '../../electron/vault-contract';

type MarkdownViewMode = 'source' | 'preview' | 'cards';

type OpenNoteOptions = {
  restoreStoredState?: boolean;
};

type UseEditorDocumentActionsOptions = {
  vaultPath: string | null;
  isMarkdownEditor: boolean;
  hasUnsavedChanges: boolean;
  currentEditorPath: string;
  selectedNotePath: string;
  focusedCardUidByTab: Record<string, string | null>;
  allCards: Array<{ uid: string }>;
  displayTabs: string[];
  setOpenTabs: (nextTabs: string[]) => void;
  setIsReading: (value: boolean) => void;
  setStatusMessage: (message: string | null) => void;
  setErrorMessage: (message: string | null) => void;
  setActiveNote: (note: Awaited<ReturnType<typeof window.crashWeaver.readNote>>) => void;
  setActiveEditorKind: (kind: 'markdown' | 'crashpad' | 'card') => void;
  setActiveCrashpad: Dispatch<SetStateAction<CrashpadDocument | null>>;
  setActiveCardFilePath: (filePath: string) => void;
  setActiveCardFileUid: (uid: string | null) => void;
  setSelectedNotePath: (filePath: string) => void;
  setSelectedExplorerPath: (filePath: string) => void;
  setDraftPath: (filePath: string) => void;
  setDraftContent: (content: string) => void;
  setSavedContent: (content: string) => void;
  setViewMode: (viewMode: MarkdownViewMode) => void;
  setCardScope: (scope: CardScope) => void;
  setFocusedCardUid: (uid: string | null) => void;
  setFocusedWindow: (windowName: 'explorer' | 'source-editor' | 'preview' | 'cards-list' | 'card-detail' | 'settings') => void;
  rememberOpenTab: (filePath: string) => void;
  clearEditorState: () => void;
  openCrashpadInEditor: (rootPath: string, crashpadId: string) => Promise<CrashpadDocument>;
  getMarkdownTabState: (filePath: string, restoreStoredState: boolean) => { viewMode: MarkdownViewMode; cardScope: CardScope };
};

export function useEditorDocumentActions({
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
  getMarkdownTabState,
}: UseEditorDocumentActionsOptions) {
  const canSwitchEditors = useCallback(
    (targetPath: string) => !hasUnsavedChanges || targetPath === currentEditorPath || targetPath === selectedNotePath,
    [currentEditorPath, hasUnsavedChanges, selectedNotePath],
  );

  const openNoteInEditor = useCallback(
    async (rootPath: string, filePath: string, options?: OpenNoteOptions) => {
      const note = await window.crashWeaver.readNote(rootPath, filePath);
      const restoreStoredState = options?.restoreStoredState ?? true;
      const markdownTabState = getMarkdownTabState(note.filePath, restoreStoredState);

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
    },
    [
      focusedCardUidByTab,
      getMarkdownTabState,
      rememberOpenTab,
      setActiveCardFilePath,
      setActiveCardFileUid,
      setActiveEditorKind,
      setActiveNote,
      setCardScope,
      setDraftContent,
      setDraftPath,
      setFocusedCardUid,
      setSavedContent,
      setSelectedExplorerPath,
      setSelectedNotePath,
      setViewMode,
    ],
  );

  const openCardInEditor = useCallback(
    async (filePath: string, uid: string) => {
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
    },
    [
      allCards,
      focusedCardUidByTab,
      rememberOpenTab,
      setActiveCardFilePath,
      setActiveCardFileUid,
      setActiveCrashpad,
      setActiveEditorKind,
      setFocusedCardUid,
      setFocusedWindow,
      setSelectedExplorerPath,
    ],
  );

  const openEditorDocument = useCallback(
    async (rootPath: string, filePath: string, fileKind?: ExplorerFileKind) => {
      if (fileKind === 'crashpad' || isCrashpadFilePath(filePath)) {
        const crashpadId = getCrashpadIdFromPath(filePath);
        return openCrashpadInEditor(rootPath, crashpadId);
      }

      if (fileKind === 'card' || isCardJsonFilePath(filePath)) {
        return openCardInEditor(filePath, getCardUidFromPath(filePath));
      }

      return openNoteInEditor(rootPath, filePath);
    },
    [openCardInEditor, openCrashpadInEditor, openNoteInEditor],
  );

  const handleOpenExplorerFile = useCallback(
    async (filePath: string, fileKind: ExplorerFileKind) => {
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

        if (
          openedDocument &&
          typeof openedDocument === 'object' &&
          'content' in openedDocument &&
          'filePath' in openedDocument
        ) {
          setStatusMessage(`Loaded ${String(openedDocument.filePath)}.`);
        } else if (
          openedDocument &&
          typeof openedDocument === 'object' &&
          'raw_content' in openedDocument &&
          'uid' in openedDocument
        ) {
          setStatusMessage(`Loaded card ${String(openedDocument.uid)}.`);
        } else if (openedDocument && typeof openedDocument === 'object' && 'name' in openedDocument) {
          setStatusMessage(`Loaded ${String(openedDocument.name)}.`);
        }
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'Unexpected file read error.'));
      } finally {
        setIsReading(false);
      }
    },
    [canSwitchEditors, openEditorDocument, setErrorMessage, setIsReading, setStatusMessage, vaultPath],
  );

  const handleOpenNote = useCallback(
    async (filePath: string) => {
      await handleOpenExplorerFile(filePath, 'markdown');
    },
    [handleOpenExplorerFile],
  );

  const handleActivateTab = useCallback(
    async (filePath: string) => {
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
    },
    [
      currentEditorPath,
      isMarkdownEditor,
      openEditorDocument,
      selectedNotePath,
      setErrorMessage,
      setIsReading,
      setStatusMessage,
      vaultPath,
    ],
  );

  const handleCloseTab = useCallback(
    async (filePath: string) => {
      const isCurrentTab = filePath === currentEditorPath || (isMarkdownEditor && filePath === selectedNotePath);

      if (isCurrentTab && hasUnsavedChanges) {
        setStatusMessage(null);
        setErrorMessage('Save or discard current changes before closing the active tab.');
        return;
      }

      const currentIndex = displayTabs.indexOf(filePath);
      const nextTabs = displayTabs.filter((path) => path !== filePath);
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
    },
    [
      clearEditorState,
      currentEditorPath,
      displayTabs,
      hasUnsavedChanges,
      isMarkdownEditor,
      openEditorDocument,
      selectedNotePath,
      setErrorMessage,
      setOpenTabs,
      setStatusMessage,
      vaultPath,
    ],
  );

  return {
    canSwitchEditors,
    openNoteInEditor,
    openEditorDocument,
    handleOpenExplorerFile,
    handleOpenNote,
    handleActivateTab,
    handleCloseTab,
  };
}

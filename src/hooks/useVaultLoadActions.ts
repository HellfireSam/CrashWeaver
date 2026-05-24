import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CardScope } from '../lib/cards';
import type { CrashpadHistoryEntry } from '../lib/crashpadHistory';
import type { CrashpadDocument, VaultDescriptor } from '../../electron/vault-contract';
import type { MarkdownTabViewState } from './useEditorTabViewState';

type UseVaultLoadActionsOptions = {
  openFirstNoteOnVaultOpen: boolean;
  defaultDraftPath: string;
  defaultDraftContent: string;
  defaultMarkdownTabViewState: MarkdownTabViewState;
  refreshCardsCatalog: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listCards>>>;
  refreshInternalDirectories: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listInternalDirectories>>>;
  refreshCrashpadCatalog: (rootPath: string, preferredCrashpadId?: string | null) => Promise<CrashpadDocument | null>;
  openNoteInEditor: (
    rootPath: string,
    filePath: string,
    options?: { restoreStoredState?: boolean },
  ) => Promise<Awaited<ReturnType<typeof window.crashWeaver.readNote>>>;
  setVaultPath: (path: string | null) => void;
  setVault: Dispatch<SetStateAction<VaultDescriptor | null>>;
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>;
  setOpenTabs: (nextTabs: string[]) => void;
  resetStoredTabState: () => void;
  resetCardDetailState: () => void;
  setCrashpadPast: Dispatch<SetStateAction<CrashpadHistoryEntry[]>>;
  setCrashpadFuture: Dispatch<SetStateAction<CrashpadHistoryEntry[]>>;
  setActiveEditorKind: Dispatch<SetStateAction<'markdown' | 'crashpad' | 'card'>>;
  setActiveNote: Dispatch<SetStateAction<Awaited<ReturnType<typeof window.crashWeaver.readNote>> | null>>;
  setActiveCrashpad: Dispatch<SetStateAction<CrashpadDocument | null>>;
  setActiveCardFilePath: Dispatch<SetStateAction<string>>;
  setActiveCardFileUid: Dispatch<SetStateAction<string | null>>;
  setSelectedExplorerPath: Dispatch<SetStateAction<string>>;
  setSelectedNotePath: Dispatch<SetStateAction<string>>;
  setDraftPath: Dispatch<SetStateAction<string>>;
  setDraftContent: Dispatch<SetStateAction<string>>;
  setSavedContent: Dispatch<SetStateAction<string>>;
  setViewMode: Dispatch<SetStateAction<'source' | 'preview' | 'cards'>>;
  setCardScope: Dispatch<SetStateAction<CardScope>>;
  setFocusedCardUid: Dispatch<SetStateAction<string | null>>;
};

export function useVaultLoadActions({
  openFirstNoteOnVaultOpen,
  defaultDraftPath,
  defaultDraftContent,
  defaultMarkdownTabViewState,
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
}: UseVaultLoadActionsOptions) {
  const loadVault = useCallback(
    async (rootPath: string, preferredNotePath?: string) => {
      const openedVault = await window.crashWeaver.openVault(rootPath);
      const noteToOpen = preferredNotePath ?? (openFirstNoteOnVaultOpen ? openedVault.notes[0]?.filePath : undefined);

      setVaultPath(rootPath);
      setVault(openedVault);
      setExpandedFolders({});
      setOpenTabs([]);
      resetStoredTabState();
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
      setViewMode(defaultMarkdownTabViewState.viewMode);
      setCardScope(defaultMarkdownTabViewState.cardScope);
      setFocusedCardUid(null);

      return openedVault;
    },
    [
      defaultDraftContent,
      defaultDraftPath,
      defaultMarkdownTabViewState.cardScope,
      defaultMarkdownTabViewState.viewMode,
      openFirstNoteOnVaultOpen,
      openNoteInEditor,
      refreshCardsCatalog,
      refreshCrashpadCatalog,
      refreshInternalDirectories,
      resetCardDetailState,
      resetStoredTabState,
      setActiveCardFilePath,
      setActiveCardFileUid,
      setActiveCrashpad,
      setActiveEditorKind,
      setActiveNote,
      setCardScope,
      setCrashpadFuture,
      setCrashpadPast,
      setDraftContent,
      setDraftPath,
      setExpandedFolders,
      setFocusedCardUid,
      setOpenTabs,
      setSavedContent,
      setSelectedExplorerPath,
      setSelectedNotePath,
      setVault,
      setVaultPath,
      setViewMode,
    ],
  );

  return {
    loadVault,
  };
}

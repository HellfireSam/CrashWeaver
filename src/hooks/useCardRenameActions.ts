import { useCallback } from 'react';
import type { CardRenameResult, CrashpadDocument, VaultDescriptor } from '../../electron/vault-contract';
import { normalizeRelativePath } from '../lib/editorPaths';

type UseCardRenameActionsOptions = {
  activeCrashpadId: string | null;
  selectedExplorerPath: string;
  activeCardFileUid: string | null;
  activeNoteFilePath: string | null;
  refreshCardsCatalog: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listCards>>>;
  refreshCrashpadCatalog: (rootPath: string, preferredCrashpadId?: string | null) => Promise<CrashpadDocument | null>;
  moveStoredTabState: (previousPath: string, nextPath: string) => void;
  setVault: (vault: VaultDescriptor) => void;
  setSelectedExplorerPath: (path: string) => void;
  setActiveCardFileUid: (uid: string | null) => void;
  setActiveCardFilePath: (path: string) => void;
  setActiveNote: (note: Awaited<ReturnType<typeof window.crashWeaver.readNote>>) => void;
  setFocusedCardUid: (uid: string | null) => void;
};

export function useCardRenameActions({
  activeCrashpadId,
  selectedExplorerPath,
  activeCardFileUid,
  activeNoteFilePath,
  refreshCardsCatalog,
  refreshCrashpadCatalog,
  moveStoredTabState,
  setVault,
  setSelectedExplorerPath,
  setActiveCardFileUid,
  setActiveCardFilePath,
  setActiveNote,
  setFocusedCardUid,
}: UseCardRenameActionsOptions) {
  const applyCardRenameResult = useCallback(
    async (rootPath: string, renameSummary: CardRenameResult) => {
      const refreshedVault = await window.crashWeaver.updateIndex(rootPath);
      setVault(refreshedVault);
      await refreshCardsCatalog(rootPath);
      await refreshCrashpadCatalog(rootPath, activeCrashpadId);

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

      if (activeNoteFilePath && renameSummary.updatedNotePaths.includes(activeNoteFilePath)) {
        const refreshedNote = await window.crashWeaver.readNote(rootPath, activeNoteFilePath);
        setActiveNote(refreshedNote);
      }

      setFocusedCardUid(renameSummary.card.uid);
      return refreshedVault;
    },
    [
      activeCardFileUid,
      activeCrashpadId,
      activeNoteFilePath,
      moveStoredTabState,
      refreshCardsCatalog,
      refreshCrashpadCatalog,
      selectedExplorerPath,
      setActiveCardFilePath,
      setActiveCardFileUid,
      setActiveNote,
      setFocusedCardUid,
      setSelectedExplorerPath,
      setVault,
    ],
  );

  return {
    applyCardRenameResult,
  };
}

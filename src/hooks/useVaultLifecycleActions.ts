import { useCallback } from 'react';
import type { CrashpadDocument } from '../../electron/vault-contract';
import { formatCardRebuildSummary } from '../lib/cards';
import { getErrorMessage } from '../lib/errorUtils';

type UseVaultLifecycleActionsOptions = {
  vaultPath: string | null;
  activeCrashpadId: string | null;
  isMarkdownEditor: boolean;
  selectedNotePath: string;
  setVault: (next: Awaited<ReturnType<typeof window.crashWeaver.updateIndex>>) => void;
  setStatusMessage: (message: string | null) => void;
  setErrorMessage: (message: string | null) => void;
  setIsPicking: (value: boolean) => void;
  setIsRefreshingIndex: (value: boolean) => void;
  loadVault: (rootPath: string, preferredNotePath?: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.openVault>>>;
  refreshCardsCatalog: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listCards>>>;
  refreshInternalDirectories: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listInternalDirectories>>>;
  refreshCrashpadCatalog: (rootPath: string, preferredCrashpadId?: string | null) => Promise<CrashpadDocument | null>;
  openNoteInEditor: (rootPath: string, filePath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.readNote>>>;
};

export function useVaultLifecycleActions({
  vaultPath,
  activeCrashpadId,
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
}: UseVaultLifecycleActionsOptions) {
  const handleSelectVault = useCallback(async () => {
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
  }, [loadVault, setErrorMessage, setIsPicking, setStatusMessage]);

  const handleSelectCardStore = useCallback(async () => {
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
      await refreshCrashpadCatalog(vaultPath, activeCrashpadId ?? null);

      if (isMarkdownEditor && selectedNotePath) {
        await openNoteInEditor(vaultPath, selectedNotePath);
      }

      const rebuildSummary = formatCardRebuildSummary(updatedVault.lastCardRebuild);
      setStatusMessage(rebuildSummary ? `Card store updated. ${rebuildSummary}` : 'Card store updated.');
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unexpected card store configuration error.'));
    }
  }, [
    activeCrashpadId,
    isMarkdownEditor,
    openNoteInEditor,
    refreshCardsCatalog,
    refreshCrashpadCatalog,
    refreshInternalDirectories,
    selectedNotePath,
    setErrorMessage,
    setStatusMessage,
    setVault,
    vaultPath,
  ]);

  const handleSelectImageDirectories = useCallback(async () => {
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
  }, [setErrorMessage, setStatusMessage, setVault, vaultPath]);

  const handleResetImageDirectories = useCallback(async () => {
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
  }, [setErrorMessage, setStatusMessage, setVault, vaultPath]);

  const handleRefreshIndex = useCallback(async () => {
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
      await refreshCrashpadCatalog(vaultPath, activeCrashpadId ?? null);

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
  }, [
    activeCrashpadId,
    isMarkdownEditor,
    openNoteInEditor,
    refreshCardsCatalog,
    refreshCrashpadCatalog,
    refreshInternalDirectories,
    selectedNotePath,
    setErrorMessage,
    setIsRefreshingIndex,
    setStatusMessage,
    setVault,
    vaultPath,
  ]);

  return {
    handleSelectVault,
    handleSelectCardStore,
    handleSelectImageDirectories,
    handleResetImageDirectories,
    handleRefreshIndex,
  };
}

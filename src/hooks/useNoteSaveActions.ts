import { useCallback } from 'react';
import type { FormEvent } from 'react';
import { formatCardSyncSummary } from '../lib/cards';
import { getErrorMessage } from '../lib/errorUtils';

type UseNoteSaveActionsOptions = {
  isMarkdownEditor: boolean;
  vaultPath: string | null;
  currentTabPath: string;
  draftPath: string;
  draftContent: string;
  savedContent: string;
  activeNoteFilePath: string | null;
  setIsSaving: (value: boolean) => void;
  setErrorMessage: (message: string | null) => void;
  setStatusMessage: (message: string | null) => void;
  setVault: (next: Awaited<ReturnType<typeof window.crashWeaver.writeNote>>['vault']) => void;
  setActiveNote: (note: Awaited<ReturnType<typeof window.crashWeaver.writeNote>>['note']) => void;
  setSelectedNotePath: (path: string) => void;
  setSelectedExplorerPath: (path: string) => void;
  setDraftPath: (path: string) => void;
  setDraftContent: (content: string) => void;
  setSavedContent: (content: string) => void;
  moveStoredTabState: (previousPath: string, nextPath: string) => void;
  refreshCardsCatalog: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listCards>>>;
};

export function useNoteSaveActions({
  isMarkdownEditor,
  vaultPath,
  currentTabPath,
  draftPath,
  draftContent,
  savedContent,
  activeNoteFilePath,
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
}: UseNoteSaveActionsOptions) {
  const saveCurrentNote = useCallback(async () => {
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
  }, [
    currentTabPath,
    draftContent,
    draftPath,
    isMarkdownEditor,
    moveStoredTabState,
    refreshCardsCatalog,
    setActiveNote,
    setDraftContent,
    setDraftPath,
    setErrorMessage,
    setIsSaving,
    setSavedContent,
    setSelectedExplorerPath,
    setSelectedNotePath,
    setStatusMessage,
    setVault,
    vaultPath,
  ]);

  const handleSaveNote = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await saveCurrentNote();
    },
    [saveCurrentNote],
  );

  const handleDiscard = useCallback(() => {
    setDraftContent(savedContent);

    if (activeNoteFilePath) {
      setDraftPath(activeNoteFilePath);
    }
  }, [activeNoteFilePath, savedContent, setDraftContent, setDraftPath]);

  return {
    saveCurrentNote,
    handleSaveNote,
    handleDiscard,
  };
}

import { useCallback } from 'react';
import type { CrashpadDocument } from '../../electron/vault-contract';
import { getErrorMessage } from '../lib/errorUtils';

function getTodayDateStamp() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type UseDailyCrashpadActionsOptions = {
  vaultPath: string | null;
  canSwitchEditors: (nextPath: string) => boolean;
  refreshInternalDirectories: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listInternalDirectories>>>;
  refreshCrashpadCatalog: (rootPath: string, preferredCrashpadId?: string | null) => Promise<CrashpadDocument | null>;
  openCrashpadInEditor: (rootPath: string, crashpadId: string) => Promise<CrashpadDocument>;
  setIsReading: (reading: boolean) => void;
  setActiveWidgetTool: (tool: 'explorer' | 'daily-crashpad' | 'extensions') => void;
  setFocusedWindow: (window: 'explorer' | 'cards-list' | 'card-detail' | 'settings') => void;
  setStatusMessage: (message: string | null) => void;
  setErrorMessage: (message: string | null) => void;
};

export function useDailyCrashpadActions({
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
}: UseDailyCrashpadActionsOptions) {
  const handleOpenDailyCrashpad = useCallback(async () => {
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
  }, [
    canSwitchEditors,
    openCrashpadInEditor,
    refreshCrashpadCatalog,
    refreshInternalDirectories,
    setActiveWidgetTool,
    setErrorMessage,
    setFocusedWindow,
    setIsReading,
    setStatusMessage,
    vaultPath,
  ]);

  return {
    handleOpenDailyCrashpad,
  };
}

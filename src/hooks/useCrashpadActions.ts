import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  CrashpadDeletePreferences,
  CrashpadDocument,
  CrashpadSummary,
} from '../../electron/vault-contract';
import type { CardDetailTab } from '../lib/cards';
import { normalizeRelativePath } from '../lib/editorPaths';

type CrashpadPanel = 'cards' | 'history';
type CrashpadEditorMode = 'edit' | 'preview';
type CrashpadTabViewState = {
  activePanel: CrashpadPanel;
  editorMode: CrashpadEditorMode;
  previewTab: CardDetailTab;
  revealedQaAnswers: Record<string, boolean>;
  scrollTop: number;
};

type UseCrashpadActionsOptions = {
  vaultPath: string | null;
  activeCrashpad: CrashpadDocument | null;
  currentTabPath: string;
  focusedCardUidByTab: Record<string, string | null>;
  updateCrashpadTabViewState: (
    filePath: string,
    nextState: Partial<CrashpadTabViewState> | ((currentState: CrashpadTabViewState) => CrashpadTabViewState),
  ) => void;
  rememberOpenTab: (filePath: string) => void;
  refreshInternalDirectories: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listInternalDirectories>>>;
  setCrashpadSummaries: Dispatch<SetStateAction<CrashpadSummary[]>>;
  setCrashpadDeletePreferences: Dispatch<SetStateAction<CrashpadDeletePreferences>>;
  setActiveCrashpad: Dispatch<SetStateAction<CrashpadDocument | null>>;
  setActiveEditorKind: Dispatch<SetStateAction<'markdown' | 'crashpad' | 'card'>>;
  setActiveCardFilePath: Dispatch<SetStateAction<string>>;
  setActiveCardFileUid: Dispatch<SetStateAction<string | null>>;
  setSelectedExplorerPath: Dispatch<SetStateAction<string>>;
  setFocusedCardUid: Dispatch<SetStateAction<string | null>>;
  resetCrashpadHistory: () => void;
  setStatusMessage: Dispatch<SetStateAction<string | null>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
};

export function useCrashpadActions({
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
  resetCrashpadHistory,
  setStatusMessage,
  setErrorMessage,
}: UseCrashpadActionsOptions) {
  const refreshCrashpadCatalog = useCallback(
    async (rootPath: string, preferredCrashpadId?: string | null) => {
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
    },
    [
      activeCrashpad?.id,
      normalizeRelativePath,
      setActiveCrashpad,
      setCrashpadDeletePreferences,
      setCrashpadSummaries,
    ],
  );

  const persistCrashpad = useCallback(
    async (nextCrashpad: CrashpadDocument) => {
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
    },
    [normalizeRelativePath, refreshCrashpadCatalog, setActiveCrashpad, vaultPath],
  );

  const openCrashpadInEditor = useCallback(
    async (rootPath: string, crashpadId: string) => {
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
    },
    [
      focusedCardUidByTab,
      normalizeRelativePath,
      rememberOpenTab,
      setActiveCardFilePath,
      setActiveCardFileUid,
      setActiveCrashpad,
      setActiveEditorKind,
      setFocusedCardUid,
      setSelectedExplorerPath,
    ],
  );

  const handleOpenCrashpad = useCallback(
    async (crashpadId: string) => {
      if (!vaultPath || !crashpadId) {
        return;
      }

      await openCrashpadInEditor(vaultPath, crashpadId);
      setErrorMessage(null);
      setStatusMessage(`Loaded crashpad ${crashpadId}.`);
    },
    [openCrashpadInEditor, setErrorMessage, setStatusMessage, vaultPath],
  );

  const handleCreateCrashpad = useCallback(
    async (name: string) => {
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
      resetCrashpadHistory();
      await refreshInternalDirectories(vaultPath);
      await refreshCrashpadCatalog(vaultPath, crashpad.id);
      await openCrashpadInEditor(vaultPath, crashpad.id);
      setStatusMessage(`Created crashpad ${crashpad.name}.`);
      setErrorMessage(null);
      return true;
    },
    [
      openCrashpadInEditor,
      refreshCrashpadCatalog,
      refreshInternalDirectories,
      setErrorMessage,
      setStatusMessage,
      resetCrashpadHistory,
      vaultPath,
    ],
  );

  const handleUpdateCrashpadDeletePreferences = useCallback(
    async (nextPreferences: CrashpadDeletePreferences) => {
      if (!vaultPath) {
        return;
      }

      const saved = await window.crashWeaver.setCrashpadDeletePreferences(vaultPath, nextPreferences);
      setCrashpadDeletePreferences(saved);
      setStatusMessage('Crashpad delete preferences updated.');
      setErrorMessage(null);
    },
    [setCrashpadDeletePreferences, setErrorMessage, setStatusMessage, vaultPath],
  );

  const handleCrashpadActivePanelChange = useCallback(
    (nextPanel: CrashpadPanel) => {
      if (!currentTabPath) {
        return;
      }

      updateCrashpadTabViewState(currentTabPath, { activePanel: nextPanel });
    },
    [currentTabPath, updateCrashpadTabViewState],
  );

  const handleCrashpadEditorModeChange = useCallback(
    (nextMode: CrashpadEditorMode) => {
      if (!currentTabPath) {
        return;
      }

      updateCrashpadTabViewState(currentTabPath, { editorMode: nextMode });
    },
    [currentTabPath, updateCrashpadTabViewState],
  );

  const handleCrashpadPreviewTabChange = useCallback(
    (nextTab: CardDetailTab) => {
      if (!currentTabPath) {
        return;
      }

      updateCrashpadTabViewState(currentTabPath, { previewTab: nextTab });
    },
    [currentTabPath, updateCrashpadTabViewState],
  );

  const handleCrashpadPreviewQaToggle = useCallback(
    (answerKey: string) => {
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
    },
    [currentTabPath, updateCrashpadTabViewState],
  );

  const handleCrashpadScrollTopChange = useCallback(
    (nextScrollTop: number) => {
      if (!currentTabPath) {
        return;
      }

      updateCrashpadTabViewState(currentTabPath, { scrollTop: nextScrollTop });
    },
    [currentTabPath, updateCrashpadTabViewState],
  );

  return {
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
  };
}

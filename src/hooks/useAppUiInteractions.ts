import { useCallback, useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

type UseAppUiInteractionsOptions = {
  isSettingsOpenRef: MutableRefObject<boolean>;
  isSavingRef: MutableRefObject<boolean>;
  isMarkdownEditorRef: MutableRefObject<boolean>;
  vaultPathRef: MutableRefObject<string | null>;
  saveCurrentNoteRef: MutableRefObject<() => Promise<void>>;
  setIsSettingsOpen: (open: boolean) => void;
  setIsSidebarVisible: Dispatch<SetStateAction<boolean>>;
  setActiveSidebarTab: (tab: 'explorer' | 'search') => void;
  setActiveWidgetTool: (tool: 'explorer' | 'daily-crashpad' | 'extensions') => void;
  focusSettings: () => void;
  focusExplorer: () => void;
};

export function useAppUiInteractions({
  isSettingsOpenRef,
  isSavingRef,
  isMarkdownEditorRef,
  vaultPathRef,
  saveCurrentNoteRef,
  setIsSettingsOpen,
  setIsSidebarVisible,
  setActiveSidebarTab,
  setActiveWidgetTool,
  focusSettings,
  focusExplorer,
}: UseAppUiInteractionsOptions) {
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
  }, [setIsSettingsOpen]);

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
      }
    }

    window.addEventListener('keydown', handleEditorShortcuts);

    return () => {
      window.removeEventListener('keydown', handleEditorShortcuts);
    };
  }, [isMarkdownEditorRef, isSavingRef, isSettingsOpenRef, saveCurrentNoteRef, vaultPathRef]);

  const openSettings = useCallback(() => {
    setIsSettingsOpen(true);
    focusSettings();
  }, [focusSettings, setIsSettingsOpen]);

  const handleToggleExplorerPane = useCallback(() => {
    focusExplorer();
    setIsSidebarVisible((current) => {
      const next = !current;

      if (next) {
        setActiveSidebarTab('explorer');
        setActiveWidgetTool('explorer');
      }

      return next;
    });
  }, [focusExplorer, setActiveSidebarTab, setActiveWidgetTool, setIsSidebarVisible]);

  return {
    openSettings,
    handleToggleExplorerPane,
  };
}

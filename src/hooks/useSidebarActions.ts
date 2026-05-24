import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

type UseSidebarActionsOptions = {
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>;
  setActiveWidgetTool: (tool: 'explorer' | 'daily-crashpad' | 'extensions') => void;
  setStatusMessage: (message: string | null) => void;
  setErrorMessage: (message: string | null) => void;
};

export function useSidebarActions({
  setExpandedFolders,
  setActiveWidgetTool,
  setStatusMessage,
  setErrorMessage,
}: UseSidebarActionsOptions) {
  const handleToggleFolder = useCallback(
    (folderPath: string) => {
      setExpandedFolders((previous) => ({
        ...previous,
        [folderPath]: !(previous[folderPath] ?? false),
      }));
    },
    [setExpandedFolders],
  );

  const handleOpenExtensionsPlaceholder = useCallback(() => {
    setActiveWidgetTool('extensions');
    setStatusMessage('Widget extensions will be added here in a later stage.');
    setErrorMessage(null);
  }, [setActiveWidgetTool, setErrorMessage, setStatusMessage]);

  return {
    handleToggleFolder,
    handleOpenExtensionsPlaceholder,
  };
}

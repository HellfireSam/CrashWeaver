import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

type UseSidebarActionsOptions = {
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>;
};

export function useSidebarActions({ setExpandedFolders }: UseSidebarActionsOptions) {
  const handleToggleFolder = useCallback(
    (folderPath: string) => {
      setExpandedFolders((previous) => ({
        ...previous,
        [folderPath]: !(previous[folderPath] ?? false),
      }));
    },
    [setExpandedFolders],
  );

  return {
    handleToggleFolder,
  };
}

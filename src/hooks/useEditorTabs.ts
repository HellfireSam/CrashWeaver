import { useMemo, useRef, useState } from 'react';

export function useEditorTabs() {
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [dragTargetTabPath, setDragTargetTabPath] = useState<string | null>(null);
  const draggedTabPathRef = useRef<string | null>(null);

  const displayTabs = useMemo(() => openTabs.filter(Boolean), [openTabs]);

  function rememberOpenTab(filePath: string) {
    setOpenTabs((previous) => (previous.includes(filePath) ? previous : [...previous, filePath]));
  }

  function replaceOpenTabPath(previousPath: string, nextPath: string) {
    setOpenTabs((currentTabs) => {
      const nextTabs = currentTabs.map((path) => (path === previousPath ? nextPath : path));
      return nextTabs.includes(nextPath) ? nextTabs : [...nextTabs, nextPath];
    });
  }

  function reorderTabs(sourcePath: string, targetPath: string) {
    setOpenTabs((currentTabs) => {
      const fromIndex = currentTabs.indexOf(sourcePath);
      const targetIndex = currentTabs.indexOf(targetPath);

      if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) {
        return currentTabs;
      }

      const nextTabs = [...currentTabs];
      const [movedTab] = nextTabs.splice(fromIndex, 1);
      nextTabs.splice(targetIndex, 0, movedTab);
      return nextTabs;
    });
  }

  function handleTabDragStart(event: React.DragEvent<HTMLDivElement>, filePath: string) {
    draggedTabPathRef.current = filePath;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', filePath);
  }

  function handleTabDragOver(event: React.DragEvent<HTMLDivElement>, filePath: string) {
    event.preventDefault();

    if (dragTargetTabPath !== filePath) {
      setDragTargetTabPath(filePath);
    }
  }

  function handleTabDrop(filePath: string) {
    const sourcePath = draggedTabPathRef.current;

    if (sourcePath && sourcePath !== filePath) {
      reorderTabs(sourcePath, filePath);
    }

    draggedTabPathRef.current = null;
    setDragTargetTabPath(null);
  }

  function handleTabDragEnd() {
    draggedTabPathRef.current = null;
    setDragTargetTabPath(null);
  }

  return {
    displayTabs,
    dragTargetTabPath,
    setOpenTabs,
    rememberOpenTab,
    replaceOpenTabPath,
    handleTabDragStart,
    handleTabDragOver,
    handleTabDrop,
    handleTabDragEnd,
  };
}

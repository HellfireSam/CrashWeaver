import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { LAYOUT } from '../lib/layout';

interface UsePaneLayoutInput {
  layoutRef: RefObject<HTMLElement | null>;
  editorPaneRef: RefObject<HTMLElement | null>;
  isSidebarVisible: boolean;
  isInspectorVisible: boolean;
  isCardsSurfaceActive: boolean;
  focusedCardUid: string | null;
  activeEditorPath: string;
  statusMessage: string | null;
  errorMessage: string | null;
  visibleCardsLength: number;
}

export function usePaneLayout({
  layoutRef,
  editorPaneRef,
  isSidebarVisible,
  isInspectorVisible,
  isCardsSurfaceActive,
  focusedCardUid,
  activeEditorPath,
  statusMessage,
  errorMessage,
  visibleCardsLength,
}: UsePaneLayoutInput) {
  const [sidebarWidth, setSidebarWidth] = useState(270);
  const [inspectorWidth, setInspectorWidth] = useState(280);
  const [activeResizer, setActiveResizer] = useState<'left' | 'right' | null>(null);

  useEffect(() => {
    if (!activeResizer) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const layout = layoutRef.current;

      if (!layout) {
        return;
      }

      const rect = layout.getBoundingClientRect();
      const minimumSidebarWidth = LAYOUT.MIN_SIDEBAR_WIDTH;
      const minimumInspectorWidth = LAYOUT.MIN_INSPECTOR_WIDTH;
      const splitterAllowance =
        (isSidebarVisible ? LAYOUT.SPLITTER_WIDTH : 0) +
        (isInspectorVisible ? LAYOUT.SPLITTER_WIDTH : 0);
      const preferredEditorWidth = Math.round(
        rect.width * LAYOUT.PREFERRED_EDITOR_WIDTH_RATIO,
      );
      const minimumEditorWidth = Math.max(
        300,
        Math.min(
          preferredEditorWidth,
          rect.width - splitterAllowance - minimumSidebarWidth - minimumInspectorWidth,
        ),
      );
      const availablePanelWidth = rect.width - splitterAllowance;

      if (activeResizer === 'left' && isSidebarVisible) {
        const rawSidebarWidth = event.clientX - rect.left;
        const clampedSidebarWidth = Math.max(minimumSidebarWidth, rawSidebarWidth);

        if (!isInspectorVisible) {
          const maxSidebarWidth = availablePanelWidth - minimumEditorWidth;
          setSidebarWidth(Math.round(Math.min(clampedSidebarWidth, maxSidebarWidth)));
          return;
        }

        const maxSidebarWidth =
          availablePanelWidth - minimumEditorWidth - minimumInspectorWidth;
        const nextSidebarWidth = Math.min(
          clampedSidebarWidth,
          Math.max(minimumSidebarWidth, maxSidebarWidth),
        );
        const nextInspectorWidth = Math.max(
          minimumInspectorWidth,
          Math.min(
            inspectorWidth,
            availablePanelWidth - nextSidebarWidth - minimumEditorWidth,
          ),
        );

        setSidebarWidth(Math.round(nextSidebarWidth));

        if (nextInspectorWidth !== inspectorWidth) {
          setInspectorWidth(Math.round(nextInspectorWidth));
        }

        return;
      }

      if (activeResizer === 'right' && isInspectorVisible) {
        const rawInspectorWidth = rect.right - event.clientX;
        const clampedInspectorWidth = Math.max(minimumInspectorWidth, rawInspectorWidth);

        if (!isSidebarVisible) {
          const maxInspectorWidth = availablePanelWidth - minimumEditorWidth;
          setInspectorWidth(Math.round(Math.min(clampedInspectorWidth, maxInspectorWidth)));
          return;
        }

        const maxInspectorWidth =
          availablePanelWidth - minimumEditorWidth - minimumSidebarWidth;
        const nextInspectorWidth = Math.min(
          clampedInspectorWidth,
          Math.max(minimumInspectorWidth, maxInspectorWidth),
        );
        const nextSidebarWidth = Math.max(
          minimumSidebarWidth,
          Math.min(
            sidebarWidth,
            availablePanelWidth - nextInspectorWidth - minimumEditorWidth,
          ),
        );

        setInspectorWidth(Math.round(nextInspectorWidth));

        if (nextSidebarWidth !== sidebarWidth) {
          setSidebarWidth(Math.round(nextSidebarWidth));
        }
      }
    }

    function handleMouseUp() {
      setActiveResizer(null);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };
  }, [
    activeResizer,
    inspectorWidth,
    isInspectorVisible,
    isSidebarVisible,
    layoutRef,
    sidebarWidth,
  ]);

  useEffect(() => {
    if (!activeResizer) {
      return;
    }

    function suppressNativeDragging(event: Event) {
      event.preventDefault();
    }

    document.body.classList.add('columnResizeActive');
    window.getSelection()?.removeAllRanges();
    document.addEventListener('selectstart', suppressNativeDragging);
    document.addEventListener('dragstart', suppressNativeDragging);

    return () => {
      document.body.classList.remove('columnResizeActive');
      document.removeEventListener('selectstart', suppressNativeDragging);
      document.removeEventListener('dragstart', suppressNativeDragging);
    };
  }, [activeResizer]);

  useEffect(() => {
    if (activeResizer || !isCardsSurfaceActive) {
      return;
    }

    const editorPane = editorPaneRef.current;

    if (!editorPane) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const overflowWidth = Math.ceil(editorPane.scrollWidth - editorPane.clientWidth);

      if (overflowWidth <= 1) {
        return;
      }

      let remainingOverflow = overflowWidth;
      let nextInspectorWidth = inspectorWidth;
      let nextSidebarWidth = sidebarWidth;

      if (isInspectorVisible) {
        const reducibleInspectorWidth = Math.max(
          0,
          nextInspectorWidth - LAYOUT.MIN_INSPECTOR_WIDTH,
        );
        const inspectorReduction = Math.min(reducibleInspectorWidth, remainingOverflow);
        nextInspectorWidth -= inspectorReduction;
        remainingOverflow -= inspectorReduction;
      }

      if (remainingOverflow > 0 && isSidebarVisible) {
        const reducibleSidebarWidth = Math.max(
          0,
          nextSidebarWidth - LAYOUT.MIN_SIDEBAR_WIDTH,
        );
        const sidebarReduction = Math.min(reducibleSidebarWidth, remainingOverflow);
        nextSidebarWidth -= sidebarReduction;
      }

      if (nextInspectorWidth !== inspectorWidth) {
        setInspectorWidth(Math.round(nextInspectorWidth));
      }

      if (nextSidebarWidth !== sidebarWidth) {
        setSidebarWidth(Math.round(nextSidebarWidth));
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activeResizer,
    editorPaneRef,
    errorMessage,
    focusedCardUid,
    activeEditorPath,
    inspectorWidth,
    isCardsSurfaceActive,
    isInspectorVisible,
    isSidebarVisible,
    sidebarWidth,
    statusMessage,
    visibleCardsLength,
  ]);

  function handleResizeStart(
    event: React.MouseEvent<HTMLDivElement>,
    direction: 'left' | 'right',
  ) {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    setActiveResizer(direction);
  }

  return {
    sidebarWidth,
    inspectorWidth,
    activeResizer,
    handleResizeStart,
  };
}

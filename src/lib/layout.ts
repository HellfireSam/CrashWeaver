import type { CSSProperties } from 'react';

export const LAYOUT = {
  MIN_SIDEBAR_WIDTH: 210,
  MIN_INSPECTOR_WIDTH: 240,
  SPLITTER_WIDTH: 8,
  WIDGET_RAIL_WIDTH: 56,
  PREFERRED_EDITOR_WIDTH_RATIO: 0.38,
} as const;

interface LayoutStyleInput {
  isSidebarVisible: boolean;
  sidebarWidth: number;
  isInspectorVisible: boolean;
  inspectorWidth: number;
  editorFontSize: number;
}

/**
 * The shell grid's custom properties: a collapsed pane contributes no width and
 * no splitter, so the grid can reclaim the space without a second rule.
 */
export function computeLayoutStyle({
  isSidebarVisible,
  sidebarWidth,
  isInspectorVisible,
  inspectorWidth,
  editorFontSize,
}: LayoutStyleInput): CSSProperties {
  return {
    '--widgets-width': `${LAYOUT.WIDGET_RAIL_WIDTH}px`,
    '--sidebar-width': isSidebarVisible ? `${sidebarWidth}px` : '0px',
    '--left-splitter-width': isSidebarVisible ? `${LAYOUT.SPLITTER_WIDTH}px` : '0px',
    '--inspector-width': isInspectorVisible ? `${inspectorWidth}px` : '0px',
    '--right-splitter-width': isInspectorVisible ? `${LAYOUT.SPLITTER_WIDTH}px` : '0px',
    '--editor-font-size': `${editorFontSize}px`,
  } as CSSProperties;
}

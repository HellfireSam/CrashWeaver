import { describe, expect, it } from 'vitest';
import { computeLayoutStyle } from './layout';

describe('computeLayoutStyle', () => {
  it('lays out both panes at their stored widths when visible', () => {
    const style = computeLayoutStyle({
      isSidebarVisible: true,
      sidebarWidth: 270,
      isInspectorVisible: true,
      inspectorWidth: 280,
      editorFontSize: 15,
    });

    expect(style).toEqual({
      '--widgets-width': '56px',
      '--sidebar-width': '270px',
      '--left-splitter-width': '8px',
      '--inspector-width': '280px',
      '--right-splitter-width': '8px',
      '--editor-font-size': '15px',
    });
  });

  it('collapses a hidden pane and its splitter to zero width', () => {
    const style = computeLayoutStyle({
      isSidebarVisible: false,
      sidebarWidth: 270,
      isInspectorVisible: true,
      inspectorWidth: 280,
      editorFontSize: 15,
    });

    expect(style).toMatchObject({
      '--sidebar-width': '0px',
      '--left-splitter-width': '0px',
      '--inspector-width': '280px',
      '--right-splitter-width': '8px',
    });
  });

  it('collapses both panes and both splitters when both are hidden', () => {
    const style = computeLayoutStyle({
      isSidebarVisible: false,
      sidebarWidth: 270,
      isInspectorVisible: false,
      inspectorWidth: 280,
      editorFontSize: 15,
    });

    expect(style).toMatchObject({
      '--sidebar-width': '0px',
      '--left-splitter-width': '0px',
      '--inspector-width': '0px',
      '--right-splitter-width': '0px',
    });
  });

  it('keeps the editor font size independent of pane visibility', () => {
    const style = computeLayoutStyle({
      isSidebarVisible: false,
      sidebarWidth: 270,
      isInspectorVisible: false,
      inspectorWidth: 280,
      editorFontSize: 18,
    });

    expect(style).toMatchObject({ '--editor-font-size': '18px' });
  });
});

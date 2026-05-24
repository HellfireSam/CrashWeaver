import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CardDetailTab, CardScope } from '../lib/cards';
import { moveStateKey } from '../lib/stateUtils';

type MarkdownViewMode = 'source' | 'preview' | 'cards';
type CrashpadPanel = 'cards' | 'history';
type CrashpadEditorMode = 'edit' | 'preview';

export type MarkdownTabViewState = {
  viewMode: MarkdownViewMode;
  cardScope: CardScope;
  sourceScrollTop: number;
  previewScrollTop: number;
};

export type CrashpadTabViewState = {
  activePanel: CrashpadPanel;
  editorMode: CrashpadEditorMode;
  previewTab: CardDetailTab;
  revealedQaAnswers: Record<string, boolean>;
  scrollTop: number;
};

export const DEFAULT_MARKDOWN_TAB_VIEW_STATE: MarkdownTabViewState = {
  viewMode: 'source',
  cardScope: 'current-note',
  sourceScrollTop: 0,
  previewScrollTop: 0,
};

export const DEFAULT_CRASHPAD_TAB_VIEW_STATE: CrashpadTabViewState = {
  activePanel: 'cards',
  editorMode: 'edit',
  previewTab: 'content',
  revealedQaAnswers: {},
  scrollTop: 0,
};

type UseEditorTabViewStateOptions = {
  currentTabPath: string;
  isMarkdownEditor: boolean;
  isCrashpadEditor: boolean;
  viewMode: MarkdownViewMode;
  cardScope: CardScope;
  focusedCardUid: string | null;
  replaceOpenTabPath: (previousPath: string, nextPath: string) => void;
  renameCardDetailState: (previousPath: string, nextPath: string) => void;
};

export function useEditorTabViewState({
  currentTabPath,
  isMarkdownEditor,
  isCrashpadEditor,
  viewMode,
  cardScope,
  focusedCardUid,
  replaceOpenTabPath,
  renameCardDetailState,
}: UseEditorTabViewStateOptions) {
  const [markdownTabViewStates, setMarkdownTabViewStates] = useState<Record<string, MarkdownTabViewState>>({});
  const [crashpadTabViewStates, setCrashpadTabViewStates] = useState<Record<string, CrashpadTabViewState>>({});
  const [focusedCardUidByTab, setFocusedCardUidByTab] = useState<Record<string, string | null>>({});

  const updateMarkdownTabViewState = useCallback(
    (filePath: string, nextState: Partial<MarkdownTabViewState> | ((currentState: MarkdownTabViewState) => MarkdownTabViewState)) => {
      setMarkdownTabViewStates((previous) => {
        const currentState = previous[filePath] ?? DEFAULT_MARKDOWN_TAB_VIEW_STATE;
        const resolvedState =
          typeof nextState === 'function' ? nextState(currentState) : { ...currentState, ...nextState };

        if (
          currentState.viewMode === resolvedState.viewMode &&
          currentState.cardScope === resolvedState.cardScope &&
          currentState.sourceScrollTop === resolvedState.sourceScrollTop &&
          currentState.previewScrollTop === resolvedState.previewScrollTop
        ) {
          return previous;
        }

        return {
          ...previous,
          [filePath]: resolvedState,
        };
      });
    },
    [],
  );

  const updateCrashpadTabViewState = useCallback(
    (filePath: string, nextState: Partial<CrashpadTabViewState> | ((currentState: CrashpadTabViewState) => CrashpadTabViewState)) => {
      setCrashpadTabViewStates((previous) => {
        const currentState = previous[filePath] ?? DEFAULT_CRASHPAD_TAB_VIEW_STATE;
        const resolvedState =
          typeof nextState === 'function' ? nextState(currentState) : { ...currentState, ...nextState };

        if (
          currentState.activePanel === resolvedState.activePanel &&
          currentState.editorMode === resolvedState.editorMode &&
          currentState.previewTab === resolvedState.previewTab &&
          currentState.scrollTop === resolvedState.scrollTop &&
          currentState.revealedQaAnswers === resolvedState.revealedQaAnswers
        ) {
          return previous;
        }

        return {
          ...previous,
          [filePath]: resolvedState,
        };
      });
    },
    [],
  );

  const moveStoredTabState = useCallback(
    (previousPath: string, nextPath: string) => {
      replaceOpenTabPath(previousPath, nextPath);
      setMarkdownTabViewStates((previous) => moveStateKey(previous, previousPath, nextPath));
      setCrashpadTabViewStates((previous) => moveStateKey(previous, previousPath, nextPath));
      setFocusedCardUidByTab((previous) => moveStateKey(previous, previousPath, nextPath));
      renameCardDetailState(previousPath, nextPath);
    },
    [renameCardDetailState, replaceOpenTabPath],
  );

  const resetStoredTabState = useCallback(() => {
    setMarkdownTabViewStates({});
    setCrashpadTabViewStates({});
    setFocusedCardUidByTab({});
  }, []);

  useEffect(() => {
    if (!currentTabPath) {
      return;
    }

    setFocusedCardUidByTab((previous) => {
      if ((previous[currentTabPath] ?? null) === focusedCardUid) {
        return previous;
      }

      return {
        ...previous,
        [currentTabPath]: focusedCardUid,
      };
    });
  }, [currentTabPath, focusedCardUid]);

  useEffect(() => {
    if (!isMarkdownEditor || !currentTabPath) {
      return;
    }

    updateMarkdownTabViewState(currentTabPath, { viewMode, cardScope });
  }, [cardScope, currentTabPath, isMarkdownEditor, updateMarkdownTabViewState, viewMode]);

  const activeCrashpadViewState = useMemo(
    () =>
      isCrashpadEditor && currentTabPath
        ? crashpadTabViewStates[currentTabPath] ?? DEFAULT_CRASHPAD_TAB_VIEW_STATE
        : DEFAULT_CRASHPAD_TAB_VIEW_STATE,
    [crashpadTabViewStates, currentTabPath, isCrashpadEditor],
  );

  const activeMarkdownViewState = useMemo(
    () =>
      isMarkdownEditor && currentTabPath
        ? markdownTabViewStates[currentTabPath] ?? DEFAULT_MARKDOWN_TAB_VIEW_STATE
        : DEFAULT_MARKDOWN_TAB_VIEW_STATE,
    [currentTabPath, isMarkdownEditor, markdownTabViewStates],
  );

  return {
    markdownTabViewStates,
    crashpadTabViewStates,
    focusedCardUidByTab,
    setMarkdownTabViewStates,
    setCrashpadTabViewStates,
    setFocusedCardUidByTab,
    updateMarkdownTabViewState,
    updateCrashpadTabViewState,
    moveStoredTabState,
    resetStoredTabState,
    activeCrashpadViewState,
    activeMarkdownViewState,
  };
}

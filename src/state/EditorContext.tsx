/**
 * EditorContext — shared editor document, tab, and view-mode state.
 *
 * Replaces ~15 useState calls for editor kind, note paths, draft content,
 * view modes, and loading flags.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { VaultNoteDocument } from '../../electron/vault-contract';
import type { CardScope, FocusWindow } from '../lib/cards';

// ── Types ────────────────────────────────────────────────────────────────────

export type EditorDocumentKind = 'markdown' | 'crashpad' | 'card';
export type MarkdownViewMode = 'source' | 'preview' | 'cards';

const DEFAULT_DRAFT_PATH = 'Inbox/Stage-2-scratch.md';
const DEFAULT_DRAFT_CONTENT = [
  '# Stage 2 Scratch Note',
  '',
  'CrashWeaver vault write validation note.',
  '',
  '#stage2 #vault',
].join('\n');

export interface EditorState {
  activeEditorKind: EditorDocumentKind;
  activeCardFilePath: string;
  activeCardFileUid: string | null;
  selectedExplorerPath: string;
  selectedNotePath: string;
  draftPath: string;
  draftContent: string;
  savedContent: string;
  activeNote: VaultNoteDocument | null;
  viewMode: MarkdownViewMode;
  cardScope: CardScope;
  isPicking: boolean;
  isReading: boolean;
  isSaving: boolean;
  isRefreshingIndex: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
  editorFontSize: number;
}

export interface EditorActions {
  setActiveEditorKind: Dispatch<SetStateAction<EditorDocumentKind>>;
  setActiveCardFilePath: Dispatch<SetStateAction<string>>;
  setActiveCardFileUid: Dispatch<SetStateAction<string | null>>;
  setSelectedExplorerPath: Dispatch<SetStateAction<string>>;
  setSelectedNotePath: Dispatch<SetStateAction<string>>;
  setDraftPath: Dispatch<SetStateAction<string>>;
  setDraftContent: Dispatch<SetStateAction<string>>;
  setSavedContent: Dispatch<SetStateAction<string>>;
  setActiveNote: Dispatch<SetStateAction<VaultNoteDocument | null>>;
  setViewMode: Dispatch<SetStateAction<MarkdownViewMode>>;
  setCardScope: Dispatch<SetStateAction<CardScope>>;
  setIsPicking: Dispatch<SetStateAction<boolean>>;
  setIsReading: Dispatch<SetStateAction<boolean>>;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
  setIsRefreshingIndex: Dispatch<SetStateAction<boolean>>;
  setStatusMessage: Dispatch<SetStateAction<string | null>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setEditorFontSize: Dispatch<SetStateAction<number>>;
  /** Resets the editor to its default empty state (used on vault close). */
  clearEditorState: () => void;
}

export type EditorContextValue = EditorState & EditorActions;

// ── Context ──────────────────────────────────────────────────────────────────

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorStateProvider({ children }: { children: ReactNode }) {
  const [activeEditorKind, setActiveEditorKind] = useState<EditorDocumentKind>('markdown');
  const [activeCardFilePath, setActiveCardFilePath] = useState('');
  const [activeCardFileUid, setActiveCardFileUid] = useState<string | null>(null);
  const [selectedExplorerPath, setSelectedExplorerPath] = useState('');
  const [selectedNotePath, setSelectedNotePath] = useState('');
  const [draftPath, setDraftPath] = useState(DEFAULT_DRAFT_PATH);
  const [draftContent, setDraftContent] = useState(DEFAULT_DRAFT_CONTENT);
  const [savedContent, setSavedContent] = useState(DEFAULT_DRAFT_CONTENT);
  const [activeNote, setActiveNote] = useState<VaultNoteDocument | null>(null);
  const [viewMode, setViewMode] = useState<MarkdownViewMode>('source');
  const [cardScope, setCardScope] = useState<CardScope>('current-note');
  const [isPicking, setIsPicking] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingIndex, setIsRefreshingIndex] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editorFontSize, setEditorFontSize] = useState(15);

  const clearEditorState = useCallback(() => {
    setActiveEditorKind('markdown');
    setActiveCardFilePath('');
    setActiveCardFileUid(null);
    setActiveNote(null);
    setSelectedExplorerPath('');
    setSelectedNotePath('');
    setDraftPath(DEFAULT_DRAFT_PATH);
    setDraftContent(DEFAULT_DRAFT_CONTENT);
    setSavedContent(DEFAULT_DRAFT_CONTENT);
  }, []);

  const value = useMemo<EditorContextValue>(
    () => ({
      activeEditorKind,
      activeCardFilePath,
      activeCardFileUid,
      selectedExplorerPath,
      selectedNotePath,
      draftPath,
      draftContent,
      savedContent,
      activeNote,
      viewMode,
      cardScope,
      isPicking,
      isReading,
      isSaving,
      isRefreshingIndex,
      statusMessage,
      errorMessage,
      editorFontSize,
      setActiveEditorKind,
      setActiveCardFilePath,
      setActiveCardFileUid,
      setSelectedExplorerPath,
      setSelectedNotePath,
      setDraftPath,
      setDraftContent,
      setSavedContent,
      setActiveNote,
      setViewMode,
      setCardScope,
      setIsPicking,
      setIsReading,
      setIsSaving,
      setIsRefreshingIndex,
      setStatusMessage,
      setErrorMessage,
      setEditorFontSize,
      clearEditorState,
    }),
    [
      activeEditorKind,
      activeCardFilePath,
      activeCardFileUid,
      selectedExplorerPath,
      selectedNotePath,
      draftPath,
      draftContent,
      savedContent,
      activeNote,
      viewMode,
      cardScope,
      isPicking,
      isReading,
      isSaving,
      isRefreshingIndex,
      statusMessage,
      errorMessage,
      editorFontSize,
      clearEditorState,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditorState(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditorState must be used inside <EditorStateProvider>.');
  }
  return ctx;
}

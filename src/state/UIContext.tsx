/**
 * UIContext — layout, focus, and panel visibility state.
 *
 * Replaces ~10 useState calls for sidebar, inspector, settings modal,
 * expand/collapse, and widget-tool selection.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { FocusWindow } from '../lib/cards';
import type { CrashpadHistoryEntry } from '../lib/crashpadHistory';

// ── Types ────────────────────────────────────────────────────────────────────

export type WidgetTool = 'explorer' | 'daily-crashpad' | 'extensions';

export interface UIState {
  expandedFolders: Record<string, boolean>;
  activeSidebarTab: 'explorer' | 'search';
  isSidebarVisible: boolean;
  isInspectorVisible: boolean;
  isSettingsOpen: boolean;
  openFirstNoteOnVaultOpen: boolean;
  showHiddenEntries: boolean;
  focusedCardUid: string | null;
  focusedWindow: FocusWindow;
  activeWidgetTool: WidgetTool;
  crashpadPast: CrashpadHistoryEntry[];
  crashpadFuture: CrashpadHistoryEntry[];
}

export interface UIActions {
  setExpandedFolders: Dispatch<SetStateAction<Record<string, boolean>>>;
  setActiveSidebarTab: Dispatch<SetStateAction<'explorer' | 'search'>>;
  setIsSidebarVisible: Dispatch<SetStateAction<boolean>>;
  setIsInspectorVisible: Dispatch<SetStateAction<boolean>>;
  setIsSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setOpenFirstNoteOnVaultOpen: Dispatch<SetStateAction<boolean>>;
  setShowHiddenEntries: Dispatch<SetStateAction<boolean>>;
  setFocusedCardUid: Dispatch<SetStateAction<string | null>>;
  setFocusedWindow: Dispatch<SetStateAction<FocusWindow>>;
  setActiveWidgetTool: Dispatch<SetStateAction<WidgetTool>>;
  setCrashpadPast: Dispatch<SetStateAction<CrashpadHistoryEntry[]>>;
  setCrashpadFuture: Dispatch<SetStateAction<CrashpadHistoryEntry[]>>;
  /** Pushes a history entry onto the crashpad undo stack and clears the redo stack. */
  pushCrashpadHistory: (entry: CrashpadHistoryEntry) => void;
}

export type UIContextValue = UIState & UIActions;

// ── Context ──────────────────────────────────────────────────────────────────

const UIContext = createContext<UIContextValue | null>(null);

export function UIStateProvider({ children }: { children: ReactNode }) {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [activeSidebarTab, setActiveSidebarTab] = useState<'explorer' | 'search'>('explorer');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isInspectorVisible, setIsInspectorVisible] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [openFirstNoteOnVaultOpen, setOpenFirstNoteOnVaultOpen] = useState(true);
  const [showHiddenEntries, setShowHiddenEntries] = useState(false);
  const [focusedCardUid, setFocusedCardUid] = useState<string | null>(null);
  const [focusedWindow, setFocusedWindow] = useState<FocusWindow>('explorer');
  const [activeWidgetTool, setActiveWidgetTool] = useState<WidgetTool>('explorer');
  const [crashpadPast, setCrashpadPast] = useState<CrashpadHistoryEntry[]>([]);
  const [crashpadFuture, setCrashpadFuture] = useState<CrashpadHistoryEntry[]>([]);

  const pushCrashpadHistory = (entry: CrashpadHistoryEntry) => {
    setCrashpadPast((previous) => [...previous, entry]);
    setCrashpadFuture([]);
  };

  const value = useMemo<UIContextValue>(
    () => ({
      expandedFolders,
      activeSidebarTab,
      isSidebarVisible,
      isInspectorVisible,
      isSettingsOpen,
      openFirstNoteOnVaultOpen,
      showHiddenEntries,
      focusedCardUid,
      focusedWindow,
      activeWidgetTool,
      crashpadPast,
      crashpadFuture,
      setExpandedFolders,
      setActiveSidebarTab,
      setIsSidebarVisible,
      setIsInspectorVisible,
      setIsSettingsOpen,
      setOpenFirstNoteOnVaultOpen,
      setShowHiddenEntries,
      setFocusedCardUid,
      setFocusedWindow,
      setActiveWidgetTool,
      setCrashpadPast,
      setCrashpadFuture,
      pushCrashpadHistory,
    }),
    [
      expandedFolders,
      activeSidebarTab,
      isSidebarVisible,
      isInspectorVisible,
      isSettingsOpen,
      openFirstNoteOnVaultOpen,
      showHiddenEntries,
      focusedCardUid,
      focusedWindow,
      activeWidgetTool,
      crashpadPast,
      crashpadFuture,
    ],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUIState(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) {
    throw new Error('useUIState must be used inside <UIStateProvider>.');
  }
  return ctx;
}

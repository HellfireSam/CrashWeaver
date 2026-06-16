/**
 * VaultContext — shared vault, card-store, and crashpad state.
 *
 * Replaces 10+ useState calls that were scattered across App.tsx.
 * All vault-derived computations (explorer items, card lists, etc.)
 * belong here so every consumer sees the same canonical data.
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
import type {
  CardDocument,
  CrashpadDeletePreferences,
  CrashpadDocument,
  CrashpadSummary,
  VaultDescriptor,
} from '../../electron/vault-contract';

// ── Shape ────────────────────────────────────────────────────────────────────

export interface VaultState {
  vaultPath: string | null;
  vault: VaultDescriptor | null;
  vaultAlias: string;
  allCards: CardDocument[];
  internalDirectories: string[];
  crashpadSummaries: CrashpadSummary[];
  activeCrashpad: CrashpadDocument | null;
  crashpadDeletePreferences: CrashpadDeletePreferences;
}

export interface VaultActions {
  setVaultPath: Dispatch<SetStateAction<string | null>>;
  setVault: Dispatch<SetStateAction<VaultDescriptor | null>>;
  setVaultAlias: Dispatch<SetStateAction<string>>;
  setAllCards: Dispatch<SetStateAction<CardDocument[]>>;
  setInternalDirectories: Dispatch<SetStateAction<string[]>>;
  setCrashpadSummaries: Dispatch<SetStateAction<CrashpadSummary[]>>;
  setActiveCrashpad: Dispatch<SetStateAction<CrashpadDocument | null>>;
  setCrashpadDeletePreferences: Dispatch<SetStateAction<CrashpadDeletePreferences>>;
}

export type VaultContextValue = VaultState & VaultActions;

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CRASHPAD_DELETE_PREFERENCES: CrashpadDeletePreferences = {
  removeNoteBoundariesByDefault: true,
  requireConfirmationForNewCards: true,
  requireStrictConfirmationForExistingCards: true,
};

function createDefaultVaultState(): VaultState {
  return {
    vaultPath: null,
    vault: null,
    vaultAlias: 'My Vault',
    allCards: [],
    internalDirectories: [],
    crashpadSummaries: [],
    activeCrashpad: null,
    crashpadDeletePreferences: DEFAULT_CRASHPAD_DELETE_PREFERENCES,
  };
}

// ── Context ──────────────────────────────────────────────────────────────────

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultStateProvider({ children }: { children: ReactNode }) {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultDescriptor | null>(null);
  const [vaultAlias, setVaultAlias] = useState('My Vault');
  const [allCards, setAllCards] = useState<CardDocument[]>([]);
  const [internalDirectories, setInternalDirectories] = useState<string[]>([]);
  const [crashpadSummaries, setCrashpadSummaries] = useState<CrashpadSummary[]>([]);
  const [activeCrashpad, setActiveCrashpad] = useState<CrashpadDocument | null>(null);
  const [crashpadDeletePreferences, setCrashpadDeletePreferences] = useState<CrashpadDeletePreferences>(
    DEFAULT_CRASHPAD_DELETE_PREFERENCES,
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      vaultPath,
      vault,
      vaultAlias,
      allCards,
      internalDirectories,
      crashpadSummaries,
      activeCrashpad,
      crashpadDeletePreferences,
      setVaultPath,
      setVault,
      setVaultAlias,
      setAllCards,
      setInternalDirectories,
      setCrashpadSummaries,
      setActiveCrashpad,
      setCrashpadDeletePreferences,
    }),
    [
      vaultPath,
      vault,
      vaultAlias,
      allCards,
      internalDirectories,
      crashpadSummaries,
      activeCrashpad,
      crashpadDeletePreferences,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVaultState(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    throw new Error('useVaultState must be used inside <VaultStateProvider>.');
  }
  return ctx;
}

/**
 * Convenience hook: returns only the read-only vault state values
 * (without the setters).  Use this in derived-data useMemo hooks to
 * avoid subscribing to action references.
 */
export function useVaultStateValues(): VaultState {
  const { setVaultPath: _, setVault: __, setVaultAlias: ___, setAllCards: ____, setInternalDirectories: _____, setCrashpadSummaries: ______, setActiveCrashpad: _______, setCrashpadDeletePreferences: ________, ...state } = useVaultState();
  return state;
}

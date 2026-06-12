/// <reference types="vite/client" />

import type {
  CardDeleteOptions,
  CardDeleteResult,
  CardDocument,
  CardRenameResult,
  CardRestoreOptions,
  CardRestoreResult,
  CardStoreConfig,
  CrashpadDeletePreferences,
  CrashpadDeletedCardSnapshot,
  CrashpadDocument,
  CrashpadSummary,
  VaultDescriptor,
  VaultNoteDocument,
  WeavePlanRequest,
  WeavePlanResult,
  WeaveModelInfo,
  WeaveProviderHealth,
  WeaverKeyStatus,
  WeaverSettings,
  VaultWriteNoteInput,
  VaultWriteNoteResult,
} from '../electron/vault-contract';

declare global {
  interface Window {
    crashWeaver: {
      selectVaultFolder: () => Promise<string | null>;
      openVault: (rootPath: string) => Promise<VaultDescriptor>;
      listInternalDirectories: (rootPath: string) => Promise<string[]>;
      readNote: (rootPath: string, filePath: string) => Promise<VaultNoteDocument>;
      writeNote: (rootPath: string, input: VaultWriteNoteInput) => Promise<VaultWriteNoteResult>;
      updateIndex: (rootPath: string) => Promise<VaultDescriptor>;
      selectCardStoreFolder: (rootPath: string) => Promise<string | null>;
      selectImageDirectories: (rootPath: string) => Promise<string[] | null>;
      getCardStoreConfig: (rootPath: string) => Promise<CardStoreConfig>;
      listCards: (rootPath: string) => Promise<CardDocument[]>;
      createCard: (rootPath: string, uid: string) => Promise<CardDocument>;
      saveCard: (rootPath: string, card: CardDocument) => Promise<CardDocument>;
      renameCard: (rootPath: string, previousUid: string, card: CardDocument) => Promise<CardRenameResult>;
      deleteCard: (rootPath: string, uid: string, options: CardDeleteOptions) => Promise<CardDeleteResult>;
      restoreDeletedCard: (
        rootPath: string,
        snapshot: CrashpadDeletedCardSnapshot,
        options: CardRestoreOptions,
      ) => Promise<CardRestoreResult>;
      setCardStorePath: (rootPath: string, cardStorePath: string) => Promise<VaultDescriptor>;
      setImageDirectories: (rootPath: string, imageDirectories: string[]) => Promise<VaultDescriptor>;
      listCrashpads: (rootPath: string) => Promise<CrashpadSummary[]>;
      openCrashpad: (rootPath: string, crashpadId: string) => Promise<CrashpadDocument | null>;
      createCrashpad: (rootPath: string, name: string) => Promise<CrashpadDocument>;
      saveCrashpad: (rootPath: string, crashpad: CrashpadDocument) => Promise<CrashpadDocument>;
      getCrashpadDeletePreferences: (rootPath: string) => Promise<CrashpadDeletePreferences>;
      setCrashpadDeletePreferences: (
        rootPath: string,
        preferences: CrashpadDeletePreferences,
      ) => Promise<CrashpadDeletePreferences>;
      generateWeavePlan: (request: WeavePlanRequest) => Promise<WeavePlanResult>;
      checkWeaveProvider: () => Promise<WeaveProviderHealth>;
      /** Returns true when the stub (offline) provider is active. */
      isStubWeaveProvider: () => Promise<boolean>;
      listWeaveModels: () => Promise<WeaveModelInfo[]>;
      getWeaverSettings: () => Promise<WeaverSettings>;
      updateWeaverSettings: (updates: Partial<WeaverSettings>) => Promise<WeaverSettings>;
      setWeaverPreferredModel: (preferredModel: string | null) => Promise<WeaverSettings>;
      getWeaverRequestLogsDirectory: () => Promise<string | null>;
      setWeaverRequestLogsDirectory: (directoryPath: string | null) => Promise<string | null>;
      setWeaverApiKey: (key: string) => Promise<void>;
      clearWeaverApiKey: () => Promise<void>;
      /** Subscribe to live Weaver plan generation progress. Returns an unsubscribe function. */
      onWeavePlanProgress: (callback: (event: unknown) => void) => () => void;
      /** List all past Weaver sessions from the logs directory, newest first. */
      listWeaverSessions: () => Promise<unknown[]>;
      /** Get full detail for a single Weaver session by its ID. */
      getWeaverSession: (sessionId: string) => Promise<unknown | null>;
      /** Delete a single Weaver session log file. */
      deleteWeaverSession: (sessionId: string) => Promise<boolean>;
      /** Delete all Weaver session log files. Returns count of files deleted. */
      clearWeaverSessions: () => Promise<number>;
    };
  }
}

export {};

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './ipcChannels';
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
  WeaveApplyResult,
  WeavePlanOperation,
  WeavePlanRequest,
  WeavePlanResult,
  WeaverModelInfo,
  WeaverProviderHealth,
  WeaverSettings,
  VaultWriteNoteInput,
  VaultWriteNoteResult,
} from './vault-contract';

const crashWeaverBridge = {
  selectVaultFolder: () =>
    ipcRenderer.invoke(IPC_CHANNELS.vault.selectFolder) as Promise<string | null>,
  openVault: (rootPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.vault.open, rootPath) as Promise<VaultDescriptor>,
  listInternalDirectories: (rootPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.vault.listInternalDirectories, rootPath) as Promise<string[]>,
  readNote: (rootPath: string, filePath: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.vault.readNote,
      rootPath,
      filePath,
    ) as Promise<VaultNoteDocument>,
  writeNote: (rootPath: string, input: VaultWriteNoteInput) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.vault.writeNote,
      rootPath,
      input,
    ) as Promise<VaultWriteNoteResult>,
  updateIndex: (rootPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.vault.updateIndex, rootPath) as Promise<VaultDescriptor>,
  selectCardStoreFolder: (rootPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cardStore.selectFolder, rootPath) as Promise<string | null>,
  selectImageDirectories: (rootPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.vault.selectImageDirectories, rootPath) as Promise<
      string[] | null
    >,
  getCardStoreConfig: (rootPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cardStore.getConfig, rootPath) as Promise<CardStoreConfig>,
  listCards: (rootPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cardStore.listCards, rootPath) as Promise<CardDocument[]>,
  createCard: (rootPath: string, uid: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cardStore.createCard, rootPath, uid) as Promise<CardDocument>,
  saveCard: (rootPath: string, card: CardDocument) =>
    ipcRenderer.invoke(IPC_CHANNELS.cardStore.saveCard, rootPath, card) as Promise<CardDocument>,
  renameCard: (rootPath: string, previousUid: string, card: CardDocument) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.cardStore.renameCard,
      rootPath,
      previousUid,
      card,
    ) as Promise<CardRenameResult>,
  deleteCard: (rootPath: string, uid: string, options: CardDeleteOptions) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.cardStore.deleteCard,
      rootPath,
      uid,
      options,
    ) as Promise<CardDeleteResult>,
  restoreDeletedCard: (
    rootPath: string,
    snapshot: CrashpadDeletedCardSnapshot,
    options: CardRestoreOptions,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.cardStore.restoreCard,
      rootPath,
      snapshot,
      options,
    ) as Promise<CardRestoreResult>,
  setCardStorePath: (rootPath: string, cardStorePath: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.cardStore.setPath,
      rootPath,
      cardStorePath,
    ) as Promise<VaultDescriptor>,
  setImageDirectories: (rootPath: string, imageDirectories: string[]) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.vault.setImageDirectories,
      rootPath,
      imageDirectories,
    ) as Promise<VaultDescriptor>,
  listCrashpads: (rootPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.crashpad.list, rootPath) as Promise<CrashpadSummary[]>,
  openCrashpad: (rootPath: string, crashpadId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.crashpad.open,
      rootPath,
      crashpadId,
    ) as Promise<CrashpadDocument | null>,
  createCrashpad: (rootPath: string, name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.crashpad.create, rootPath, name) as Promise<CrashpadDocument>,
  saveCrashpad: (rootPath: string, crashpad: CrashpadDocument) =>
    ipcRenderer.invoke(IPC_CHANNELS.crashpad.save, rootPath, crashpad) as Promise<CrashpadDocument>,
  getCrashpadDeletePreferences: (rootPath: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.crashpad.getDeletePreferences,
      rootPath,
    ) as Promise<CrashpadDeletePreferences>,
  setCrashpadDeletePreferences: (rootPath: string, preferences: CrashpadDeletePreferences) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.crashpad.setDeletePreferences,
      rootPath,
      preferences,
    ) as Promise<CrashpadDeletePreferences>,
  generateWeavePlan: (request: WeavePlanRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.weave.generatePlan, request) as Promise<WeavePlanResult>,
  checkWeaverProvider: () =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.healthCheck) as Promise<WeaverProviderHealth>,
  isStubWeaverProvider: () =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.isStubProvider) as Promise<boolean>,
  listWeaverModels: () =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.listModels) as Promise<WeaverModelInfo[]>,
  getWeaverSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.getSettings) as Promise<WeaverSettings>,
  updateWeaverSettings: (updates: Partial<WeaverSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.updateSettings, updates) as Promise<WeaverSettings>,
  setWeaverPreferredModel: (preferredModel: string | null) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.weaver.setPreferredModel,
      preferredModel,
    ) as Promise<WeaverSettings>,
  getWeaverRequestLogsDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.getRequestLogsDirectory) as Promise<string | null>,
  setWeaverRequestLogsDirectory: (directoryPath: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.setRequestLogsDirectory, directoryPath) as Promise<
      string | null
    >,
  setWeaverApiKey: (key: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.setApiKey, key) as Promise<void>,
  clearWeaverApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.weaver.clearApiKey) as Promise<void>,

  // Weaver progress events (push-based, not invoke)
  onWeavePlanProgress: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.events.weavePlanProgress, handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.events.weavePlanProgress, handler);
    };
  },

  // Weaver session history
  listWeaverSessions: (rootPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.listSessions, rootPath) as Promise<unknown[]>,
  getWeaverSession: (sessionId: string, rootPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.getSession, sessionId, rootPath) as Promise<
      unknown | null
    >,
  deleteWeaverSession: (sessionId: string, rootPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.deleteSession, sessionId, rootPath) as Promise<boolean>,
  clearWeaverSessions: (rootPath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.weaver.clearSessions, rootPath) as Promise<number>,
  /** Apply a list of Weaver plan operations to the vault. Returns per-operation results. */
  applyWeavePlan: (rootPath: string, operations: WeavePlanOperation[]) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.weave.applyPlan,
      rootPath,
      operations,
    ) as Promise<WeaveApplyResult>,

  // Vault external-change events (push-based, not invoke)
  onVaultExternalChange: (callback: (changedPaths: string[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, paths: string[]) => callback(paths);
    ipcRenderer.on(IPC_CHANNELS.events.vaultExternalChange, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.events.vaultExternalChange, handler);
    };
  },
};

contextBridge.exposeInMainWorld('crashWeaver', crashWeaverBridge);

/**
 * The renderer's view of the preload bridge. Derived from the exposed object
 * itself, so a renamed or re-signatured member is a compile error in the
 * renderer instead of a hand-written copy that can drift.
 */
export type CrashWeaverBridge = typeof crashWeaverBridge;

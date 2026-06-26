import { contextBridge, ipcRenderer } from 'electron';
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
  WeaveModelInfo,
  WeaveProviderHealth,
  WeaverKeyStatus,
  WeaverSettings,
  VaultWriteNoteInput,
  VaultWriteNoteResult,
} from './vault-contract';

contextBridge.exposeInMainWorld('crashWeaver', {
  selectVaultFolder: () => ipcRenderer.invoke('vault:select-folder') as Promise<string | null>,
  openVault: (rootPath: string) => ipcRenderer.invoke('vault:open', rootPath) as Promise<VaultDescriptor>,
  listInternalDirectories: (rootPath: string) =>
    ipcRenderer.invoke('vault:list-internal-directories', rootPath) as Promise<string[]>,
  readNote: (rootPath: string, filePath: string) =>
    ipcRenderer.invoke('vault:read-note', rootPath, filePath) as Promise<VaultNoteDocument>,
  writeNote: (rootPath: string, input: VaultWriteNoteInput) =>
    ipcRenderer.invoke('vault:write-note', rootPath, input) as Promise<VaultWriteNoteResult>,
  updateIndex: (rootPath: string) => ipcRenderer.invoke('vault:update-index', rootPath) as Promise<VaultDescriptor>,
  selectCardStoreFolder: (rootPath: string) =>
    ipcRenderer.invoke('card-store:select-folder', rootPath) as Promise<string | null>,
  selectImageDirectories: (rootPath: string) =>
    ipcRenderer.invoke('vault:select-image-directories', rootPath) as Promise<string[] | null>,
  getCardStoreConfig: (rootPath: string) =>
    ipcRenderer.invoke('card-store:get-config', rootPath) as Promise<CardStoreConfig>,
  listCards: (rootPath: string) => ipcRenderer.invoke('card-store:list-cards', rootPath) as Promise<CardDocument[]>,
  createCard: (rootPath: string, uid: string) =>
    ipcRenderer.invoke('card-store:create-card', rootPath, uid) as Promise<CardDocument>,
  saveCard: (rootPath: string, card: CardDocument) =>
    ipcRenderer.invoke('card-store:save-card', rootPath, card) as Promise<CardDocument>,
  renameCard: (rootPath: string, previousUid: string, card: CardDocument) =>
    ipcRenderer.invoke('card-store:rename-card', rootPath, previousUid, card) as Promise<CardRenameResult>,
  deleteCard: (rootPath: string, uid: string, options: CardDeleteOptions) =>
    ipcRenderer.invoke('card-store:delete-card', rootPath, uid, options) as Promise<CardDeleteResult>,
  restoreDeletedCard: (rootPath: string, snapshot: CrashpadDeletedCardSnapshot, options: CardRestoreOptions) =>
    ipcRenderer.invoke('card-store:restore-card', rootPath, snapshot, options) as Promise<CardRestoreResult>,
  setCardStorePath: (rootPath: string, cardStorePath: string) =>
    ipcRenderer.invoke('card-store:set-path', rootPath, cardStorePath) as Promise<VaultDescriptor>,
  setImageDirectories: (rootPath: string, imageDirectories: string[]) =>
    ipcRenderer.invoke('vault:set-image-directories', rootPath, imageDirectories) as Promise<VaultDescriptor>,
  listCrashpads: (rootPath: string) => ipcRenderer.invoke('crashpad:list', rootPath) as Promise<CrashpadSummary[]>,
  openCrashpad: (rootPath: string, crashpadId: string) =>
    ipcRenderer.invoke('crashpad:open', rootPath, crashpadId) as Promise<CrashpadDocument | null>,
  createCrashpad: (rootPath: string, name: string) =>
    ipcRenderer.invoke('crashpad:create', rootPath, name) as Promise<CrashpadDocument>,
  saveCrashpad: (rootPath: string, crashpad: CrashpadDocument) =>
    ipcRenderer.invoke('crashpad:save', rootPath, crashpad) as Promise<CrashpadDocument>,
  getCrashpadDeletePreferences: (rootPath: string) =>
    ipcRenderer.invoke('crashpad:get-delete-preferences', rootPath) as Promise<CrashpadDeletePreferences>,
  setCrashpadDeletePreferences: (rootPath: string, preferences: CrashpadDeletePreferences) =>
    ipcRenderer.invoke('crashpad:set-delete-preferences', rootPath, preferences) as Promise<CrashpadDeletePreferences>,
  generateWeavePlan: (request: WeavePlanRequest) =>
    ipcRenderer.invoke('weave:generate-plan', request) as Promise<WeavePlanResult>,
  checkWeaveProvider: () => ipcRenderer.invoke('weave:health-check') as Promise<WeaveProviderHealth>,
  isStubWeaveProvider: () => ipcRenderer.invoke('weave:is-stub-provider') as Promise<boolean>,
  listWeaveModels: () => ipcRenderer.invoke('weave:list-models') as Promise<WeaveModelInfo[]>,
  getWeaverSettings: () => ipcRenderer.invoke('weave:get-settings') as Promise<WeaverSettings>,
  updateWeaverSettings: (updates: Partial<WeaverSettings>) =>
    ipcRenderer.invoke('weave:update-settings', updates) as Promise<WeaverSettings>,
  setWeaverPreferredModel: (preferredModel: string | null) =>
    ipcRenderer.invoke('weave:set-preferred-model', preferredModel) as Promise<WeaverSettings>,
  getWeaverRequestLogsDirectory: () => ipcRenderer.invoke('weave:get-request-logs-directory') as Promise<string | null>,
  setWeaverRequestLogsDirectory: (directoryPath: string | null) =>
    ipcRenderer.invoke('weave:set-request-logs-directory', directoryPath) as Promise<string | null>,
  setWeaverApiKey: (key: string) => ipcRenderer.invoke('weave:set-api-key', key) as Promise<void>,
  clearWeaverApiKey: () => ipcRenderer.invoke('weave:clear-api-key') as Promise<void>,

  // Weaver progress events (push-based, not invoke)
  onWeavePlanProgress: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('weave:plan-progress', handler);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener('weave:plan-progress', handler);
  },

  // Weaver session history
  listWeaverSessions: (rootPath?: string) => ipcRenderer.invoke('weave:list-sessions', rootPath) as Promise<unknown[]>,
  getWeaverSession: (sessionId: string, rootPath?: string) =>
    ipcRenderer.invoke('weave:get-session', sessionId, rootPath) as Promise<unknown | null>,
  deleteWeaverSession: (sessionId: string, rootPath?: string) =>
    ipcRenderer.invoke('weave:delete-session', sessionId, rootPath) as Promise<boolean>,
  clearWeaverSessions: (rootPath?: string) => ipcRenderer.invoke('weave:clear-sessions', rootPath) as Promise<number>,
  /** Apply a list of Weaver plan operations to the vault. Returns per-operation results. */
  applyWeavePlan: (rootPath: string, operations: WeavePlanOperation[]) =>
    ipcRenderer.invoke('weave:apply-plan', rootPath, operations) as Promise<WeaveApplyResult>,

  // Vault external-change events (push-based, not invoke)
  onVaultExternalChange: (callback: (changedPaths: string[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, paths: string[]) => callback(paths);
    ipcRenderer.on('vault:external-change', handler);
    return () => ipcRenderer.removeListener('vault:external-change', handler);
  },
});

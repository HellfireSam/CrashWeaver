import { contextBridge, ipcRenderer } from 'electron';
import type { VaultDescriptor, VaultNoteDocument, VaultWriteNoteInput, VaultWriteNoteResult } from './vault-contract';

contextBridge.exposeInMainWorld('crashWeaver', {
  selectVaultFolder: () => ipcRenderer.invoke('vault:select-folder') as Promise<string | null>,
  openVault: (rootPath: string) => ipcRenderer.invoke('vault:open', rootPath) as Promise<VaultDescriptor>,
  readNote: (rootPath: string, filePath: string) =>
    ipcRenderer.invoke('vault:read-note', rootPath, filePath) as Promise<VaultNoteDocument>,
  writeNote: (rootPath: string, input: VaultWriteNoteInput) =>
    ipcRenderer.invoke('vault:write-note', rootPath, input) as Promise<VaultWriteNoteResult>,
  updateIndex: (rootPath: string) => ipcRenderer.invoke('vault:update-index', rootPath) as Promise<VaultDescriptor>,
});

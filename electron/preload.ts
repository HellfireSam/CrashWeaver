import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('crashWeaver', {
  selectVaultFolder: () => ipcRenderer.invoke('vault:select-folder') as Promise<string | null>,
});

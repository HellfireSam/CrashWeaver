import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { openVault, readNote, updateIndex, writeNote } from './vaultService';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#f4ede2',
    title: 'CrashWeaver',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

ipcMain.handle('vault:select-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Your Obsidian Vault',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('vault:open', async (_event, rootPath: string) => openVault(rootPath));

ipcMain.handle('vault:read-note', async (_event, rootPath: string, filePath: string) =>
  readNote(rootPath, filePath),
);

ipcMain.handle('vault:write-note', async (_event, rootPath: string, input: { filePath: string; content: string }) =>
  writeNote(rootPath, input),
);

ipcMain.handle('vault:update-index', async (_event, rootPath: string) => updateIndex(rootPath));

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

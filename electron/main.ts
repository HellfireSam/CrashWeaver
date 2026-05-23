import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import { removeNoteReferencesFromCardStore, syncNoteToCardStore } from './cardSyncService';
import { getFsErrorCode } from './utils/fsErrors';
import { toPosixPath } from './utils/paths';
import type {
  CardDeleteOptions,
  CardDocument,
  CardRestoreOptions,
  CrashpadDeletePreferences,
  CrashpadDeletedCardSnapshot,
  CrashpadDocument,
} from './vault-contract';
import {
  createCard,
  createVaultCrashpad,
  deleteCard,
  getVaultCardStore,
  getVaultCrashpadDeletePreferences,
  getVaultImageDirectories,
  listInternalDirectories,
  listCards,
  listVaultCrashpads,
  openCrashpad,
  openVault,
  readNote,
  renameCard,
  restoreDeletedCard,
  saveCard,
  saveCrashpad,
  updateIndex,
  updateVaultCardStore,
  updateVaultCrashpadDeletePreferences,
  updateVaultImageDirectories,
  writeNote,
} from './vaultService';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const LOCAL_ASSET_SCHEME = 'crashweaver-local';
let vaultWatcher: FSWatcher | null = null;
let watchedVaultRoot: string | null = null;
let watchedCardStorePath: string | null = null;
let watcherTimer: NodeJS.Timeout | null = null;
let watcherRestartTimer: NodeJS.Timeout | null = null;
let watcherSessionId = 0;
let pendingNotePaths = new Set<string>();
let watcherFlushPromise: Promise<void> | null = null;
let watchVaultQueue: Promise<void> = Promise.resolve();

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

function isPathWithin(parentPath: string, childPath: string) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function resetWatcherQueue() {
  pendingNotePaths = new Set<string>();

  if (watcherTimer) {
    clearTimeout(watcherTimer);
    watcherTimer = null;
  }
}

function resetWatcherRestart() {
  if (watcherRestartTimer) {
    clearTimeout(watcherRestartTimer);
    watcherRestartTimer = null;
  }
}

function isCurrentWatcherSession(sessionId: number, rootPath: string, cardStorePath: string) {
  return watcherSessionId === sessionId && watchedVaultRoot === rootPath && watchedCardStorePath === cardStorePath;
}

function stopVaultWatcher() {
  vaultWatcher?.close();
  vaultWatcher = null;
  watchedVaultRoot = null;
  watchedCardStorePath = null;
  watcherSessionId += 1;
  watcherFlushPromise = null;
  resetWatcherRestart();
  resetWatcherQueue();
}

function scheduleWatcherFlush(sessionId: number, rootPath: string, cardStorePath: string, delayMs = 250) {
  if (!isCurrentWatcherSession(sessionId, rootPath, cardStorePath)) {
    return;
  }

  if (watcherTimer) {
    clearTimeout(watcherTimer);
  }

  watcherTimer = setTimeout(() => {
    watcherTimer = null;
    void flushWatchedNotes(sessionId, rootPath, cardStorePath);
  }, delayMs);
}

function enqueueWatchVault(rootPath: string) {
  const queued = watchVaultQueue.then(() => watchVault(rootPath));
  watchVaultQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function scheduleWatcherRestart(sessionId: number, rootPath: string, cardStorePath: string) {
  if (watcherRestartTimer || vaultWatcher || !isCurrentWatcherSession(sessionId, rootPath, cardStorePath)) {
    return;
  }

  watcherRestartTimer = setTimeout(() => {
    watcherRestartTimer = null;

    if (vaultWatcher || !isCurrentWatcherSession(sessionId, rootPath, cardStorePath)) {
      return;
    }

    void watchVault(rootPath).catch((error) => {
      console.error('CrashWeaver watcher restart error', error);
    });
  }, 500);
}

async function flushWatchedNotes(sessionId: number, rootPath: string, cardStorePath: string) {
  if (!isCurrentWatcherSession(sessionId, rootPath, cardStorePath)) {
    return;
  }

  if (watcherFlushPromise) {
    return watcherFlushPromise;
  }

  watcherFlushPromise = (async () => {
    while (isCurrentWatcherSession(sessionId, rootPath, cardStorePath)) {
      const notePaths = [...pendingNotePaths];
      resetWatcherQueue();

      if (!notePaths.length) {
        break;
      }

      for (const notePath of notePaths) {
        if (!isCurrentWatcherSession(sessionId, rootPath, cardStorePath)) {
          return;
        }

        const absolutePath = path.resolve(rootPath, notePath);

        try {
          const stats = await fs.stat(absolutePath);

          if (!stats.isFile() || path.extname(absolutePath).toLowerCase() !== '.md') {
            continue;
          }

          const content = await fs.readFile(absolutePath, 'utf8');

          if (!isCurrentWatcherSession(sessionId, rootPath, cardStorePath)) {
            return;
          }

          await syncNoteToCardStore(cardStorePath, notePath, content);
        } catch (error) {
          if (!isCurrentWatcherSession(sessionId, rootPath, cardStorePath)) {
            return;
          }

          const code = getFsErrorCode(error);

          if (code === 'ENOENT') {
            await removeNoteReferencesFromCardStore(cardStorePath, notePath);
            continue;
          }

          console.error('CrashWeaver watcher sync error', error);
        }
      }

      if (!pendingNotePaths.size) {
        break;
      }
    }

    if (isCurrentWatcherSession(sessionId, rootPath, cardStorePath) && pendingNotePaths.size) {
      scheduleWatcherFlush(sessionId, rootPath, cardStorePath, 0);
    }
  })();

  try {
    await watcherFlushPromise;
  } finally {
    watcherFlushPromise = null;
  }
}

async function watchVault(rootPath: string) {
  const resolvedRoot = path.resolve(rootPath);
  const cardStore = await getVaultCardStore(resolvedRoot);

  if (vaultWatcher && watchedVaultRoot === resolvedRoot && watchedCardStorePath === cardStore.cardStorePath) {
    return;
  }

  stopVaultWatcher();
  watchedVaultRoot = resolvedRoot;
  watchedCardStorePath = cardStore.cardStorePath;
  const sessionId = watcherSessionId;
  const nextWatcher = watch(resolvedRoot, { recursive: true }, (_eventType, filename) => {
    if (!filename) {
      return;
    }

    const relativePath = toPosixPath(filename.toString());
    const absolutePath = path.resolve(resolvedRoot, relativePath);

    if (path.extname(absolutePath).toLowerCase() !== '.md') {
      return;
    }

    if (isPathWithin(cardStore.cardStorePath, absolutePath)) {
      return;
    }

    pendingNotePaths.add(relativePath);
    scheduleWatcherFlush(sessionId, resolvedRoot, cardStore.cardStorePath);
  });

  nextWatcher.on('error', (error) => {
    if (!isCurrentWatcherSession(sessionId, resolvedRoot, cardStore.cardStorePath)) {
      return;
    }

    console.error('CrashWeaver watcher error', error);
    nextWatcher.close();

    if (vaultWatcher === nextWatcher) {
      vaultWatcher = null;
    }

    resetWatcherQueue();
    scheduleWatcherRestart(sessionId, resolvedRoot, cardStore.cardStorePath);
  });

  vaultWatcher = nextWatcher;
}

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

function resolveLocalAssetRequestUrl(requestUrl: string) {
  const parsedUrl = new URL(requestUrl);
  const encodedPath = parsedUrl.searchParams.get('path');

  if (!encodedPath) {
    throw new Error('Missing local asset path.');
  }

  const absolutePath = path.resolve(encodedPath);
  const fileUrl = pathToFileURL(absolutePath);
  const resourceQuery = parsedUrl.searchParams.get('resourceQuery');

  if (resourceQuery) {
    fileUrl.search = resourceQuery;
  }

  return fileUrl.toString();
}

function registerLocalAssetProtocol() {
  protocol.handle(LOCAL_ASSET_SCHEME, async (request) => {
    try {
      const assetUrl = resolveLocalAssetRequestUrl(request.url);
      return net.fetch(assetUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load local asset.';
      return new Response(message, { status: 400 });
    }
  });
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

ipcMain.handle('vault:open', async (_event, rootPath: string) => {
  const vault = await openVault(rootPath);
  await enqueueWatchVault(rootPath);
  return vault;
});

ipcMain.handle('vault:read-note', async (_event, rootPath: string, filePath: string) =>
  readNote(rootPath, filePath),
);

ipcMain.handle('vault:write-note', async (_event, rootPath: string, input: { filePath: string; content: string }) => {
  const result = await writeNote(rootPath, input);
  await enqueueWatchVault(rootPath);
  return result;
});

ipcMain.handle('vault:update-index', async (_event, rootPath: string) => {
  const vault = await updateIndex(rootPath);
  await enqueueWatchVault(rootPath);
  return vault;
});

ipcMain.handle('vault:list-internal-directories', async (_event, rootPath: string) => listInternalDirectories(rootPath));

ipcMain.handle('card-store:select-folder', async (_event, rootPath: string) => {
  const config = await getVaultCardStore(rootPath);
  const result = await dialog.showOpenDialog({
    title: 'Select Crash Card Store',
    defaultPath: config.cardStorePath,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('vault:select-image-directories', async (_event, rootPath: string) => {
  const imageDirectories = await getVaultImageDirectories(rootPath);
  const result = await dialog.showOpenDialog({
    title: 'Select Image Directories',
    defaultPath: imageDirectories[0] ?? rootPath,
    properties: ['openDirectory', 'multiSelections', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths;
});

ipcMain.handle('card-store:get-config', async (_event, rootPath: string) => getVaultCardStore(rootPath));

ipcMain.handle('card-store:list-cards', async (_event, rootPath: string) => listCards(rootPath));

ipcMain.handle('card-store:create-card', async (_event, rootPath: string, uid: string) => createCard(rootPath, uid));

ipcMain.handle('card-store:save-card', async (_event, rootPath: string, card: CardDocument) => saveCard(rootPath, card));

ipcMain.handle('card-store:rename-card', async (_event, rootPath: string, previousUid: string, card: CardDocument) =>
  renameCard(rootPath, previousUid, card),
);

ipcMain.handle('card-store:delete-card', async (_event, rootPath: string, uid: string, options: CardDeleteOptions) =>
  deleteCard(rootPath, uid, options),
);

ipcMain.handle(
  'card-store:restore-card',
  async (_event, rootPath: string, snapshot: CrashpadDeletedCardSnapshot, options: CardRestoreOptions) =>
    restoreDeletedCard(rootPath, snapshot, options),
);

ipcMain.handle('card-store:set-path', async (_event, rootPath: string, cardStorePath: string) => {
  const vault = await updateVaultCardStore(rootPath, cardStorePath);
  await enqueueWatchVault(rootPath);
  return vault;
});

ipcMain.handle('vault:set-image-directories', async (_event, rootPath: string, imageDirectories: string[]) => {
  const vault = await updateVaultImageDirectories(rootPath, imageDirectories);
  await enqueueWatchVault(rootPath);
  return vault;
});

ipcMain.handle('crashpad:list', async (_event, rootPath: string) => listVaultCrashpads(rootPath));

ipcMain.handle('crashpad:open', async (_event, rootPath: string, crashpadId: string) => openCrashpad(rootPath, crashpadId));

ipcMain.handle('crashpad:create', async (_event, rootPath: string, name: string) => createVaultCrashpad(rootPath, name));

ipcMain.handle('crashpad:save', async (_event, rootPath: string, crashpad: CrashpadDocument) =>
  saveCrashpad(rootPath, crashpad),
);

ipcMain.handle('crashpad:get-delete-preferences', async (_event, rootPath: string) =>
  getVaultCrashpadDeletePreferences(rootPath),
);

ipcMain.handle('crashpad:set-delete-preferences', async (_event, rootPath: string, preferences: CrashpadDeletePreferences) =>
  updateVaultCrashpadDeletePreferences(rootPath, preferences),
);

app.whenReady().then(() => {
  registerLocalAssetProtocol();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopVaultWatcher();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

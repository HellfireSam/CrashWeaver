import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import { removeNoteReferencesFromCardStore, syncNoteToCardStore } from './cardSyncService';
import {
  checkWeaveProvider,
  generateWeavePlan,
  initializeWeaveProvider,
  isStubProviderActive,
  listWeaveModels,
  setWeaveApiKey,
  clearWeaveApiKey,
  getWeaverSettings,
  updateWeaverSettings,
  setWeaverPreferredModel,
  getConfiguredWeaverRequestLogsDirectory,
  setConfiguredWeaverRequestLogsDirectory,
  listSessions,
  getSession,
  deleteSession,
  clearSessions,
} from './weaver/weaveService';
import { getFsErrorCode } from './utils/fsErrors';
import { toPosixPath } from './utils/paths';
import type {
  CardDeleteOptions,
  CardDocument,
  CardRestoreOptions,
  CrashpadDeletePreferences,
  CrashpadDeletedCardSnapshot,
  CrashpadDocument,
  WeavePlanRequest,
  WeaverSettings,
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

function stopVaultWatcher() {
  vaultWatcher?.close();
  vaultWatcher = null;
  watchedVaultRoot = null;
  watchedCardStorePath = null;
}

/**
 * Handles a single file event from chokidar.
 * chokidar handles debouncing, atomic-write detection, and cross-platform
 * edge cases internally — we just sync the note to the card store.
 */
async function handleWatcherEvent(filePath: string, rootPath: string, cardStorePath: string) {
  const relativePath = toPosixPath(path.relative(rootPath, filePath));
  try {
    const content = await fs.readFile(filePath, 'utf8');
    await syncNoteToCardStore(cardStorePath, relativePath, content);
  } catch (error) {
    const code = getFsErrorCode(error);
    if (code === 'ENOENT') {
      await removeNoteReferencesFromCardStore(cardStorePath, relativePath);
      return;
    }
    console.error('CrashWeaver watcher sync error', error);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Starts (or restarts) a chokidar watcher on the vault root.
 *
 * chokidar uses OS-native recursive watching (FSEvents on macOS,
 * inotify on Linux, ReadDirectoryChangesW on Windows) and handles
 * debouncing via `awaitWriteFinish` — no manual timers or queues needed.
 */
async function watchVault(rootPath: string) {
  const resolvedRoot = path.resolve(rootPath);
  const cardStore = await getVaultCardStore(resolvedRoot);

  if (vaultWatcher && watchedVaultRoot === resolvedRoot && watchedCardStorePath === cardStore.cardStorePath) {
    return;
  }

  stopVaultWatcher();
  watchedVaultRoot = resolvedRoot;
  watchedCardStorePath = cardStore.cardStorePath;

  vaultWatcher = chokidar.watch(resolvedRoot, {
    ignored: [
      /(^|[\\/])\./,                     // dotfiles / dot-directories
      '**/.crashweaver/**',              // internal CrashWeaver metadata
      new RegExp(`^${escapeRegExp(cardStore.cardStorePath)}`), // card store JSON files
    ],
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,           // 300ms after last write before emitting
      pollInterval: 100,
    },
    persistent: true,
    depth: 99,                           // effectively unlimited for practical vaults
  });

  vaultWatcher.on('add',    (filePath: string) => { void handleWatcherEvent(filePath, resolvedRoot, cardStore.cardStorePath); });
  vaultWatcher.on('change', (filePath: string) => { void handleWatcherEvent(filePath, resolvedRoot, cardStore.cardStorePath); });
  vaultWatcher.on('unlink', (filePath: string) => { void handleWatcherEvent(filePath, resolvedRoot, cardStore.cardStorePath); });

  vaultWatcher.on('error', (error: unknown) => {
    console.error('CrashWeaver watcher error', error);
  });
}

function enqueueWatchVault(rootPath: string) {
  return watchVault(rootPath).catch((error) => {
    console.error('CrashWeaver: failed to start vault watcher', error);
  });
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

ipcMain.handle('weave:generate-plan', async (event, request: WeavePlanRequest) => {
  const onProgress = (progressEvent: unknown) => {
    event.sender.send('weave:plan-progress', progressEvent);
  };
  return generateWeavePlan(request, onProgress);
});

ipcMain.handle('weave:health-check', async () => checkWeaveProvider());
ipcMain.handle('weave:list-models', async () => listWeaveModels());
ipcMain.handle('weave:is-stub-provider', async () => isStubProviderActive());

ipcMain.handle('weave:get-settings', async () => getWeaverSettings());

ipcMain.handle('weave:update-settings', async (_event, updates: Partial<WeaverSettings>) =>
  updateWeaverSettings(updates),
);

ipcMain.handle('weave:set-preferred-model', async (_event, preferredModel: string | null) =>
  setWeaverPreferredModel(preferredModel),
);

ipcMain.handle('weave:get-request-logs-directory', async () => getConfiguredWeaverRequestLogsDirectory());

ipcMain.handle('weave:set-request-logs-directory', async (_event, directoryPath: string | null) =>
  setConfiguredWeaverRequestLogsDirectory(directoryPath),
);

ipcMain.handle('weave:set-api-key', async (_event, key: string) => setWeaveApiKey(key));

ipcMain.handle('weave:clear-api-key', async () => clearWeaveApiKey());

ipcMain.handle('weave:list-sessions', async (_event, rootPath?: string) => listSessions(rootPath));

ipcMain.handle('weave:get-session', async (_event, sessionId: string, rootPath?: string) => getSession(sessionId, rootPath));

ipcMain.handle('weave:delete-session', async (_event, sessionId: string, rootPath?: string) => deleteSession(sessionId, rootPath));

ipcMain.handle('weave:clear-sessions', async (_event, rootPath?: string) => clearSessions(rootPath));

ipcMain.handle('crashpad:get-delete-preferences', async (_event, rootPath: string) =>
  getVaultCrashpadDeletePreferences(rootPath),
);

ipcMain.handle('crashpad:set-delete-preferences', async (_event, rootPath: string, preferences: CrashpadDeletePreferences) =>
  updateVaultCrashpadDeletePreferences(rootPath, preferences),
);

app.whenReady().then(() => {
  registerLocalAssetProtocol();
  createMainWindow();
  void initializeWeaveProvider();

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

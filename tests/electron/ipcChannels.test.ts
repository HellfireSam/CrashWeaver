import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);

/**
 * The channels each side of the boundary touched while the compiled main and
 * preload modules were loaded and the preload bridge was exercised.
 */
type RecordedIpcSurface = {
  /** Channels passed to `ipcMain.handle` by `electron/main.ts`. */
  handled: string[];
  /** Channels passed to `ipcRenderer.invoke` by an exposed bridge member. */
  invoked: string[];
  /** Channels passed to `ipcRenderer.on` by an exposed subscription member. */
  subscribed: string[];
};

type ElectronStub = {
  app: {
    whenReady: () => Promise<never>;
    on: () => void;
    getPath: () => string;
    getAppPath: () => string;
    quit: () => void;
  };
  BrowserWindow: new () => unknown;
  dialog: { showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }> };
  ipcMain: { handle: (channel: string) => void; removeHandler: () => void };
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string) => void;
    removeListener: () => void;
  };
  net: { fetch: () => Promise<never> };
  protocol: { registerSchemesAsPrivileged: () => void; handle: () => void };
  contextBridge: { exposeInMainWorld: (name: string, bridge: object) => void };
  safeStorage: {
    isEncryptionAvailable: () => boolean;
    encryptString: () => Buffer;
    decryptString: () => string;
  };
};

type NodeModuleWithLoad = {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};

/**
 * Loads the compiled main and preload modules with a stubbed `electron`, then
 * calls every member the preload exposed so its channels are recorded.
 *
 * `app.whenReady` never resolves on purpose: the module load registers the
 * handlers and the bridge, and the application lifecycle must not run.
 */
function recordIpcSurface(): RecordedIpcSurface {
  const surface: RecordedIpcSurface = { handled: [], invoked: [], subscribed: [] };
  let bridge: Record<string, unknown> | null = null;

  const electronStub: ElectronStub = {
    app: {
      whenReady: () => new Promise<never>(() => {}),
      on: () => {},
      getPath: () => '/tmp/crashweaver-ipc-coverage-test-userData',
      getAppPath: () => '/tmp/crashweaver-ipc-coverage-test-app',
      quit: () => {},
    },
    BrowserWindow: class {
      static getAllWindows(): unknown[] {
        return [];
      }
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    ipcMain: {
      handle: (channel: string) => surface.handled.push(channel),
      removeHandler: () => {},
    },
    ipcRenderer: {
      invoke: (channel: string) => {
        surface.invoked.push(channel);
        return Promise.resolve(null);
      },
      on: (channel: string) => surface.subscribed.push(channel),
      removeListener: () => {},
    },
    net: {
      fetch: async () => {
        throw new Error('The IPC coverage suite must not reach the network.');
      },
    },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
    contextBridge: {
      exposeInMainWorld: (_name: string, exposedBridge: object) => {
        bridge = exposedBridge as Record<string, unknown>;
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(''),
      decryptString: () => '',
    },
  };

  const nodeModule = require('node:module') as unknown as NodeModuleWithLoad;
  const originalLoad = nodeModule._load;
  nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(nodeModule, request, parent, isMain);
  };

  try {
    require('../../dist-electron/main.js');
    require('../../dist-electron/preload.js');
  } finally {
    nodeModule._load = originalLoad;
  }

  if (!bridge) {
    throw new Error('The preload module did not expose a bridge object.');
  }

  const exposedBridge: Record<string, unknown> = bridge;

  for (const [memberName, member] of Object.entries(exposedBridge)) {
    if (typeof member !== 'function') continue;

    if (memberName.startsWith('on')) {
      // Subscription members take the caller's listener and attach it.
      member(() => {});
    } else {
      // Request members forward their arguments; the stubbed invoke ignores them.
      member();
    }
  }

  return surface;
}

const { IPC_CHANNELS } = require('../../dist-electron/ipcChannels.js') as {
  IPC_CHANNELS: Record<string, Record<string, string>>;
};

/** Every request/response channel declared for the two processes. */
const declaredRequestChannels = Object.entries(IPC_CHANNELS)
  .filter(([area]) => area !== 'events')
  .flatMap(([, channels]) => Object.values(channels));

/** The push channels main sends and the preload subscribes to. */
const declaredEventChannels = Object.values(IPC_CHANNELS.events);

/** Sorted, de-duplicated view so a diff names the channel that drifted. */
function channelSet(channels: readonly string[]): string[] {
  return [...new Set(channels)].sort();
}

/** Channels in `left` that are absent from `right`. */
function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return channelSet(left.filter((channel) => !rightSet.has(channel)));
}

describe('IPC channel inventory', () => {
  const surface = recordIpcSurface();

  it('every channel the preload invokes has a registered main-process handler', () => {
    expect(difference(surface.invoked, surface.handled)).toEqual([]);
  });

  it('every registered main-process handler is exposed by the preload', () => {
    expect(difference(surface.handled, surface.invoked)).toEqual([]);
  });

  it('every declared request/response channel is realised by both sides', () => {
    expect(channelSet(surface.invoked)).toEqual(channelSet(declaredRequestChannels));
  });

  it('the preload subscribes to every declared event channel', () => {
    expect(channelSet(surface.subscribed)).toEqual(channelSet(declaredEventChannels));
  });
});

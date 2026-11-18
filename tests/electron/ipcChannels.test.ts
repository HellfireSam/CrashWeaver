import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

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

/**
 * Only the `electron` surface the module load and the bridge exercise touch.
 * The application lifecycle is not run (`app.whenReady` never settles), so the
 * window, dialog and storage members those paths would need are absent.
 */
type ElectronStub = {
  app: { whenReady: () => Promise<never>; on: () => void };
  ipcMain: { handle: (channel: string) => void };
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    on: (channel: string) => void;
    removeListener: () => void;
  };
  protocol: { registerSchemesAsPrivileged: () => void };
  contextBridge: { exposeInMainWorld: (name: string, bridge: object) => void };
};

type NodeModuleWithLoad = {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};

/**
 * Loads the compiled main and preload modules with a stubbed `electron`, then
 * calls every member the preload exposed so its channels are recorded.
 *
 * Stubbing `electron` is necessary rather than convenient: under plain Node its
 * module resolves to the path of the Electron binary, so the two entry modules
 * cannot load for real. The stub records the channels instead of crossing the
 * process boundary, and `app.whenReady` never resolves so the application
 * lifecycle does not run.
 */
function recordIpcSurface(): RecordedIpcSurface {
  const surface: RecordedIpcSurface = { handled: [], invoked: [], subscribed: [] };
  let bridge: Record<string, unknown> | null = null;

  const electronStub: ElectronStub = {
    app: {
      whenReady: () => new Promise<never>(() => {}),
      on: () => {},
    },
    ipcMain: {
      handle: (channel: string) => surface.handled.push(channel),
    },
    ipcRenderer: {
      invoke: (channel: string) => {
        surface.invoked.push(channel);
        return Promise.resolve(null);
      },
      on: (channel: string) => surface.subscribed.push(channel),
      removeListener: () => {},
    },
    protocol: { registerSchemesAsPrivileged: () => {} },
    contextBridge: {
      exposeInMainWorld: (_name: string, exposedBridge: object) => {
        bridge = exposedBridge as Record<string, unknown>;
      },
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

  for (const member of Object.values(exposedBridge)) {
    if (typeof member !== 'function') continue;
    // Request members forward their arguments to the stubbed `invoke`, which
    // ignores them; subscription members attach a listener whose callback the
    // stubbed `on` never calls. Both can be exercised with no arguments.
    member();
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

describe('the IPC channel inventory', () => {
  let surface: RecordedIpcSurface;

  beforeAll(() => {
    surface = recordIpcSurface();
  });

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

  it('the assertion reports a channel whose handler was removed', () => {
    // The positive assertions only fail if this difference detects a missing
    // handler, so the negative control proves the comparison does.
    const handledWithoutOne = surface.handled.filter(
      (channel) => channel !== 'weave:generate-plan',
    );

    expect(difference(surface.invoked, handledWithoutOne)).toEqual(['weave:generate-plan']);
  });
});

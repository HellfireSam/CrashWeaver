# Process model and IPC

CrashWeaver is an Electron application split across three processes. The main process owns
every filesystem touch, the Vault and the Card store included. The renderer is a React
application with no Node access. The preload script is the only code that runs in both worlds,
and it exposes exactly one object to the renderer: `window.crashWeaver`. The Vault's on-disk
shape is in [the data model](./data-model.md); the Weaver's own flow is in
[the weave pipeline](./weave-pipeline.md).

## The three processes

| Process  | Entry point                               | Runs as                                          | Owns                                                                                                                                   |
| -------- | ----------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `electron/main.ts`                        | CommonJS, compiled to `dist-electron/main.js`    | Window lifecycle, native dialogs, the Vault and Card store services, settings persistence, the Weaver pipeline, the filesystem watcher |
| Preload  | `electron/preload.ts`                     | CommonJS, compiled to `dist-electron/preload.js` | The `window.crashWeaver` object: one member per main-process channel                                                                   |
| Renderer | `src/main.tsx`, mounted into `index.html` | ES modules bundled by Vite into `dist/`          | All UI and interaction, all in-memory application state                                                                                |

### Main process

`electron/main.ts` is the composition root: it imports the Vault service functions
(`electron/vaultService.ts`), the note-to-Card-store sync (`electron/cardSyncService.ts`) and the
Weaver services under `electron/weaver/`, and wires them to `app`, `BrowserWindow`, `dialog`,
`ipcMain`, `net` and `protocol`. Settings persistence is reached through the Vault and Weaver
services, which import `electron/settingsService.ts`. `app.whenReady()` calls
`registerLocalAssetProtocol()`, `createMainWindow()` and `initializeWeaverProvider()`; the
`activate` event recreates the window when none exist; `window-all-closed` calls
`stopVaultWatcher()` and quits unless the platform is `darwin`.

`createMainWindow()` builds one `BrowserWindow` with fixed geometry: width 1320, height 860,
minimum 1080 by 720, a `#f4ede2` background colour and the title `CrashWeaver`. Its
`webPreferences` set exactly three things: `preload` to `path.join(__dirname, 'preload.js')`
(the compiled script in `dist-electron/`, beside `main.js`), `contextIsolation: true`, and
`nodeIntegration: false`, so the renderer has no `require`, `process` or Node globals.

`isDev` is `Boolean(process.env.VITE_DEV_SERVER_URL)`. When it is set the window calls
`loadURL(process.env.VITE_DEV_SERVER_URL)`; otherwise it calls
`loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))`. Nothing else differs between the
two paths.

### Preload

`electron/preload.ts` builds one object, `crashWeaverBridge`, and calls
`contextBridge.exposeInMainWorld('crashWeaver', crashWeaverBridge)` once with it. Its members are
request/response wrappers, each a single `ipcRenderer.invoke(IPC_CHANNELS.<area>.<name>, ...)` call
cast to a contract type where the payload is a contract shape. Two further members subscribe to
push events: `onWeavePlanProgress` and `onVaultExternalChange` attach an `ipcRenderer.on` listener,
adapt the Electron event argument away, and return an unsubscribe closure that calls
`ipcRenderer.removeListener`. The preload script imports `electron` and the channel declaration at
runtime, and the shared contract only as types; it also exports `CrashWeaverBridge`, which is
`typeof crashWeaverBridge`.

### Renderer

`index.html` contains a single `#root` element and loads `src/main.tsx` as a module. That entry
mounts `React.StrictMode` around `ErrorBoundary`, then `AppStateProvider`, then `App`, and
imports the stylesheet. Non-test renderer code imports neither `electron` nor any `node:`
module; every Vault, Card store, Crashpad and Weaver effect goes through `window.crashWeaver`.

## The shared contract

`electron/vault-contract.ts` is the single type surface both sides import. It has no imports of
its own, every export is an `interface` or a `type`, and every import site on both sides uses
`import type`. It adds no runtime dependency to the Vite bundle, though `tsc` still emits an empty
`dist-electron/vault-contract.js` because the file is in the electron project's include set; both
TypeScript projects compile the same file. The contract holds shapes, not behaviour and not
channel names — the channel names have their own declaration in `electron/ipcChannels.ts`. The
table groups the shapes by what they describe:

| Group                                | Representative exports                                                                                                                                                                                                            | Who uses it                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Crash Card payload and review state  | `CardDocument`, `CardMetadata`, `CardMemoryTricks`, `CardQaPair`, `CardNoteReference`, `ReviewMetadata`                                                                                                                           | Main persists it; renderer renders it                                   |
| UID boundary parsing and Diagnostics | `ParsedCrashCard`, `ParsedCrashCardsNote`, `CardParseDiagnostic`                                                                                                                                                                  | Main produces Diagnostics; renderer displays them                       |
| Vault                                | `VaultDescriptor`, `VaultNoteSummary`, `VaultNoteDocument`, `VaultIndex`, `VaultIndexEntry`, `VaultWriteNoteInput`, `VaultWriteNoteResult`                                                                                        | Returned by `vault:*` channels; the descriptor lives in `VaultContext`  |
| Crashpad                             | `CrashpadDocument`, `CrashpadSummary`, `CrashpadCardEntry`, `CrashpadDeletedCardSnapshot`, `CrashpadDeletePreferences`                                                                                                            | Main persists; renderer authors and restores                            |
| Weaver requests, plans and results   | `WeaveKind`, `WeaveStrength`, `GuidedInsertPermissions`, `WeavePlanRequest`, `WeavePlan`, `WeaveReActStep`, `WeavePlanResult`, `WeaverProviderHealth`, `WeaverModelInfo`, `WeaveApplyResult`, `WeaverSettings`, `WeaverKeyStatus` | Renderer submits a request and reviews a plan; main runs and applies it |
| Weave operation kinds and payloads   | `WeavePlanOperationKind`, the `*Payload` interfaces and the matching `*Operation` aliases, the `WeavePlanOperation` union                                                                                                         | Both sides: a `WeavePlanOperation[]` is posted to `weave:apply-plan`    |

A sweep of the module's exports after #14/#15 found six types referenced only inside the module —
`CardParseDiagnosticCode`, `WeaverProviderName`, the two request interfaces and the two plan
interfaces — which are now module-private, while the ten operation aliases the original sweep
listed are imported by the split apply handlers. The table above is the remaining export surface.

Ownership follows the shapes. Main owns the behaviour behind them: it reads and writes the
Vault, validates paths, persists the Card store and settings, and calls the provider. Preload
owns nothing but forwarding. The renderer owns its own presentation types — `CardViewRecord`
and `CardScope` in `src/lib/cards.ts`, `CrashpadHistoryEntry` in `src/lib/crashpadHistory.ts` —
and borrows contract types for anything that arrives over IPC. Some contract types never appear
in a handler signature, so the module is a shared vocabulary rather than a strict manifest of
what is on the wire.

## The IPC model

### The channel declaration

`electron/ipcChannels.ts` declares every request/response and event channel exactly once. The
names are a nested `as const` object, so every value is a string-literal type and the file holds
no behaviour at all; they are grouped by area (`vault`, `cardStore`, `crashpad`, `weaver` for the
agent's provider, model, settings, key and session channels, `weave` for the two channels of one
run, and an `events` group for the two push channels). It is the only home for a channel string:
`electron/main.ts` registers with `ipcMain.handle(IPC_CHANNELS.<area>.<name>, handler)` and
`electron/preload.ts` invokes and subscribes with the same values, so a renamed channel is one
edit and the two sides cannot spell it differently. The declaration imports nothing and is not
part of the shared type contract, which stays type-only.

### Request and response

The request/response channels are registered as `ipcMain.handle(IPC_CHANNELS.<area>.<name>, handler)`
calls at module scope in `electron/main.ts`, so they exist before `app.whenReady()` resolves.
Each handler returns a value or a promise of one, which becomes the resolved value of the
matching `ipcRenderer.invoke` in the renderer; a thrown error rejects that promise.

| Area          | Examples                                                                                                                                                                                                                                                                                                                                                                      | Backed by                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `vault:`      | `vault:select-folder`, `vault:open`, `vault:read-note`, `vault:write-note`, `vault:update-index`, `vault:list-internal-directories`, `vault:select-image-directories`, `vault:set-image-directories`                                                                                                                                                                          | `vaultService`, `dialog`            |
| `card-store:` | `card-store:select-folder`, `card-store:get-config`, `card-store:list-cards`, `card-store:create-card`, `card-store:save-card`, `card-store:rename-card`, `card-store:delete-card`, `card-store:restore-card`, `card-store:set-path`                                                                                                                                          | `vaultService`, `settingsService`   |
| `crashpad:`   | `crashpad:list`, `crashpad:open`, `crashpad:create`, `crashpad:save`, `crashpad:get-delete-preferences`, `crashpad:set-delete-preferences`                                                                                                                                                                                                                                    | `vaultService`, `settingsService`   |
| `weaver:`     | `weaver:health-check`, `weaver:is-stub-provider`, `weaver:list-models`, `weaver:get-settings`, `weaver:update-settings`, `weaver:set-preferred-model`, `weaver:get-request-logs-directory`, `weaver:set-request-logs-directory`, `weaver:set-api-key`, `weaver:clear-api-key`, `weaver:list-sessions`, `weaver:get-session`, `weaver:delete-session`, `weaver:clear-sessions` | `weaveService`, `settingsService`   |
| `weave:`      | `weave:generate-plan`, `weave:apply-plan`                                                                                                                                                                                                                                                                                                                                     | `weaveService`, `weaveApplyService` |

The picker channels (`vault:select-folder`, `card-store:select-folder`,
`vault:select-image-directories`) are the only ones that open native dialogs; they return `null`
when the user cancels, and callers treat `null` as "no change". Handlers that can change the
Vault's shape (`vault:open`, `vault:write-note`, `vault:update-index`, `card-store:set-path`,
`vault:set-image-directories`, `weave:apply-plan`) also call `enqueueWatchVault(rootPath)`
before returning, so the watcher reflects the current root and Card store path.

The channel area is the naming standard's Weaver/weave rule applied to the boundary: agent concerns
use `weaver:`, and `weave:` covers one run — plan generation, the apply step, and the progress event
of that run. The two push channels keep their areas for the same reason: `weave:plan-progress` is a
run event and `vault:external-change` is a vault event, so neither is an agent concern. The
inventory is asserted at runtime under
[typing across the boundary](#typing-across-the-boundary), not just by the compiler; the area rule
itself is a review convention, because a declared channel and its area move together in the
declaration.

### Push channels

The two push channels are declared in the same place, under `IPC_CHANNELS.events`.

| Channel                 | Sent from                                                                 | Trigger                                                                        |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `weave:plan-progress`   | the `weave:generate-plan` handler, via `event.sender.send`                | The callback that handler passes into `generateWeavePlan(request, onProgress)` |
| `vault:external-change` | `flushWatcherNotifications()`, via `win.webContents.send` to every window | A debounced batch of externally changed Note paths from the watcher            |

### Typing across the boundary

The channel names are typed, not repeated: both sides read `electron/ipcChannels.ts`, so a channel
cannot be renamed on one side only. The payload types remain contract declarations.
`electron/main.ts` annotates each handler's parameters inline (`rootPath: string`,
`card: CardDocument`); `electron/preload.ts` asserts each result with `as Promise<T>`, where `T` is
imported from the contract — `ipcRenderer.invoke` returns `Promise<any>`, so the cast is a
declaration, not a runtime check.

The renderer's view of the bridge is not written by hand either. `electron/preload.ts` exports
`CrashWeaverBridge = typeof crashWeaverBridge`, and `src/vite-env.d.ts` imports that type and
declares `Window.crashWeaver` from it. Renaming a member of the exposed object, or changing its
signature, is therefore a compile error in the renderer; a payload change is caught by the contract
type on both sides; and a channel rename is a single edit in the declaration.

What the compiler still cannot see is whether a channel has a registered handler on the main side,
or whether a call site passed a different _declared_ key (`ipcRenderer.invoke` and `ipcMain.handle`
accept any string, so a wrong-key selection compiles and hangs). The first gap is now asserted at
runtime: `tests/electron/ipcChannels.test.ts` loads the compiled `main.js` and `preload.js` with a
stubbed `electron` module, calls every member of the exposed bridge, and compares the recorded
channel sets with the declaration. Every channel the preload invokes must have a registered
handler, every registered handler must be exposed, every declared request/response channel must be
realised by both sides, and the preload must subscribe to both declared event channels. Removing a
handler fails the suite; a wrong _declared_ key at a call site still compiles, because the suite can
only see the channel names the two sides actually pass. Errors surface by rejection:
`useWeaverController` normalises Weaver errors by stripping Electron's wrapper with a regex matching
`Error invoking remote method '<channel>': Error: <message>`.

## Renderer architecture

### The renderer composition root

`src/App.tsx` is the composition root, not the largest renderer file any more. It destructures the
vault, editor and UI contexts, keeps `useRef` handles for DOM nodes and current-value mirrors,
projects the
card surface through the pure `projectCards` in `src/lib/cardProjection.ts`, computes the shell
layout style with `computeLayoutStyle` in `src/lib/layout.ts`, calls the hook layer, and composes
the three shell pieces:

- `src/components/AppChrome.tsx` — the floating window utility strip, the widget rail and the
  layout grid the surfaces sit in.
- `src/components/EditorSurface.tsx` — the editor tab strip, view-mode and card-scope controls,
  the source, preview, cards and Crashpad surfaces, and the status bar.
- `src/hooks/useWeaverController.ts` — the Weaver controller: composer state and its effects,
  provider health, plan generation, apply with the destructive-operation confirmation gate,
  session history and Weaver settings writes. `App.tsx` spreads the controller's `inspectorProps`
  and `settingsProps` into `InspectorPane` and `SettingsModal`, so those components' prop
  interfaces did not change.

The root still owns the editor, vault and card hooks shared between the surfaces, the
external-change subscription, and the state projections both `EditorSurface` and `InspectorPane`
need.

### The four state contexts

`src/state/AppStateProvider.tsx` composes the providers in a fixed order — `VaultStateProvider`,
`EditorStateProvider`, `WeaverStateProvider`, `UIStateProvider`. `src/state/index.ts` re-exports
the providers, hooks and types.

| Context | File                          | State it owns                                                                                                                                                                                                                        | Hook                                                              |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Vault   | `src/state/VaultContext.tsx`  | `vaultPath`, the `vault` descriptor, `vaultAlias`, `allCards`, `internalDirectories`, `crashpadSummaries`, `activeCrashpad`, `crashpadDeletePreferences`                                                                             | `useVaultState`, plus `useVaultStateValues` for values-only memos |
| Editor  | `src/state/EditorContext.tsx` | `activeEditorKind` (`markdown`, `crashpad`, `card`), active card and Note paths, `draftPath`/`draftContent`/`savedContent`, `activeNote`, `viewMode`, `cardScope`, loading flags, `statusMessage`, `errorMessage`, `editorFontSize`  | `useEditorState`, plus `clearEditorState` for a Vault close       |
| Weaver  | `src/state/WeaverContext.tsx` | `weaveKind`, `weaveStrength`, guided-insert permissions, `weaveIntent`, `weaverModel`, `weavePlanResult`, `weaverProviderHealth`, `weaverSettings`, `weaverSessions`, `weaveApplyResult`, apply errors and in-flight flags           | `useWeaverState`                                                  |
| UI      | `src/state/UIContext.tsx`     | `expandedFolders`, `activeSidebarTab`, sidebar and Inspector visibility, `isSettingsOpen`, `openFirstNoteOnVaultOpen`, `showHiddenEntries`, `focusedCardUid`, `focusedWindow`, `activeWidgetTool`, the Crashpad undo and redo stacks | `useUIState`, plus `pushCrashpadHistory`                          |

All four are in-memory only; durable state lives in the Vault or in the main-process settings
document.

### Hooks, components and pure helpers

`src/hooks/` turns context setters and refs into callbacks, and it is where most
`window.crashWeaver` calls happen: Vault lifecycle and catalogs in `useVaultLifecycleActions`,
`useVaultLoadActions` and `useVaultCatalogActions`; editing and saving in
`useEditorDocumentActions`, `useNoteSaveActions`, `useEditorTabs`, `useEditorTabViewState`,
`useStoredScrollSync` and `useHorizontalWheelScroll`; Crashpad work in `useCrashpadActions`,
`useCrashpadCardEditor`, `useCrashpadCardMutationActions`, `useCrashpadHistoryActions` and
`useDailyCrashpadActions`; cards in `useCardDetailState` and `useCardRenameActions`; UI in
`useAppUiInteractions`, `useSidebarActions` and `usePaneLayout`; the Weaver controller in
`useWeaverController`. Most take their dependencies as an options object and return callbacks;
`App.tsx` supplies the context setters. The Weaver controller is the exception: it reads the state
contexts itself and takes only the catalogue refreshes, the active-editor flag, the focused
Crashpad card and the editor ref from the root.

`src/components/` holds the renderer components: `AppSidebar` (explorer and Vault info tabs, built with
`buildExplorerTree` and the virtualised `ExplorerTree`), the authoring and inspection surfaces
`CardsWorkspace`, `CrashpadWorkspace`, `CardMetadataPanel` and `InspectorPane`, `SettingsModal`,
and the Weaver surfaces `WeaverProposalPanel`, `WeaverCardChip`, `WeaverProgressFeed`,
`WeaverOperationItem`, `WeaverDiffPreview`, `WeaverUnifiedDiffModal`, `WeaverConfirmDialog` and
`WeaverSessionHistory`. A few components call `window.crashWeaver` directly rather than going
through `App.tsx`: `WeaverProposalPanel` uses `isStubWeaverProvider`, `listWeaverModels` and
`onWeavePlanProgress`, `WeaverSessionHistory` uses `getWeaverSession`, and
`WeaverUnifiedDiffModal` uses `readNote`. `src/components/WeaverCardChip.test.tsx` is the first
component suite: it runs under jsdom and asserts the card chip's rendered title and tooltip,
because CSS line clamping is not unit-testable.

`src/lib/` holds the pure helpers — `cardProjection.ts`, `cards.ts`, `crashpadHistory.ts`,
`crashpadStatus.ts`, `editorPaths.ts`, `errorUtils.ts`, `explorerTree.ts`, `layout.ts`,
`markdownPreview.ts`, `stateUtils.ts` — with no React state and no IPC. Vitest suites sit beside
`cardProjection.ts`, `crashpadStatus.ts`, `editorPaths.ts`, `layout.ts` and
`markdownPreview.ts`.

### Error boundaries

`src/components/ErrorBoundary.tsx` is a class component with `static getDerivedStateFromError`
and `componentDidCatch`, which logs the error message and component stack. It accepts an
optional `fallback(error, onReset)` prop; without one it renders `AppErrorFallback`, which shows
the message with a Reload button wired to the boundary's reset and a Copy details button. The
boundary is mounted once, in `src/main.tsx`, wrapping `AppStateProvider`, so a render error
anywhere in the tree replaces the application shell instead of leaving an empty window. It does
not catch errors in event handlers or async code; hooks such as `useNoteSaveActions` catch those
and store the message in the editor context's `errorMessage` via `getErrorMessage` from
`src/lib/errorUtils.ts`.

## Settings and persistence

`electron/settingsService.ts` is main-process only. It persists one JSON document named
`crashweaver-settings.json` in `app.getPath('userData')`, shaped by the internal
`PersistedSettings` interface with `version: 1`.

| Persisted key                                                                                                 | Scope                                                                                                                              | Written by                                                                         | Read back by                                         |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `cardStoreByVault`                                                                                            | Per Vault, keyed by `path.resolve(rootPath)`; the default is `.crashweaver/cards` inside the Vault, from `getDefaultCardStorePath` | `setCardStorePath`                                                                 | `getCardStoreConfig`                                 |
| `imageDirectoriesByVault`                                                                                     | Per Vault, same keying                                                                                                             | `setImageDirectories`                                                              | `getImageDirectories`                                |
| `crashpadDeletePreferences`                                                                                   | Global                                                                                                                             | `setCrashpadDeletePreferences`                                                     | `getCrashpadDeletePreferences`                       |
| `openrouterApiKeyEncrypted`                                                                                   | Global                                                                                                                             | `setOpenRouterApiKey`, `clearOpenRouterApiKey`                                     | `getOpenRouterApiKeyDecrypted`                       |
| `weaverPreferredModel`, `weaverRequestLogsDirectory`, `weaverDisableBudgetRestrictions` and the budget fields | Global                                                                                                                             | `setWeaverPreferredModel`, `setWeaverRequestLogsDirectory`, `updateWeaverSettings` | `getWeaverSettings`, `getWeaverRequestLogsDirectory` |

`readSettings()` re-validates every field as it parses: wrong-typed values become `undefined`,
string arrays are filtered by `toStringArray`, the preferred-model string is trimmed by
`normalizePreferredModel`, the request-log-directory string is trimmed and resolved by
`normalizeLogDirectory`, and the three `crashpadDeletePreferences` booleans are coerced with
`!== false`. Directory lists are not normalised here: `normalizeDirectoryList` trims, resolves and
de-duplicates them on write in `setImageDirectories`. A missing or unreadable file falls back to
`createDefaultSettings()`, which seeds all three delete preferences to `true`. Writes go through
`mutateSettings`, which chains each read-modify-write onto `settingsMutationQueue` so concurrent
callers cannot clobber one another, then through
`writeJsonAtomically` from `electron/utils/jsonFile.ts`: a temp file plus `rename`, with a
backup-and-restore fallback for the Windows case where the target exists.
`tests/electron/settingsService.test.ts` drives the compiled `dist-electron/settingsService.js`
through the `__setSettingsFilePathForTests` and `__resetSettingsMutationQueueForTests` seams and
asserts per-key persistence and mutation serialization against the settings file.

The "bounds" in this service are numeric bounds on the Weaver budget settings, not window
geometry. `WEAVER_BUDGET_BOUNDS` fixes four categories — tokens (100 to 32 000), timeouts
(5 000 to 600 000 ms), ReAct iterations (1 to 20) and operation counts (1 to 20) — and
`WEAVER_BUDGET_FIELD_REGISTRY` maps each budget field from its snake_case persisted
key to its camelCase `WeaverSettings` response key and bound category. `updateWeaverSettings`
validates each supplied value with `normalizeBoundedNumber`, which rejects non-finite or
out-of-range numbers with a thrown `Error` and truncates fractions, so a rejected value rejects
the `weaver:update-settings` invoke and surfaces in the renderer as an error message. The registry
is the one place to add a budget knob, because `readSettings`, `buildWeaverSettingsResponse` and
`updateWeaverSettings` all loop over it.

The OpenRouter API key never crosses the boundary: `encryptApiKey` stores it through
`safeStorage.encryptString` as base64, falling back to a `plain:`-prefixed value with a logged
security warning when OS encryption is unavailable, and the renderer sees only
`WeaverSettings.configured`, a boolean derived from whether a stored key exists.

The renderer reads settings as part of a `VaultDescriptor` (`cardStore`, `imageDirectories`)
returned by `vault:open` and `vault:update-index`, and through `card-store:get-config`,
`crashpad:get-delete-preferences` and `weaver:get-settings`. It writes through
`card-store:set-path`, `vault:set-image-directories`, `crashpad:set-delete-preferences`,
`weaver:update-settings`, `weaver:set-preferred-model`, `weaver:set-api-key` and
`weaver:clear-api-key`. The settings writes return the refreshed state — the two API-key channels
return nothing — and the caller stores that value in context; `handleUpdateWeaverSettings` in
`src/hooks/useWeaverController.ts` is one example. The controller also loads `getWeaverSettings` once on mount and syncs
`weaverModel` from `preferredModel`.

The window opens at 1320 by 860 every time. No code persists or restores window size or position;
geometry is fixed at creation and not remembered across launches.

## Build and module resolution

| Project                  | Covers                                                                    | Module and resolution                                                     | Emits                   |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------- |
| `tsconfig.json`          | Solution only: `"files": []` with references to the app and node projects | —                                                                         | Nothing                 |
| `tsconfig.app.json`      | `src`                                                                     | `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit` | Vite bundles to `dist/` |
| `tsconfig.node.json`     | `vite.config.ts`                                                          | `module: ESNext`, `moduleResolution: bundler`, `noEmit`                   | Nothing                 |
| `tsconfig.electron.json` | `electron/**/*.ts`                                                        | `module: CommonJS`, `moduleResolution: Node`, `rootDir: electron`         | `dist-electron/`        |

`tsconfig.electron.json` sits deliberately outside the solution file, because that project emits
a CommonJS build while the app and node projects are `noEmit`. `npm run typecheck` runs `tsc -b`
over the solution and then `tsc -p tsconfig.electron.json --noEmit` separately;
[the development setup guide](../guides/development-setup.md) lists the commands.

The CommonJS target is what Electron loads. `package.json` sets
`"main": "dist-electron/main.js"` and declares no `"type": "module"`, so `main.js` and
`preload.js` — both emitted flat into `dist-electron/` by `rootDir: electron` — load as
CommonJS, and the Vitest suites in `tests/electron/` `require` compiled modules directly,
as in `require('../../dist-electron/settingsService.js')`. `vite.config.ts` sets `base: './'` so
the built `dist/index.html` works when main loads it over `file://`, with `build.outDir: 'dist'`
and a dev server pinned to `127.0.0.1:5173` by `strictPort`.

## Filesystem watching

`watchVault(rootPath)` in `electron/main.ts` starts a chokidar watcher on the resolved Vault
root. It first reads the current Card store path with `getVaultCardStore`, and returns early if a
watcher is already running for the same root and Card store path; otherwise it calls
`stopVaultWatcher()` and re-creates the watcher. The watched set ignores dotfiles and
dot-directories, the Vault's `.crashweaver` internal directory, and the Card store path itself,
with `ignoreInitial: true`, `persistent: true`, `depth: 99`, and `awaitWriteFinish` set to a
300 ms stability threshold with a 100 ms poll interval.

`add`, `change` and `unlink` events all call `handleWatcherEvent`, which converts the path to a
POSIX-style path relative to the Vault root, reads the file, and calls
`syncNoteToCardStore(cardStorePath, relativePath, content)` so the Card store's references
follow Notes edited outside the app. An `ENOENT` instead calls `removeNoteReferencesFromCardStore`
— the Note is gone, so its references are dropped — and still notifies the renderer so the file
tree can drop it. The path is then added to `pendingChangedPaths` and a flush is scheduled.

`scheduleWatcherFlush` debounces for `EXTERNAL_CHANGE_FLUSH_MS` (500 ms), after which
`flushWatcherNotifications` sends the accumulated relative paths on `vault:external-change` to
every non-destroyed window. That drives the renderer: `App.tsx` subscribes with
`onVaultExternalChange`, then re-runs `updateIndex`, `listCards`, `listInternalDirectories` and
the Crashpad catalog refresh, so an external edit updates the explorer, the card lists and the
Crashpad summaries without a manual refresh. Errors are logged and each event is handled
fire-and-forget with `void`. `stopVaultWatcher()` closes the watcher, clears the debounce timer
and empties the pending path set; it runs on `window-all-closed` and before any restart.

## Boundaries at a glance

| Boundary                          | Direction                             | Files                                                                                        | Mechanism                                                                                                         |
| --------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Renderer to preload               | Renderer calls `window.crashWeaver.*` | declared in `src/vite-env.d.ts`, implemented in `electron/preload.ts`                        | `contextBridge.exposeInMainWorld`                                                                                 |
| Preload to main, request/response | Renderer method call to handler       | `electron/preload.ts` to `electron/main.ts`                                                  | `ipcRenderer.invoke` and `ipcMain.handle` on `<area>:<verb>` channels                                             |
| Main to renderer, push            | Progress and external-change events   | `electron/main.ts` to `electron/preload.ts` to `App.tsx` and `WeaverProposalPanel`           | `webContents.send` / `event.sender.send`, `ipcRenderer.on`, unsubscribe closures                                  |
| Shared types                      | Both directions                       | `electron/vault-contract.ts`                                                                 | Type-only imports on both sides                                                                                   |
| Renderer composition              | Within the renderer                   | `src/main.tsx` to `src/App.tsx` to `src/state/`, `src/hooks/`, `src/components/`, `src/lib/` | React contexts, hooks, `ErrorBoundary`                                                                            |
| Settings                          | Main only, surfaced over channels     | `electron/settingsService.ts`                                                                | `crashweaver-settings.json` in `app.getPath('userData')`, written atomically through `electron/utils/jsonFile.ts` |
| Watcher                           | Main to Card store and renderer       | `electron/main.ts`                                                                           | chokidar on the Vault root, debounced `vault:external-change`                                                     |

See [the data model](./data-model.md) for the Vault's on-disk layout,
[the weave pipeline](./weave-pipeline.md) for what happens between `weave:generate-plan` and
`weave:apply-plan`, and [the development setup guide](../guides/development-setup.md) for the
commands.

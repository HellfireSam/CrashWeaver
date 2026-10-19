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
`registerLocalAssetProtocol()`, `createMainWindow()` and `initializeWeaveProvider()`; the
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

`electron/preload.ts` calls `contextBridge.exposeInMainWorld('crashWeaver', {...})` once with an
object whose members are request/response wrappers, each a single
`ipcRenderer.invoke('<area>:<verb>', ...)` call, cast to a contract type where the payload is a
contract shape. Two further members subscribe to push events: `onWeavePlanProgress` and
`onVaultExternalChange` attach an `ipcRenderer.on` listener, adapt the Electron event argument
away, and return an unsubscribe closure that calls `ipcRenderer.removeListener`. The preload
script imports only `electron` and, as types, the shared contract.

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
channel names:

| Group                                | Representative exports                                                                                                                                                                                                          | Who uses it                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Crash Card payload and review state  | `CardDocument`, `CardMetadata`, `CardMemoryTricks`, `CardQaPair`, `CardNoteReference`, `ReviewMetadata`                                                                                                                         | Main persists it; renderer renders it                                   |
| UID boundary parsing and Diagnostics | `ParsedCrashCard`, `ParsedCrashCardsNote`, `CardParseDiagnostic`, `CardParseDiagnosticCode`                                                                                                                                     | Main produces Diagnostics; renderer displays them                       |
| Vault                                | `VaultDescriptor`, `VaultNoteSummary`, `VaultNoteDocument`, `VaultIndex`, `VaultIndexEntry`, `VaultWriteNoteInput`, `VaultWriteNoteResult`                                                                                      | Returned by `vault:*` channels; the descriptor lives in `VaultContext`  |
| Crashpad                             | `CrashpadDocument`, `CrashpadSummary`, `CrashpadCardEntry`, `CrashpadDeletedCardSnapshot`, `CrashpadDeletePreferences`                                                                                                          | Main persists; renderer authors and restores                            |
| Weaver requests, plans and results   | `WeaveKind`, `WeaveStrength`, `GuidedInsertPermissions`, `WeavePlanRequest`, `WeavePlan`, `WeaveReActStep`, `WeavePlanResult`, `WeaveProviderHealth`, `WeaveModelInfo`, `WeaveApplyResult`, `WeaverSettings`, `WeaverKeyStatus` | Renderer submits a request and reviews a plan; main runs and applies it |
| Weave operation kinds and payloads   | `WeavePlanOperationKind`, the `*Payload` interfaces and the matching `*Operation` aliases, the `WeavePlanOperation` union                                                                                                       | Both sides: a `WeavePlanOperation[]` is posted to `weave:apply-plan`    |

Ownership follows the shapes. Main owns the behaviour behind them: it reads and writes the
Vault, validates paths, persists the Card store and settings, and calls the provider. Preload
owns nothing but forwarding. The renderer owns its own presentation types — `CardViewRecord`
and `CardScope` in `src/lib/cards.ts`, `CrashpadHistoryEntry` in `src/lib/crashpadHistory.ts` —
and borrows contract types for anything that arrives over IPC. Some contract types never appear
in a handler signature, so the module is a shared vocabulary rather than a strict manifest of
what is on the wire.

## The IPC model

### Request and response

The request/response channels are registered as `ipcMain.handle('<area>:<verb>', handler)`
calls at module scope in `electron/main.ts`, so they exist before `app.whenReady()` resolves.
Each handler returns a value or a promise of one, which becomes the resolved value of the
matching `ipcRenderer.invoke` in the renderer; a thrown error rejects that promise.

| Area          | Examples                                                                                                                                                                                                                             | Backed by                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `vault:`      | `vault:select-folder`, `vault:open`, `vault:read-note`, `vault:write-note`, `vault:update-index`, `vault:list-internal-directories`, `vault:select-image-directories`, `vault:set-image-directories`                                 | `vaultService`, `dialog`                               |
| `card-store:` | `card-store:select-folder`, `card-store:get-config`, `card-store:list-cards`, `card-store:create-card`, `card-store:save-card`, `card-store:rename-card`, `card-store:delete-card`, `card-store:restore-card`, `card-store:set-path` | `vaultService`, `settingsService`                      |
| `crashpad:`   | `crashpad:list`, `crashpad:open`, `crashpad:create`, `crashpad:save`, `crashpad:get-delete-preferences`, `crashpad:set-delete-preferences`                                                                                           | `vaultService`, `settingsService`                      |
| `weave:`      | `weave:generate-plan`, `weave:health-check`, `weave:list-models`, `weave:apply-plan`, `weave:get-settings`, `weave:update-settings`, `weave:set-api-key`, `weave:list-sessions`                                                      | `weaveService`, `weaveApplyService`, `settingsService` |

The picker channels (`vault:select-folder`, `card-store:select-folder`,
`vault:select-image-directories`) are the only ones that open native dialogs; they return `null`
when the user cancels, and callers treat `null` as "no change". Handlers that can change the
Vault's shape (`vault:open`, `vault:write-note`, `vault:update-index`, `card-store:set-path`,
`vault:set-image-directories`, `weave:apply-plan`) also call `enqueueWatchVault(rootPath)`
before returning, so the watcher reflects the current root and Card store path.

### Push channels

| Channel                 | Sent from                                                                 | Trigger                                                                        |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `weave:plan-progress`   | the `weave:generate-plan` handler, via `event.sender.send`                | The callback that handler passes into `generateWeavePlan(request, onProgress)` |
| `vault:external-change` | `flushWatcherNotifications()`, via `win.webContents.send` to every window | A debounced batch of externally changed Note paths from the watcher            |

### Typing across the boundary

The channel name and the payload types are written down more than once, and the two sides are
coupled only by convention. `electron/main.ts` repeats each channel literal in its
`ipcMain.handle` call and annotates parameters inline (`rootPath: string`,
`card: CardDocument`); there is no handler map and no shared channel-constant module.
`electron/preload.ts` repeats the same literal in `ipcRenderer.invoke` and asserts the result
with `as Promise<T>`, where `T` is imported from the contract — `ipcRenderer.invoke` returns
`Promise<any>`, so the cast is a declaration, not a runtime check. `src/vite-env.d.ts` declares
`Window.crashWeaver` by hand, listing its members with their signatures and importing the
same contract types; the member names match the object exposed in `electron/preload.ts`.

A rename on one side, or a payload change in the contract, is therefore caught by the compiler
only where the annotated type and the cast disagree; nothing validates the channel names beyond
both literals being spelled the same. Errors surface by rejection: `App.tsx` normalises Weaver
errors by stripping Electron's wrapper with a regex matching
`Error invoking remote method '<channel>': Error: <message>`.

## Renderer architecture

### App.tsx

`src/App.tsx` is the root component and the largest renderer file. It destructures all four state
contexts, keeps `useRef` handles for DOM nodes and current-value mirrors, derives the
visible card set (`visibleCards`, `focusedCard`, `crashpadCards` and the rest), calls the hook
layer, and renders the shell: the widget rail, sidebar, splitter layout, editor tab strip and
view-mode bar, the markdown, cards or Crashpad surface, the Inspector pane, the confirm dialog
for destructive Weave operations, and the settings modal. It is also where a Weaver request is
assembled (`handleGenerateWeavePlan`), a plan is applied (`handleApplyWeaveOperations`), and the
external-change subscription lives.

### The four state contexts

`src/state/AppStateProvider.tsx` composes the providers in a fixed order — `VaultStateProvider`,
`EditorStateProvider`, `WeaverStateProvider`, `UIStateProvider`. `src/state/index.ts` re-exports
the providers, hooks and types.

| Context | File                          | State it owns                                                                                                                                                                                                                        | Hook                                                              |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Vault   | `src/state/VaultContext.tsx`  | `vaultPath`, the `vault` descriptor, `vaultAlias`, `allCards`, `internalDirectories`, `crashpadSummaries`, `activeCrashpad`, `crashpadDeletePreferences`                                                                             | `useVaultState`, plus `useVaultStateValues` for values-only memos |
| Editor  | `src/state/EditorContext.tsx` | `activeEditorKind` (`markdown`, `crashpad`, `card`), active card and Note paths, `draftPath`/`draftContent`/`savedContent`, `activeNote`, `viewMode`, `cardScope`, loading flags, `statusMessage`, `errorMessage`, `editorFontSize`  | `useEditorState`, plus `clearEditorState` for a Vault close       |
| Weaver  | `src/state/WeaverContext.tsx` | `weaveKind`, `weaveStrength`, guided-insert permissions, `weaveIntent`, `weaveModel`, `weavePlanResult`, `weaveProviderHealth`, `weaverSettings`, `weaveSessions`, `weaveApplyResult`, apply errors and in-flight flags              | `useWeaverState`                                                  |
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
`useAppUiInteractions`, `useSidebarActions` and `usePaneLayout`. Most take their dependencies as
an options object and return callbacks; `App.tsx` supplies the context setters.

`src/components/` holds the renderer components: `AppSidebar` (explorer and Vault info tabs, built with
`buildExplorerTree` and the virtualised `ExplorerTree`), the authoring and inspection surfaces
`CardsWorkspace`, `CrashpadWorkspace`, `CardMetadataPanel` and `InspectorPane`, `SettingsModal`,
and the Weaver surfaces `WeaverProposalPanel`, `WeaverProgressFeed`, `WeaverOperationItem`,
`WeaverDiffPreview`, `WeaverUnifiedDiffModal`, `WeaverConfirmDialog` and `WeaverSessionHistory`.
A few components call `window.crashWeaver` directly rather than going through `App.tsx`:
`WeaverProposalPanel` uses `isStubWeaveProvider`, `listWeaveModels` and `onWeavePlanProgress`,
`WeaverSessionHistory` uses `getWeaverSession`, and `WeaverUnifiedDiffModal` uses `readNote`.

`src/lib/` holds the pure helpers — `cards.ts`, `crashpadHistory.ts`, `crashpadStatus.ts`,
`editorPaths.ts`, `errorUtils.ts`, `explorerTree.ts`, `layout.ts`, `markdownPreview.ts`,
`stateUtils.ts` — with no React and no IPC. Vitest suites sit beside `crashpadStatus.ts`,
`editorPaths.ts` and `markdownPreview.ts`.

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
`tests/electron/settingsService.test.cjs` drives the compiled `dist-electron/settingsService.js`
through the `__setSettingsFilePathForTests` and `__resetSettingsMutationQueueForTests` seams and
asserts per-key persistence and mutation serialization against the settings file.

The "bounds" in this service are numeric bounds on the Weaver budget settings, not window
geometry. `WEAVER_BUDGET_BOUNDS` fixes four categories — tokens (100 to 32 000), timeouts
(5 000 to 600 000 ms), ReAct iterations (1 to 20) and operation counts (1 to 20) — and
`WEAVER_BUDGET_FIELD_REGISTRY` maps each budget field from its snake_case persisted
key to its camelCase `WeaverSettings` response key and bound category. `updateWeaverSettings`
validates each supplied value with `normalizeBoundedNumber`, which rejects non-finite or
out-of-range numbers with a thrown `Error` and truncates fractions, so a rejected value rejects
the `weave:update-settings` invoke and surfaces in the renderer as an error message. The registry
is the one place to add a budget knob, because `readSettings`, `buildWeaverSettingsResponse` and
`updateWeaverSettings` all loop over it.

The OpenRouter API key never crosses the boundary: `encryptApiKey` stores it through
`safeStorage.encryptString` as base64, falling back to a `plain:`-prefixed value with a logged
security warning when OS encryption is unavailable, and the renderer sees only
`WeaverSettings.configured`, a boolean derived from whether a stored key exists.

The renderer reads settings as part of a `VaultDescriptor` (`cardStore`, `imageDirectories`)
returned by `vault:open` and `vault:update-index`, and through `card-store:get-config`,
`crashpad:get-delete-preferences` and `weave:get-settings`. It writes through
`card-store:set-path`, `vault:set-image-directories`, `crashpad:set-delete-preferences`,
`weave:update-settings`, `weave:set-preferred-model`, `weave:set-api-key` and
`weave:clear-api-key`. The settings writes return the refreshed state — the two API-key channels
return nothing — and the caller stores that value in context; `handleUpdateWeaverSettings` in
`App.tsx` is one example. `App.tsx` also loads `getWeaverSettings` once on mount and syncs
`weaveModel` from `preferredModel`.

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
CommonJS, and the `node:test` suites in `tests/electron/` `require` compiled modules directly,
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

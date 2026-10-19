# CrashWeaver architecture overview

CrashWeaver is an Electron desktop app for working with an Obsidian vault as a knowledge base of
Crash Cards. The user's notes stay ordinary markdown; each card's full payload lives in a separate
card store; and the Weaver, an LLM agent, reads the vault and proposes changes that the user
accepts or rejects at an approval gate before anything is written. Scheduling state exists for a
future review loop; that loop is not built yet.

The vocabulary in this document is the vocabulary of
[the domain glossary](../../CONTEXT.md). The three companion architecture documents hold the
depth and are linked from each section below.

## What CrashWeaver is

The vault is the folder the user opens as their knowledge base. Inside it, a note is a markdown
file that carries prose plus UID boundaries — paired start/end markers naming the UID whose text
the span belongs to. A note therefore records _where_ a card appears, never the card's full
payload.

The card is the core unit: a piece of knowledge to remember, its categorisation, its memory
tricks, and its review state. Cards are stored one file per card in the card store, and a UID is
the only thing linking a note's boundaries to a card's payload. A reference is a link from a card
to a specific line span in a specific note; a card holds many, and a card whose references have
all gone is an orphaned card.

| Concept      | Where it lives in code                                                                    | What it is                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Crash Card   | `electron/vault-contract.ts`'s `CardDocument`                                             | The unit: `uid`, `type`, `raw_content`, `metadata`, `memory_tricks`, `referenced_in`      |
| Note         | `electron/vaultService.ts`'s `readNoteDocument`, `electron/cardParser.ts`                 | A markdown file plus parsed cards and diagnostics                                         |
| UID boundary | `electron/cardParser.ts`'s `formatCardStartBoundary` / `formatCardEndBoundary`            | The `%%CW_CARD_START uid:<UID>%%` / `%%CW_CARD_END uid:<UID>%%` pair                      |
| Card store   | `electron/cardStoreService.ts`, `electron/settingsService.ts`'s `getDefaultCardStorePath` | One JSON file per card, `<uid>.json`, default `.crashweaver/cards` inside the vault       |
| Reference    | `CardDocument.referenced_in`, `electron/cardStoreService.ts`'s `upsertCardReference`      | `note_path` + `start_line` + `end_line`                                                   |
| Diagnostic   | `electron/vault-contract.ts`'s `CardParseDiagnostic`                                      | A parser report of a malformed boundary                                                   |
| Crashpad     | `electron/crashpadService.ts`, `src/components/CrashpadWorkspace.tsx`                     | The authoring surface where cards are composed and arranged before being woven into notes |

Categorisation is a card's `type` list; mnemonic aids are `memory_tricks` — one memory technique
phrase plus question/answer pairs. Familiarity and next review are the scheduling state carried
in `CardMetadata`: the fields exist and are preserved across index rebuilds, but no review loop
consumes them yet. The renderer is where a card is seen and edited:
`src/components/CardsWorkspace.tsx` browses cards, `src/components/CrashpadWorkspace.tsx`
composes them, and `src/components/InspectorPane.tsx` shows the focused card's detail.

## The process split: main, preload, renderer

CrashWeaver is built as the standard Electron split, and the split is enforced rather than
conventional.

**Main process.** `electron/main.ts` is the privileged half. It owns the filesystem: every vault,
card-store, crashpad and Weaver handler is registered there with `ipcMain.handle` and delegates
to a service under `electron/`. It also owns lifecycle (`app.whenReady`, `window-all-closed`),
the folder pickers (`dialog.showOpenDialog`), the vault watcher (`chokidar`, see
`watchVault`), and the `crashweaver-local` protocol handler used to serve vault-relative images
into the renderer.

**Preload bridge.** `electron/preload.ts` runs with `contextBridge` and exposes exactly one
global, `crashWeaver`, via `contextBridge.exposeInMainWorld`. Each method is a thin wrapper over
`ipcRenderer.invoke` on a named channel (`vault:open`, `card-store:save-card`,
`weave:generate-plan`, `weave:apply-plan`, and so on). Two push channels are bridged as
subscriptions returning unsubscribe functions: `weave:plan-progress` for live Weaver progress, and
`vault:external-change` for files changed underneath the app.

**Renderer.** `src/` is a React application. It has no filesystem access and no Node built-ins:
when it needs the vault it calls `window.crashWeaver.*`, whose shape is declared in
`src/vite-env.d.ts` by importing the shared types. `src/state/AppStateProvider.tsx` composes the
vault, editor, Weaver and UI contexts that `src/App.tsx` consumes.

The reason for the split is visible in the window options. `electron/main.ts`'s
`createMainWindow` passes `contextIsolation: true`, `nodeIntegration: false`, and a `preload`
script path. The renderer therefore cannot reach `require`, `fs`, or `ipcRenderer` directly; every
privileged act is an explicit, named channel call — the preload bridge is the complete list of
what the UI can ask the main process to do, and the main process re-validates each argument
(for example `electron/vaultService.ts`'s `resolveNotePath` rejects a note path outside the
vault).

The main process is also the only participant that watches the vault, because a
watcher is a privileged resource. `watchVault` syncs externally changed notes into the card
store and then pushes `vault:external-change` to the renderer, which refreshes its catalogs —
so Obsidian-side edits and in-app edits converge on the same card store.

[Process model and IPC](./process-model.md) covers the channel inventory, the contract, and the
watcher in full.

## The two storage surfaces

CrashWeaver keeps content and structure apart. The table names where each surface lives and its
main writers; notes and the card store each have more than one, and every write is bounded by the
vault-root guard.

| Surface     | File path                                                          | Main writers                                                                                                                                                                                                                             | Holds                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Note        | `<vault>/**.md`                                                    | `electron/vaultService.ts`'s `writeNote`; the boundary-mutation services (`renameCardBoundariesAcrossReferences`, `removeCardBoundariesAcrossReferences`, `reinsertCardBoundariesForReferences`); `electron/weaver/weaveApplyService.ts` | Prose plus UID boundaries; parsed cards and diagnostics                                                                                                                                                                             |
| Card store  | `<cardStorePath>/<uid>.json`, default `<vault>/.crashweaver/cards` | `electron/cardStoreService.ts`; `electron/weaver/weaveApplyService.ts`'s `applyCreateNote`                                                                                                                                               | The card's full payload: `type`, `raw_content`, `metadata`, `memory_tricks`, `referenced_in`                                                                                                                                        |
| Crashpad    | `<vault>/.crashweaver/crashpads/<id>.crashpad.json`                | `electron/crashpadService.ts`                                                                                                                                                                                                            | The authoring surface: card entries with `origin` `existing` or `new`, plus deleted-card snapshots                                                                                                                                  |
| Vault index | `<vault>/.crashweaver/index.json`                                  | `electron/services/vaultIndexService.ts` via `electron/vaultService.ts`'s `writeIndex`                                                                                                                                                   | The note catalog with title, tags and review metadata                                                                                                                                                                               |
| Settings    | `crashweaver-settings.json` under Electron's `userData`            | `electron/settingsService.ts`                                                                                                                                                                                                            | Per-vault card-store path, image directories, crashpad delete preferences, Weaver settings and the API key — encrypted with Electron's `safeStorage`, or stored with a `plain:` prefix when Electron reports encryption unavailable |

A note's boundary markers are the only structural markup the app writes into the user's prose.
`electron/cardParser.ts`'s `parseCrashCardsFromNote` scans line by line and returns
`ParsedCrashCardsNote`: card spans plus diagnostics for invalid, nested, unmatched or
mismatched boundaries. Each parsed card is then enriched with the card store's state by
`electron/cardSyncService.ts`'s `enrichParsedCardsWithStoreState`, which attaches
`cardFilePath`, `cardExists` and `linkedCard`.

The two surfaces stay consistent through sync, not through dual writes.
`electron/cardSyncService.ts`'s `syncNoteToCardStore` parses a note and calls
`upsertCardReference` for each card, creating a card document from the block's text the first
time a UID is seen and thereafter updating only that card's reference span. `updateIndex`
rebuilds the whole store from all notes; `writeNote` syncs the one note it wrote. When a note has
blocking parser diagnostics, `syncParsedCrashCards` records the reference removals for cards that
vanished from that note as `skipped` instead of performing them, so a malformed boundary never
silently strips a reference.

A crashpad file is an authoring document, not a second card store. `CrashpadDocument` holds a
`cards` list of `{ uid, origin, addedAt }` entries and a `deletedCards` list of
`CrashpadDeletedCardSnapshot`s. Cards created in a crashpad are written to the card store with
`createCard`; cards attached from the vault keep their existing payload and are marked
`existing` (`src/hooks/useCrashpadCardMutationActions.ts`). Deleting from a crashpad can keep
the snapshot so the card can be restored, and `electron/vaultService.ts`'s `renameCard` keeps
note boundaries and crashpad entries pointing at the same UID.

The glossary's vault rule is scoped to notes and boundaries. The card store defaults to
`<vault>/.crashweaver/cards` but can be pointed at any directory, and the app's own settings and
API key live under Electron's `userData`, outside the vault.

[Data model](./data-model.md) covers the schemas, the boundary grammar, references and
diagnostics in full; [Boundary format](../reference/boundary-format.md) is the format
reference.

## The life of one weave

A weave is one run of the Weaver ending in one plan; the plan is an ordered set of proposed
operations that the user reviews before anything is written. End to end:

1. **Author in a crashpad.** The user composes cards in the crashpad surface
   (`src/components/CrashpadWorkspace.tsx`, `src/hooks/useCrashpadCardMutationActions.ts`),
   which persists through the bridge to `electron/vaultService.ts`'s `createCard` / `saveCard`
   and then `electron/cardStoreService.ts`'s `writeCardDocument`. A card must be focused and the
   crashpad active before the Weaver panel will generate anything.
2. **Ask for a weave.** `src/App.tsx`'s `handleGenerateWeavePlan` builds a `WeavePlanRequest` —
   root path, preferred model, intent text, the focused card's UID, the active note and selected
   text, and the crashpad identity — and calls `window.crashWeaver.generateWeavePlan`. The
   request is a guided insert (with edit-content and create-note permissions) or an intelligent
   weave (with a weave strength); strength changes autonomy knobs such as iteration and operation
   limits, never model routing.
3. **The Weaver reads the vault and proposes.** The `weave:generate-plan` handler in
   `electron/main.ts` calls `electron/weaver/weaveService.ts`'s `generateWeavePlan`, which
   validates the request with `electron/weaver/weavePlanSchema.ts`'s
   `validateWeavePlanRequest`, then builds a context snapshot with
   `electron/weaver/weaveContextService.ts`'s `buildWeaveContextSnapshot`. The snapshot reads the
   focused card from the card store and the vault index and ranks candidate notes (keyword scoring,
   optionally boosted by embeddings); the provider then builds its read-only tool runtime from that
   snapshot —
   `list_candidate_notes`, `list_directory_summary`, `search_notes`, `read_note_excerpt`,
   `read_note_full`, `read_note_span` and a one-shot `refresh_candidates`. The provider is
   `StubWeaveProvider` when no API key is configured and `OpenRouterWeaveProvider` otherwise.
   The returned plan is checked again by `validateWeavePlanResult` before it reaches the UI.
   Plan generation writes no note or card content, but it is not write-free on disk: it can write
   Weaver request logs under `.crashweaver/weaver-request-logs` (or a configured logs directory)
   and an embedding cache at `.crashweaver/embeddings.json`.
4. **The approval gate shows the diff.** The renderer renders the plan in
   `src/components/WeaverProposalPanel.tsx` as individual operations, each of which the user can
   accept or reject. Per-operation previews come from `src/components/WeaverDiffPreview.tsx` and
   `src/components/WeaverUnifiedDiffModal.tsx`; the modal reads the target note through
   `window.crashWeaver.readNote` and computes the prospective diff in the renderer. Destructive
   kinds — delete, rename and move for notes and directories — additionally route through
   `src/components/WeaverConfirmDialog.tsx`'s `isDestructiveOperation` gate before an apply can
   start.
5. **Apply writes the accepted operations.** `src/App.tsx`'s `handleApplyWeaveOperations` calls
   `window.crashWeaver.applyWeavePlan`, whose `weave:apply-plan` handler in `electron/main.ts`
   resolves the card store and calls `electron/weaver/weaveApplyService.ts`'s
   `applyWeaveOperations(rootPath, cardStorePath, operations, { dryRun: false, stopOnError: true })`.
   That service dispatches each operation by kind, bounds every target with `assertWithinVault`,
   and returns a per-operation `WeaveApplyResult`. On success the renderer refreshes the vault,
   card catalog and crashpad catalog through `updateIndex`; the main process re-registers the vault
   watcher for the current vault and card store, which is a no-op when they are unchanged.

The apply service is the only executor of a plan's operations, which is what makes the gate a
real gate: the renderer chooses which operations to send, and `applyWeaveOperations` is the only
place where a plan becomes writes to notes, boundaries or card documents.

Planning is not entirely write-free on disk: it can write Weaver request logs and an embedding
cache under `.crashweaver/`. Those are Weaver-owned diagnostics and caches, outside the approval
gate's guarantee, which covers notes, boundaries and card payloads.

[The weave pipeline](./weave-pipeline.md) covers retrieval and budgets, the ReAct loop, plan
schema validation, the diff UI and per-kind apply semantics in full.

## Where the code lives

| Path                                                  | Contents                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/`                                           | Main process entry (`main.ts`), the preload bridge (`preload.ts`), the shared contract (`vault-contract.ts`), and the vault services: cards, notes, boundaries, crashpads, settings, index                                                                                                                     |
| `electron/weaver/`                                    | The Weaver: service facade, context retrieval, ReAct graph and nodes, prompts, plan schema, providers, model profiles, request logging and session history                                                                                                                                                     |
| `src/`                                                | The renderer: `App.tsx`, `components/`, `hooks/`, `state/` contexts, and `lib/` helpers                                                                                                                                                                                                                        |
| `tests/electron/`                                     | `node:test` suites for the main-process services and the Weaver, loaded from the compiled `dist-electron/` output                                                                                                                                                                                              |
| `dist/`                                               | Vite's renderer build output, loaded by the window in production (git-ignored)                                                                                                                                                                                                                                 |
| `dist-electron/`                                      | `tsc`'s CommonJS build of `electron/`, referenced by `package.json`'s `main` (git-ignored)                                                                                                                                                                                                                     |
| `fixtures/mock-vault/`, `fixtures/mock-vault_sample/` | Checked-in sample material for exercising the app manually: `mock-vault/` is the original sample vault, and `mock-vault_sample/` is a slightly older copy to open and test against so the original stays untouched. See [fixtures/README.md](../../fixtures/README.md). Neither is referenced by code or tests |

The two halves meet at one file: `electron/vault-contract.ts` declares the request, document and
result types for notes, cards, crashpads, weave requests, plans and apply results. Both the main
process services and the renderer import from it (the renderer only as types), and the preload
bridge's signatures are drawn from the same declarations. That file is the reason a change to a
payload shape surfaces as a type error on both sides of the process boundary. The renderer's
window global is re-declared against it in `src/vite-env.d.ts`.

Because the main-process tests import compiled JavaScript from `dist-electron/`, `npm test`
builds the main process before running them (`package.json`'s `test:electron` script), and
`tests/electron/vaultService.test.cjs` exercises real behaviour against temporary vaults: card
rename propagating boundary UIDs into notes and crashpad entries, boundary removal on delete,
and restore in both reinsert and forget modes.

## How to read the rest of these docs

Start with [the glossary](../../CONTEXT.md) if a term is unclear, then pick the document that
matches the question:

- [Data model](./data-model.md) — vault, notes, boundaries, the card store, references and
  diagnostics.
- [Process model and IPC](./process-model.md) — main, preload, renderer, the shared contract and
  the channel inventory.
- [The weave pipeline](./weave-pipeline.md) — retrieval, planning, the approval gate and apply.
- [Card schema](../reference/card-schema.md), [Boundary format](../reference/boundary-format.md)
  and [Card insert templates](../reference/card-insert-templates.md) — the exact formats.
- [Development setup](../guides/development-setup.md) and
  [Using CrashWeaver](../guides/using-crashweaver.md) — running, testing and operating the app.
- [The documentation index](../README.md) — everything current in one place.

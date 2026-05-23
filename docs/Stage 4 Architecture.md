# Stage 4 Architecture

## Scope

Stage 4 implements Crashpad card authoring over the shared card store with crashpad-canvas history:

- multiple crashpad canvas files stored per vault in `.crashweaver/crashpads/*.crashpad.json`
- crashpad files rendered as a separate editor document type
- crashpad files selectable from the left explorer tree
- a widget action that opens or creates the daily crashpad named `YYYY-MM-DD.crashpad.json`
- open existing cards into a crashpad canvas
- create new cards from crashpad and persist immediately into the card store
- edit card fields and persist updates to per-card JSON files
- delete workflows with configurable confirmations and optional boundary cleanup
- session-level undo and redo for crashpad create, attach, edit, and delete actions
- crashpad snapshot history for deleted cards

## Implemented Runtime Pieces

### Shared contract updates

`electron/vault-contract.ts` now includes Stage 4 contracts for:

- crashpad document and summary shapes
- crashpad active-card entries and deleted-card snapshots
- global crashpad delete preferences
- card delete options and delete results

### Crashpad file service

`electron/crashpadService.ts` manages crashpad canvas files:

- default location: `{vaultRoot}/.crashweaver/crashpads`
- list, create, read, and write crashpad files
- tolerant coercion for existing/legacy file contents
- stable file names that support direct explorer navigation and daily-crashpad lookup

### Card store mutation support

`electron/cardStoreService.ts` now includes Stage 4 helpers:

- card title / ID validation helper
- create default card documents for new cards
- direct card write helper for authoring updates
- direct card delete helper

### Vault service Stage 4 APIs

`electron/vaultService.ts` now exposes:

- card create, save, and delete operations
- optional boundary-line cleanup while deleting cards
- crashpad list, open, create, and save operations
- crashpad delete preference get/set operations

Boundary cleanup behavior:

- when enabled, deletes `CW_CARD_START` and `CW_CARD_END` lines for the card UID from referenced notes
- referenced notes are re-synced through existing card-sync logic

### Settings persistence

`electron/settingsService.ts` now persists global crashpad delete preferences:

- `removeNoteBoundariesByDefault`
- `requireConfirmationForNewCards`
- `requireStrictConfirmationForExistingCards`

### Main/preload bridge additions

`electron/main.ts` and `electron/preload.ts` now include Stage 4 IPC endpoints for:

- card CRUD operations
- crashpad file lifecycle
- crashpad delete preference lifecycle

## Renderer Additions

### Crashpad workspace UI

`src/components/CrashpadWorkspace.tsx` provides Stage 4 crashpad authoring:

- crashpad create/open controls with inline inputs instead of browser dialogs
- open-existing and create-new card flows
- editable form for card content, tags, review metadata, memory technique, and Q&A prompts
- fill-in-the-blanks prompts are represented directly as Q&A entries whose question text contains blanks
- delete operations with inline confirmation controls based on card origin and preferences
- undo/redo actions
- delete preference toggles

### App orchestration

`src/App.tsx` now orchestrates crashpad state:

- crashpad catalog loading per vault
- active crashpad selection and persistence
- crashpad card list projection from shared card store
- session undo/redo stacks for crashpad actions
- crashpad files open as their own editor surface instead of living inside markdown Cards scope
- markdown `Source`, `Preview`, and `Cards` mode tabs now render only for markdown notes
- the explorer tree now includes crashpad files, card-store JSON files that live inside the vault, and all discovered directories under `.crashweaver`
- the widget rail includes a daily Crashpad shortcut keyed to the local date

## Data Model Notes

Crashpad files are independent bookkeeping canvases and do not replace per-card JSON files. Card source-of-truth remains in the configured card store folder.

Crashpad files store:

- active crashpad cards: card title / ID in `uid`, origin (`existing` or `new`), added timestamp
- deleted card snapshots: full card payload, origin, deletion timestamp, and boundary-removal choice

## Known Limits

- crashpad undo/redo is session-level only
- strict delete confirmation currently uses inline text entry in the crashpad surface
- delete-boundary cleanup removes boundary comment lines, not enclosed content lines
- no dedicated crashpad search/filter UI yet

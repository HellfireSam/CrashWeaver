# CrashWeaver Architecture for Beginners

CrashWeaver is an Electron desktop app that manages knowledge stored in an Obsidian vault and a separate card store folder.

The app uses three layers:

- main process: native app lifecycle and privileged operations
- preload process: safe bridge API from renderer to Electron
- renderer process: React UI

## 1. Product Model In Plain Language

CrashWeaver centers on Crash Cards (called cards).

A card is a knowledge unit with these fields:

1. type or tags
2. title or ID, stored as the card UID
3. raw content
4. metadata for spaced repetition
5. memory tricks:
   - memory technique
   - Q and A pairs, including prompts that use blanks directly in the question text

Cards are represented in markdown notes by wrapping relevant note text with two lightweight comment boundaries:

- start boundary comment: opening marker with the UID
- end boundary comment: closing marker with the same UID

The full card payload is stored in a separate JSON card file inside a user-configurable card store folder.

Each card file also records where the card appears:

- note path
- start line
- end line

This keeps the note readable while allowing CrashWeaver to track boundary locations and synchronize card data.

## 2. Crashpad

Crashpad is the authoring canvas for cards.

Users can:

- create cards
- edit all fields
- delete cards with confirmation
- undo and redo
- use LLM assistance for drafting and organizing cards

Crashpad persistence:

- card payloads live in the configurable card store folder
- Crashpad can open existing cards or create new ones in that folder
- crashpad canvas files live at `{vaultRoot}/.crashweaver/crashpads/*.crashpad.json`
- crashpad files can be opened from the explorer tree or from the daily Crashpad widget
- directories under `.crashweaver` are also visible in the explorer for navigation context
- settings expose the card store folder path

## 3. Weave And Weaver

Weave is LLM-assisted insertion of cards into the vault. The LLM is called Weaver.

Weaver modes:

1. plain insert
2. insert plus edit
3. create new note
4. intelligent weaver

Intelligent Weaver levels:

- light
- standard
- go ham

Users can provide insertion intent. Weaver should consider those instructions.

Mandatory rule:

- all Weaver proposals go through accept-reject review
- no write is executed until the user explicitly accepts

## 4. Runtime Responsibilities

### Main process (electron/main.ts)

- creates app window
- runs native dialogs
- hosts IPC handlers
- delegates vault actions to vault service

### Vault service (electron/vaultService.ts)

Current Stage 2 behavior:

- open and validate vault paths
- scan markdown files
- read and write notes
- generate the note-level vault index at `.crashweaver/index.json`

Planned extension:

- parse card boundary comments
- read and write per-card JSON files in the configured folder
- keep note references updated when markdown files are created, modified, or deleted
- produce card-level index entries

### Shared contract (electron/vault-contract.ts)

Contains TypeScript models shared by Electron and renderer. This should be extended with card store, note reference, and Crashpad contracts in future stages.

### Preload bridge (electron/preload.ts)

Exposes safe renderer API for vault actions. Future stages can add card store configuration, Crashpad, and weave APIs through this same pattern.

### Renderer (src/App.tsx and modules)

Current Stage 2 UI includes:

- vault explorer
- source editor
- markdown preview
- placeholder card view

Future UI adds:

- Crashpad canvas as a separate custom file type
- card copy-boundary actions
- card store settings and sync status
- weave mode controls
- diff approval panel

## 5. End-To-End Data Flow

1. User opens vault.
2. Renderer asks preload bridge.
3. Preload sends IPC to main process.
4. Main process calls vault service.
5. Result returns to renderer.

For weave workflows:

1. User picks card and weave mode.
2. Weaver proposes a plan and file diffs.
3. User accepts or rejects.
4. Only accepted changes are committed.

For card sync workflows:

1. A vault note is created, edited, or deleted.
2. Vault service reparses the affected note.
3. Matching card JSON files are created, updated, or cleaned up to match the current boundaries.

## 6. Stage Status

- Stage 1 and 2: implemented
- Stage 3 card boundary parsing and card-store sync: implemented
- Stage 4 Crashpad workflows: implemented
- Weaver modes and approval gate: planned

## 7. Short Version

Remember this split:

- Electron main controls native power.
- preload is the safe doorway.
- renderer is the visible app.
- notes point to cards.
- card files hold the full data and both boundary line numbers.
- markdown notes use `Source`, `Preview`, and `Cards` modes.
- Crashpad drafts cards from the shared store through separate `.crashpad.json` files.
- Weaver proposes insertion.
- user approval is mandatory before any LLM-driven write.

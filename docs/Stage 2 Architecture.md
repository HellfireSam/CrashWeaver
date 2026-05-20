# Stage 2 Architecture

## Scope

Stage 2 implements the first complete vault workflow and editor shell:

- open selected vault
- read markdown notes
- write markdown notes
- refresh index.json
- show explorer and center-pane editor modes
- render markdown and math preview

## Clarified Product Alignment

The project now defines Crash Card as the core knowledge unit and introduces an external card store, Crashpad, and Weaver workflows. Stage 2 does not yet implement these features, but its architecture is the baseline that they will extend.

## Runtime Layout

### Main process

- native folder selection
- IPC handlers for vault actions
- delegation to vault service

### Vault service

- validates vault paths
- recursively scans markdown files
- reads note documents
- writes note documents
- rebuilds note-level index.json

Planned extension:

- parse paired card boundaries in notes
- maintain per-card JSON files in a user-configurable card store folder
- reconcile note references on note create, modify, and delete events

### Shared contract

- keeps renderer and Electron type models aligned
- currently models note-level entries and review placeholders
- planned extension: card-level, note-reference, card-store settings, and Crashpad contracts

### Preload bridge

Current API:

- selectVaultFolder
- openVault
- readNote
- writeNote
- updateIndex

Planned API additions:

- card store folder selection
- card create/read/update/delete and sync/rebuild operations
- Crashpad authoring operations
- weave plan generation and staged apply operations

### Renderer

Current Stage 2 screens:

- source mode
- preview mode
- card placeholder

Planned screens:

- Crashpad canvas
- card boundary copy actions and linked-note reference view
- card store folder chooser and sync status
- weave mode chooser
- accept-reject diff panel

## Data Model Status

Current index:

- note-level entries with review placeholders

Planned data model:

- card-level identity by UID
- per-card JSON files in a configurable card store folder
- note reference entries with `note_path`, `start_line`, and `end_line`
- metadata updates from card-level review events written back to card files

## Card Boundary Format (Planned Stage 3)

Each card is enclosed by two lightweight comments in markdown:

- start comment: opening boundary with UID
- end comment: closing boundary with the same UID

The note itself does not carry the full structured payload. The matching card JSON file is the canonical store for type or tags, topic or title, raw content, metadata, memory tricks, and linked note references.

## Card Store Sync Model (Planned Stage 3)

- note created: parse boundaries and create or update matching card files
- note modified: recalculate `start_line` and `end_line`, add new references, and remove stale ones
- note deleted: remove references from affected card files without deleting unrelated card data

## Weaver Model (Planned)

Weaver modes:

1. plain insert
2. insert plus edit
3. create new note
4. intelligent weaver

Intelligent Weaver levels:

- light
- standard
- go ham

Safety rule:

- all Weaver outputs must pass accept-reject review before file writes

## Stage 2 Acceptance Mapping

- user can open vault
- notes are discovered
- note read and save flows work
- index refresh works
- preview rendering works

These outcomes are implemented and verified.

Card-store synchronization remains future scope beyond Stage 2.

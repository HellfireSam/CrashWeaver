# Project Outline: CrashWeaver

CrashWeaver is an external desktop app that works with an Obsidian vault. The core unit of knowledge is a Crash Card (called a card for short). Cards are represented in markdown notes by using paired Obsidian markdown comments, while the full structured payload for each card is stored in a separate JSON file inside a user-configurable card store folder.

## Current Implementation Snapshot (May 2026)

The repository currently includes a complete Stage 2 Electron implementation with:

- local vault open, read, write, and index refresh workflows through Electron IPC
- generated `.crashweaver/index.json` with note-level entries and review placeholders
- Obsidian-style editor shell with explorer, center editor, and inspector panes
- markdown preview rendered through markdown-it with markdown-it-texmath and katex
- explorer folders that initialize collapsed and toggle correctly on first click
- modular renderer structure for maintainability
- Stage 3 Crash Card parsing with strict UID boundary matching
- configurable card-store persistence with a default of `{vaultRoot}/.crashweaver/cards`
- note-reference sync on vault open, note save, index refresh, and external markdown file changes
- Stage 4 crashpad canvas files in `{vaultRoot}/.crashweaver/crashpads`
- crashpad workflows for open existing cards, create new cards, edit fields, and delete cards
- crashpad files selectable directly from the explorer tree
- card-store JSON files surfaced in the explorer tree when the configured card store sits inside the vault
- directories under `.crashweaver` surfaced in the explorer tree for direct navigation context
- daily Crashpad widget that opens or creates `{vaultRoot}/.crashweaver/crashpads/YYYY-MM-DD.crashpad.json`
- `Source`, `Preview`, and `Cards` modes reserved for markdown notes, with crashpad rendered as a separate custom file type
- crashpad delete snapshots and session undo/redo over crashpad actions

Weaver and card-level review flows are clarified in this document and remain planned for later stages.

## 1. Core Product Clarification

### 1.1 Crash Card Terminology

- A knowledge block is called a Crash Card.
- Future docs and features should use card as the default term.

### 1.2 Crash Card Data Model

Each card has these attributes:

1. type or tags: category labels for the knowledge
2. title or ID: a single unique identifier stored in `uid`
3. raw content: factual text or explanation
4. metadata: spaced-repetition fields (for example familiarity and next review date)
5. memory tricks, with two subparts:
   - memory technique: short mnemonic phrase or keyword
   - Q and A pairs, including prompts that use blanks directly in the question text

An LLM will assist users in filling these fields. Prompt design and implementation details will be defined in later stages.

### 1.3 In-Note Card Boundary Format

Cards are linked into markdown notes with two separate comment blocks that enclose a section of note text:

- starter comment at the start boundary: contains the card UID
- ending comment at the end boundary: closes the same card range and references that UID

Conceptual format:

```md
%%CW_CARD_START uid:<UID>%%
<the markdown text range related to this card>
%%CW_CARD_END uid:<UID>%%
```

The note keeps only lightweight boundary markers. Full card attributes are loaded from the matching JSON card file in the configured card store.

### 1.4 External Card Store Format

Each card has a dedicated JSON file named by UID in a user-configurable card store folder.

Conceptual format:

```json
{
   "uid": "CW-001",
   "type": ["concept", "oop"],
   "raw_content": "...",
   "metadata": {
      "familiarity": 0,
      "next_review": null
   },
   "memory_tricks": {
      "memory_technique": "...",
      "qa_pairs": []
   },
   "referenced_in": [
      {
         "note_path": "programming/oop.md",
         "start_line": 42,
         "end_line": 58
      }
   ]
}
```

Each note reference tracks both boundary line numbers because one inserted card spans two comment lines in the note.

## 2. Crashpad

Crashpad is a canvas for drafting and organizing cards before insertion into the vault.

Crashpad supports:

- create card
- delete card with confirmation
- undo and redo
- edit all card fields
- LLM assistance for card generation and organization

Crashpad persistence:

- card payloads are stored as individual JSON files in the designated card store folder
- Crashpad opens existing cards from that store or creates new ones there
- Crashpad canvas files live in `{vaultRoot}/.crashweaver/crashpads`
- users can open Crashpad either from the explorer tree or from the daily Crashpad widget
- the card store folder path is configurable in settings
- Crashpad must preserve the shared card-file schema used by vault sync and review workflows

## 3. Inserting Cards Into The Vault

Users can insert cards in two ways.

### 3.1 Manual Insert

From each Crashpad card, the app exposes copyable starter and ending comment text keyed to the card UID. The user manually pastes these comments at preferred locations in markdown notes, while the matching JSON card file is created or updated in the configured card store.

### 3.2 Weaver Insert (LLM-Assisted)

The LLM insertion process is called weave. The LLM is referred to as Weaver.

Weaver has context of the vault structure and markdown files, then proposes where and how to insert cards.

Weaver operation modes:

1. plain insert: insert into an existing note, with or without selecting existing text
2. insert plus edit: insert into an existing note and also improve note structure/content
3. create new: create a new note in a coherent location and insert the card
4. intelligent weaver: broader freedom to optimize vault organization, including possible restructure of folders and markdown files

Intelligent Weaver has three strength levels:

- light
- standard
- go ham

Users may also provide insertion intent, and Weaver should incorporate that guidance.

### 3.3 Mandatory Approval Layer

All Weaver edits must pass an accept-reject review layer identical in spirit to VS Code Copilot edits:

- show proposed additions and removals clearly
- do not execute changes until user approval

## 4. Architecture Direction

### 4.1 Platform Choice

Electron remains the preferred runtime because it gives stable cross-platform local file access and avoids browser support gaps for filesystem APIs.

### 4.2 System Layers

- main process: native windowing, dialogs, and privileged filesystem operations
- preload bridge: safe API exposure between renderer and Electron
- renderer: UI for vault browsing, Crashpad, and review workflows

### 4.3 Key Services

- vault service: vault I/O, note parsing triggers, and reconciliation orchestration
- card parser service: detects starter and ending comments, reconstructs card boundaries, and captures line positions
- card store service: reads and writes per-card JSON files, including note references
- crashpad service: card authoring workflows over the shared card store
- weave service: plans and stages Weaver insert operations for user approval
- review service: spaced-repetition updates

## 5. Data Strategy

### 5.1 Split Source Of Truth

- markdown notes store readable note text plus boundary references to cards
- per-card JSON files store the full structured payload and linked note locations

### 5.2 Synchronization Support

The app reconciles card files whenever relevant markdown notes are created, modified, or deleted.

Synchronization responsibilities include:

- add new note references when new card boundaries appear
- update `start_line` and `end_line` values when boundary positions shift
- remove note references when a note or boundary pair disappears

### 5.3 Index Support

The app maintains `.crashweaver/index.json` for fast lookup and scheduling operations. During Stage 2 this index is note-level. Future stages can add card-store manifests or card-level index entries while preserving compatibility.

## 6. UI/UX Direction

### 6.1 Existing Stage 2 UI

- vault explorer
- source editor
- markdown preview
- read-only card boundary inspector

### 6.2 Planned UI Additions

- Crashpad canvas as a separate custom file type with card lifecycle controls
- card-level inspector with linked-note references and boundary preview
- copy buttons for starter and ending comment blocks
- card store folder setting and sync status
- weave workflow panel with mode selection and diff approval
- review panel using card metadata and memory tricks

## 7. Staged Delivery

- Stage 1: shell and safe bridge foundation
- Stage 2: vault open/read/write/index and editor shell
- Stage 3: card boundary parsing, external card store, and vault-to-card sync
- Stage 4: Crashpad canvas workflows on top of the shared card store
- Stage 5: Weaver mode implementations with mandatory approval gating
- Stage 6: spaced-repetition refinement on card metadata

## 8. Acceptance Principles For Upcoming Stages

- card boundaries are parseable and round-trip safe
- both boundary comments resolve to the same UID
- full card payloads live in per-card JSON files, not in note comments
- each note reference stores note path, start_line, and end_line
- note create, modify, and delete events update the relevant card files
- crashpad operations support create/edit/delete-confirm/undo/redo
- weave proposals are never auto-applied
- all Weaver-driven note modifications require explicit user acceptance

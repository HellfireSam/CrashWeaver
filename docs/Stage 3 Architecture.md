# Stage 3 Architecture

## Scope

Stage 3 implements the first complete Crash Card synchronization layer:

- parse `%%CW_CARD_START uid:<UID>%%` and `%%CW_CARD_END uid:<UID>%%` pairs from markdown notes
- persist one JSON file per card in a configurable card-store folder
- track `note_path`, `start_line`, and `end_line` for each linked note reference
- synchronize card references on vault open, note save, index refresh, and external markdown changes
- expose a read-only Cards workspace for parsed cards and parser diagnostics

Stage 3 does not implement Crashpad authoring, Weaver planning, or approval UX.

## Implemented Runtime Pieces

### Shared contract

`electron/vault-contract.ts` now models:

- card JSON payload shape
- parser diagnostics
- parsed card boundaries
- card-store configuration
- note-level sync summaries and rebuild summaries

### Parser

`electron/cardParser.ts` is a pure parser that scans note content line by line and returns:

- valid card boundary pairs with UID and line positions
- the markdown content between those boundaries
- deterministic diagnostics for malformed or partial boundaries

The parser is strict about boundary grammar:

```md
%%CW_CARD_START uid:CW-001%%
...markdown content...
%%CW_CARD_END uid:CW-001%%
```

Handled error cases include:

- invalid start boundary shape
- invalid end boundary shape
- nested start boundary before closure
- unmatched start boundary
- unmatched end boundary
- mismatched start and end UIDs

### Card store service

`electron/cardStoreService.ts` manages per-card JSON files.

Implemented behavior:

- ensure the card-store directory exists
- read and coerce existing card JSON files into the current schema
- create stub card files when a boundary pair exists but the card file does not yet exist
- preserve existing structured fields when only note references change
- update files with best-effort atomic temp-file writes

Current default behavior:

- default card-store path is `{vaultRoot}/.crashweaver/cards`
- user can override that path per vault
- the chosen path is persisted in Electron `userData`

### Sync service

`electron/cardSyncService.ts` coordinates parser output with the card store.

Implemented sync rules:

- add or update note references for valid parsed cards
- remove stale references when the note parses cleanly and a previously linked card boundary is gone
- remove references for deleted notes
- perform full rebuilds from all current markdown notes

Safety rule:

- parser errors block destructive cleanup for that note

This prevents malformed or partially edited notes from accidentally removing valid card references.

### Vault service integration

`electron/vaultService.ts` now applies Stage 3 behavior during:

- `openVault`
- `updateIndex`
- `readNote`
- `writeNote`

Current behavior:

- vault open and index refresh perform a full card rebuild from current notes
- note read attaches parsed cards and diagnostics for the Cards view
- note save synchronizes the current note immediately and returns a sync summary to the renderer

### Main-process watcher

`electron/main.ts` now starts a Windows-target recursive watcher for the active vault.

Watcher behavior:

- listens for external markdown create, modify, and delete changes
- ignores non-markdown files
- ignores changes inside the configured card-store folder
- debounces note events before syncing

The watcher currently focuses on card-store synchronization. UI note lists still rely on explicit refresh for external vault changes.

## Renderer Additions

`src/App.tsx` now exposes Stage 3 inspection features:

- card-store folder chooser in settings
- vault metadata for current card-store path and latest rebuild status
- Cards view showing parsed cards for the active note
- linked card-file existence and resolved card-file paths
- parser diagnostics for malformed notes

This renderer work is intentionally read-only. Card CRUD remains Stage 4 scope.

## Data Model Notes

Each card JSON file is shaped like this:

```json
{
  "uid": "CW-001",
  "type": [],
  "raw_content": "...",
  "metadata": {
    "familiarity": 0,
    "next_review": null
  },
  "memory_tricks": {
    "memory_technique": "",
    "qa_pairs": []
  },
  "referenced_in": [
    {
      "note_path": "notes/example.md",
      "start_line": 12,
      "end_line": 18
    }
  ]
}
```

When a card file is created from note boundaries alone, Stage 3 seeds `uid` from the boundary marker, copies `raw_content` from the enclosed note text, and leaves the richer card fields empty until later stages.

## Known Limits

- only one reference per UID per note is stored in Stage 3; duplicate UIDs in the same note are diagnosed and skipped for sync
- the vault index at `.crashweaver/index.json` remains note-only; no card-level index is generated yet
- watcher behavior is currently optimized for Windows, which is the repository's documented validation target
- external note changes update the card store in the background but do not automatically refresh the renderer note list
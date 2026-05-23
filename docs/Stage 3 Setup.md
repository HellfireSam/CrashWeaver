# Stage 3 Setup

## Development Environment

1. Install Node.js 20 LTS or newer.
2. Run `npm install` from the repository root.
3. Run `npm run dev`.

## Validation Commands

- `npm run typecheck`
- `npm run build`

## Manual Stage 3 Validation Flow

1. Launch the app with `npm run dev`.
2. Open an Obsidian vault.
3. Open settings and confirm the displayed card-store path.
4. Optionally choose a custom card-store folder and confirm the vault rebuild completes.
5. Create or edit a markdown note so it contains a valid pair of card boundaries:

```md
%%CW_CARD_START uid:CW-001%%
Polymorphism lets one interface support multiple underlying implementations.
%%CW_CARD_END uid:CW-001%%
```

6. Save the note and confirm a matching `CW-001.json` file exists in the configured card-store folder.
7. Confirm the JSON file includes `referenced_in[0].note_path`, `start_line`, and `end_line`.
8. Switch to Cards view and confirm the parsed card, file path, and line numbers appear.
9. Edit the note so the boundary block moves to different lines, save again, and confirm the line numbers update in the JSON file.
10. Remove the card boundary block from the note, save again, and confirm the reference is removed if the note parses cleanly.
11. Introduce a malformed boundary and confirm Cards view shows diagnostics while destructive cleanup is skipped.
12. Modify or delete a markdown file externally and confirm the watcher updates the card-store references.

## Delivered Stage 3 Features

- strict parser for paired UID boundaries
- per-card JSON storage with configurable path
- persisted per-vault card-store configuration
- sync on vault open, note save, index refresh, and external markdown changes
- non-destructive malformed-note handling
- read-only Cards workspace for parsed cards and diagnostics

## Not In Scope

- Crashpad card authoring and undo/redo
- Weaver modes and approval UX
- card-level review execution
- automatic renderer refresh for externally created or deleted note files
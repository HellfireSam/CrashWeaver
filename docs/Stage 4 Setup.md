# Stage 4 Setup

## Development Environment

1. Install Node.js 20 LTS or newer.
2. Run `npm install` from the repository root.
3. Run `npm run dev`.

## Validation Commands

- `npm run typecheck`
- `npm run build`

## Manual Stage 4 Validation Flow

1. Launch the app with `npm run dev`.
2. Open a vault.
3. Confirm `.crashweaver` is visible in the explorer tree and that its internal directories and card JSON files are shown when the card store lives inside the vault.
4. Click the Crashpad widget and confirm the app opens or creates the daily crashpad named `YYYY-MM-DD.crashpad.json`.
5. Confirm markdown notes still expose `Source`, `Preview`, and `Cards` tabs, while the crashpad editor does not.
6. Create an additional crashpad canvas file from the crashpad editor, then reopen it directly from the explorer tree.
7. Use `Create New Card` to create a card by UID.
8. Edit card fields in the crashpad editor and save.
9. Verify the corresponding card JSON file in the configured card store reflects the edits.
10. Use the inline `Open Existing Card` UID control to attach an existing card to the crashpad.
11. Delete an attached existing card and verify:
   - strict confirmation behavior if enabled
   - the inline boundary-removal toggle defaults to the configured preference
   - deleted card snapshot appears in crashpad file history
12. Use undo and redo and verify card-store state and crashpad active/deleted lists change accordingly.
13. Change crashpad delete preferences and verify they persist after app restart.

## Delivered Stage 4 Features

- multiple crashpad canvas files per vault (`.crashweaver/crashpads/*.crashpad.json`)
- crashpad files available directly in the explorer tree
- card-store JSON files visible in the explorer tree when the configured card store is inside the vault
- all discovered `.crashweaver` directories visible in the explorer tree
- daily crashpad widget keyed to local date (`YYYY-MM-DD`)
- markdown-only `Source` / `Preview` / `Cards` view tabs
- create/open crashpad workflows
- card authoring over shared card store: create, edit, delete
- delete behavior by card origin with configurable confirmations
- optional note boundary removal during existing-card delete
- crashpad snapshot history for deleted cards
- session-level undo/redo for crashpad actions

## Not In Scope

- Weaver mode generation and planning
- accept-reject diff review layer
- card scheduling/review queue execution
- persistent undo/redo history across app restarts

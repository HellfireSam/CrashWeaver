# Stage 6 Setup & Validation

## Prerequisites

- Stage 5 complete (Weaver proposal generation works end-to-end)
- Mock vault available at `mock-vault/`
- OpenRouter API key configured (or stub provider for demo mode)

## Build & Typecheck

```powershell
# Electron main process
npm run build:main
# Should exit clean, no errors

# Renderer typecheck
npx tsc --noEmit
# Only pre-existing vite.config.ts error should remain
```

## Unit Tests

```powershell
# Run all Stage 6 apply service tests (21 tests)
node --test tests/electron/weaveApplyService.test.cjs

# Run all existing tests to verify no regressions
npm test
```

Expected: All 21 weaveApplyService tests pass, covering:
- Insert boundary pair (5 placements)
- Edit note content (success, missing text, boundary integrity)
- Create note (success, duplicate)
- Rename/move/delete note
- Directory create/rename/delete
- Dry-run mode
- stopOnError (default and disabled)
- Path escape prevention
- Unknown operation kind

## Manual Validation

### 1. Guided Insert Apply Flow

1. Open the mock vault in CrashWeaver
2. Open a crashpad (e.g., `2026-06-21.crashpad.json`)
3. Ensure the Weaver panel is visible (right sidebar, toggle LLM)
4. Type an intent: "Insert this card into the architecture notes"
5. Click **Generate**
6. Verify:
   - Operations render with diff previews (expand each `<details>`)
   - `insert-boundary-pair` shows green `+` lines with boundary markers
   - `edit-note-content` shows unified diff (red `−` removed, green `+` added)
7. Use checkboxes to select some operations, click **Apply Selected**
8. Verify:
   - Non-destructive ops apply immediately
   - "✓ N applied, 0 failed" banner appears
   - Vault file tree refreshes
   - Target note has the new boundary pair

### 2. Intelligent Restructuring Apply Flow

1. Switch Weaver mode to **Intelligent**
2. Set strength to **Go Ham**
3. Type intent: "Reorganize the programming notes around concurrency"
4. Click **Generate**
5. Verify directory operations show path arrows (`old/path → new/path`)
6. Select a subset including directory operations
7. Click **Apply Selected**
8. Verify:
   - WeaverConfirmDialog appears for destructive ops (rename/move/delete)
   - Dialog lists each destructive operation with path
   - Red warning about irreversible changes
   - Checkbox must be acknowledged before Confirm enables
   - Cancel dismisses dialog, nothing applied
   - Confirm applies all selected operations

### 3. Destructive Operations Confirmation

1. Generate a plan that includes `delete-note` or `delete-directory` operations
2. Click **Apply Selected** with those operations checked
3. Verify:
   - Confirm dialog appears with ⚠ icon
   - Lists the destructive operations
   - "These changes cannot be undone automatically" warning
   - Checkbox: "I understand these changes will modify my vault files"
   - **Cancel** → dialog closes, nothing applied
   - **Confirm** (after checking box) → operations applied
4. Verify the deleted note/directory is actually removed from vault

### 4. Apply Result Feedback

1. Apply some operations successfully
2. Verify green banner: "✓ N applied, 0 failed"
3. Generate a plan, then externally delete one of its target notes
4. Apply the plan
5. Verify:
   - Failed operation shows in results
   - "⚠ N applied, M failed" banner
   - Failed operation error message is visible

### 5. Error State Handling

1. Without a vault open, attempt to apply → should show error
2. With mock vault, delete a target file externally, then apply → per-operation error
3. Verify non-failed operations in batch still succeed (stopOnError behavior)

## Visual Regression Checks

- Dark theme consistency: all new UI elements use existing `--weaver-*` CSS variables
- Diff colors: green for additions, red for removals, muted for context
- Confirm dialog: centered modal, backdrop blur, red-tinted header
- Apply banner: green for success, amber for partial
- No layout breakage: sidebar remains scrollable, panels don't overflow at narrow widths

## What Stage 6 Does NOT Include

- **No rollback/undo of applied operations** — deferred to Stage 8 hardening
- **No proposal persistence** between app restarts — proposals live only in session memory and JSONL logs
- **No diff for note content before/after in path operations** — rename/move/delete only show path changes
- **No batch preview summary** — each operation's diff is shown individually
- **No apply progress bar** — only a spinner/disabled button state during apply

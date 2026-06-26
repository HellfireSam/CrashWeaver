# Stage 6 Architecture — Approval Layer & Diff UX

## Purpose

Stage 6 implements the accept/reject diff gate that sits between Weaver proposal generation (Stage 5) and vault mutation. Until Stage 6, Weaver proposals are read-only staging documents. Stage 6 provides:

1. A backend **operation executor** that maps each of 10 `WeavePlanOperation` kinds to existing vault mutation services
2. An IPC channel (`weave:apply-plan`) for the renderer to invoke apply
3. Per-operation **diff previews** in the renderer so users can see exactly what each operation will change **before** approving
4. A **confirmation dialog** for destructive operations (delete, rename, move)
5. Per-operation **result feedback** after apply (success/failure per operation)

## Data Flow

```
WeaverProposalPanel (renderer)
  │
  │ User selects operations → clicks "Apply Selected" / "Apply All"
  │
  ▼
App.tsx → handleApplyWeaveOperations()
  │
  │ Check for destructive ops → WeaverConfirmDialog if needed
  │
  ▼
window.crashWeaver.applyWeavePlan(rootPath, operations)
  │
  │ IPC: weave:apply-plan
  │
  ▼
main.ts → applyWeaveOperations(rootPath, cardStorePath, operations)
  │
  │ weaveApplyService.ts dispatches each operation kind:
  │
  ├── insert-boundary-pair → read note, insert boundary block, writeTextAtomically, syncNoteToCardStore
  ├── edit-note-content   → read note, replace text (RegExp), verify boundary integrity, writeTextAtomically
  ├── create-note         → build markdown with boundary pair, writeTextAtomically, auto-create card JSON
  ├── rename-note         → fs.rename, update card referenced_in paths
  ├── move-note           → same as rename (different target dir)
  ├── delete-note         → remove card references, fs.rm note
  ├── create-directory    → fs.mkdir
  ├── rename-directory    → fs.rename
  ├── move-directory      → fs.rename
  └── delete-directory    → fs.rm (recursive)
  │
  ▼
Return WeaveApplyResult (per-operation ok/error/warning/affectedPaths)
  │
  ▼
App.tsx → setWeaveApplyResult → refresh vault index
  │
  ▼
WeaverProposalPanel → show apply result banner
```

## Key Design Decisions

### No external diff library
The diff preview uses a simple LCS-based line diff algorithm (~50 lines in `WeaverDiffPreview.tsx`). This avoids adding an npm dependency for what is essentially string splitting, LCS DP table, and backtracking.

### Confirmation only for destructive operations
- `insert-boundary-pair`, `edit-note-content`, `create-note`, `create-directory` apply without confirmation
- `delete-note`, `delete-directory`, `rename-*`, `move-*` trigger the `WeaverConfirmDialog` modal requiring explicit checkbox acknowledgment

### Stop on first error (default)
If one operation fails (e.g., target file missing, boundary integrity violated), the executor stops and marks remaining operations as skipped. This prevents cascading corruption. The `stopOnError: false` option allows continuing past failures for non-critical batches.

### Boundary integrity after edits
After `edit-note-content` and `insert-boundary-pair`, the apply service runs `parseCrashCardsFromNote()` to verify all `%%CW_CARD_START/END%%` pairs remain balanced. If the edit accidentally removes or corrupts a boundary marker, the operation fails with a clear diagnostic message.

### Auto-create card JSON for create-note
When Weaver proposes `create-note` with a `cardUid`, the apply service creates a minimal card JSON in the card store if one doesn't already exist. This ensures the boundary pair in the new note always has a backing card.

### Dry-run mode
`applyWeaveOperations` supports `dryRun: true` for pre-validation. All checks run but no files are modified. Useful for testing or pre-flight checks in future UI enhancements.

## File Inventory

### New files
| File | Purpose |
|------|---------|
| `electron/weaver/weaveApplyService.ts` | Operation executor dispatching 10 operation kinds to mutation services |
| `src/components/WeaverDiffPreview.tsx` | Per-operation before/after visualization with LCS line-diff |
| `src/components/WeaverConfirmDialog.tsx` | Modal confirmation for destructive operations |
| `tests/electron/weaveApplyService.test.cjs` | 21 unit tests covering all operation kinds, dry-run, stopOnError, safety |

### Modified files
| File | Changes |
|------|---------|
| `electron/vault-contract.ts` | Added `WeaveApplyOperationResult`, `WeaveApplyResult` types |
| `electron/main.ts` | Added `weave:apply-plan` IPC handler, imported `applyWeaveOperations` and `WeavePlanOperation` |
| `electron/preload.ts` | Exposed `applyWeavePlan` bridge method, imported `WeaveApplyResult` and `WeavePlanOperation` |
| `src/vite-env.d.ts` | Declared `applyWeavePlan` type in Window interface |
| `src/state/WeaverContext.tsx` | Added `weaveApplyResult`, `isApplyingWeavePlan`, `weaveApplyError` state with setters |
| `src/components/WeaverProposalPanel.tsx` | Integrated `WeaverDiffPreview` in operation body, added `applyResult`/`isApplying` props, disabled apply buttons during apply, added apply result banner |
| `src/components/InspectorPane.tsx` | Added `onWeaveApplyOperations`, `weaveApplyResult`, `isApplyingWeavePlan` props, wired through to `WeaverProposalPanel` |
| `src/App.tsx` | Added `handleApplyWeaveOperations` callback, `WeaverConfirmDialog` rendering, `pendingDestructiveOps` state, wired all new props to `InspectorPane` |
| `src/styles/weaver.css` | Added ~200 lines of CSS for `.weaverDiff*`, `.weaverConfirm*`, `.weaverApplyResult*` classes |

### Key existing services reused (not modified)
- `electron/cardParser.ts` — `formatCardStartBoundary`, `formatCardEndBoundary`, `parseCrashCardsFromNote`
- `electron/cardStoreService.ts` — `readCardDocument`, `cardDocumentExists`, `getCardFilePath`, `upsertCardReference`
- `electron/cardSyncService.ts` — `syncNoteToCardStore`
- `electron/services/cardBoundaryService.ts` — `removeCardBoundaryLines`, `replaceCardBoundaryUids`
- `electron/services/cardReferenceMutationService.ts` — `removeCardBoundariesAcrossReferences`, `renameCardBoundariesAcrossReferences`
- `electron/services/noteReferenceMutationService.ts` — `readReferenceNoteContent`, `resolveReferenceNotePath`
- `electron/utils/jsonFile.ts` — `writeTextAtomically`, `writeJsonAtomically`
- `electron/utils/fsErrors.ts` — `getFsErrorCode`
- `electron/utils/paths.ts` — `toPosixPath`

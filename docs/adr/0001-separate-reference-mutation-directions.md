# ADR-0001: Keep the note-to-card and card-to-note reference mutations separate

- **Status:** accepted
- **Date:** 2026-11-18
- **Ticket:** [#22](https://github.com/HellfireSam/CrashWeaver/issues/22)

## Context

Two code paths update the relationship between notes and cards, and from opposite ends they look
like the same operation, so the obvious tidy-up is to make one call the other. They are not the
same operation.

**Note → card: the weaver path-mutation handlers.** `applyRenameNote`/`applyMoveNote` and
`applyDeleteNote` in `electron/weaver/weaveApplyPathHandlers.ts` run when a _note_ changes path or
disappears. They read the note's text, parse the boundary UIDs it contains, and write the card
store: a rename rewrites every `referenced_in` entry that carries the old note path, and a delete
prunes the deleted note's entries and reports the cards it orphaned. They never rewrite note
prose, never call `syncNoteToCardStore`, and never delete a card file.

**Card → note: the reference mutation services.** `renameCardBoundariesAcrossReferences` and
`removeCardBoundariesAcrossReferences` in `electron/services/cardReferenceMutationService.ts`, plus
`reinsertCardBoundariesForReferences` in `cardRestoreMutationService.ts` for restore, run when a
_card's UID_ is renamed, its boundaries must be removed from the notes, or a deleted card is
restored. The caller reads one card's `referenced_in` and passes those note paths in; the service
opens each named note, replaces, strips or reinserts the matching `%%CW_CARD_START/END%%` lines,
writes the note and re-syncs it to the card store. The service itself writes no card JSON, but the
note re-sync it triggers rewrites `referenced_in` to match the note's new boundary state — it adds
the renamed card's reference, prunes the old one, or re-adds the restored one.

Wiring the services into the handler paths is destructive rather than de-duplicating:

- `applyDeleteNote` calling `removeCardBoundariesAcrossReferences` would walk the deleted card's
  `referenced_in` and strip that card's boundaries from **every other note** that references it,
  while dropping the stale-reference pruning `applyDeleteNote` exists to do.
- `applyRenameNote` calling `renameCardBoundariesAcrossReferences` would rename card UIDs inside
  markers — a card identity change — instead of renaming a note path. The two operations share
  neither input nor output.

## Decision

The two directions stay separate. Each owns one traversal and one kind of write, and each is
tested at its own seam: the weaver handlers are pinned by
`tests/electron/weaveApplyService.test.ts`, the services by
`tests/electron/cardReferenceMutationService.test.ts`.

The comment above the path-mutation handlers in `weaveApplyPathHandlers.ts` carries the short form
of this warning, so the next reader does not have to rediscover it; the full rationale is here and
the two directions are documented side by side in
[the data model](../architecture/data-model.md#two-mutation-directions).

## Consequences

- A "duplication" remains visible in the codebase. It is deliberate, not an oversight; the comment
  above the path-mutation handlers and this ADR name each other.
- Behaviour is unchanged: no note loses boundaries it should keep and no reference pruning is
  dropped, because neither path was rewired.
- No new test seam is introduced. If a future change genuinely needs one direction to call the
  other, this ADR must be revisited with characterization tests proving both the boundary
  preservation and the reference pruning.

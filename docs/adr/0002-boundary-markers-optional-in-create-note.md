# ADR-0002: Keep UID boundary markers optional in a create-note plan

- **Status:** accepted
- **Date:** 2026-11-19
- **Ticket:** [#4](https://github.com/HellfireSam/CrashWeaver/issues/4)

## Context

A weave plan used to be rejected when its note payloads omitted the focused card's
`%%CW_CARD_START uid:<UID>%%` / `%%CW_CARD_END uid:<UID>%%` pair. Stage 6 (`856d826`) made the
markers optional for `create-note` deliberately and updated the prompts in the same commit; the
stale test that still expected a throw was rewritten to assert the new behaviour in the green
baseline. Nothing compensated for the change, so [#4](https://github.com/HellfireSam/CrashWeaver/issues/4)
asked whether the optionality is a gap to close or an intentional behaviour to record.

The operation that exists to place boundaries, `insert-boundary-pair`, still requires both markers
in its `payload.boundaryBlock` (`assertBoundaryBlockIncludesCard`), and the prompts still promise
that. Only `create-note` is exempt: `assertCreateNoteHasSubstantiveContent` ignores markers and
enforces a 20-character trimmed prose floor.

## Decision

Keep the markers optional in a `create-note` payload's `content`; the prose floor is the only
content rule. The schema and the prompts agree on this, and the acceptance behaviour is pinned by
three characterisation tests in `tests/electron/weavePlanSchema.test.ts`.

Restoring validation was rejected: it would make the schema and the prompts disagree unless the
prompts changed back, it would reject legitimate prose-only notes, and the operation that places
boundaries already exists and is validated.

## Consequences

- A marker-less `create-note` writes the note content the plan authored. Whether the card then
  references that note depends on the card's existence:
  - **The focused card already exists** — the sync that follows the write finds no boundary in the
    new note, so the note does not reference the card at all. The note is prose-only.
  - **The card does not exist yet** — `applyCreateNote` auto-creates the card document and gives it
    a `referenced_in` entry for lines 1 to 3 of the new note (the heading line, the blank line and
    the content element as `applyCreateNote` counts them).
- That auto-created reference is not durable. The note carries no UID boundary, so it never appears
  in the parsed card list; the next sync of the note — an in-app note write, or any
  `updateIndex` / vault-index rebuild — compares the cards referencing the note with the parsed
  cards and removes the reference it cannot see. The card file stays on disk, orphaned.
- A plan that wants the created note to durably reference the card must either put the boundary
  pair in the `create-note` content or emit a separate `insert-boundary-pair` operation for that
  note. The prompts' create-note example adds no pair, so it produces exactly this orphan shape;
  nothing in the schema or prompts asks for a companion insert operation.
- The plan schema cannot reject a marker-less `create-note` as wrong: the review that turns the
  plan into a durable note is the user's approval gate, not schema validation. A review UI that
  wants to warn about this shape has to compare the plan's intent with the card's references
  itself.

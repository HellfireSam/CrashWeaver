# ADR-0003: Card-level review state is the only review state

- **Status:** accepted
- **Date:** 2026-11-19
- **Ticket:** [#28](https://github.com/HellfireSam/CrashWeaver/issues/28)

## Context

The repository carried two unrelated things called review. A card holds
`metadata.familiarity` and `metadata.next_review` — the scheduling state the review loop this
ADR belongs to actually uses. Separately, every vault-index entry carried a six-field
`ReviewMetadata` (`familiarity`, `lastReviewedAt`, `nextReviewAt`, `intervalDays`, `repetition`,
`easeFactor`) that no code consumed. The rework session decided to keep the index field as a
possible future _note-level_ review concept (its Q28), while explicitly recording the cost: two
distinct concepts share the word "review", and the decision should be revisited when card-level
scheduling arrived.

Card-level scheduling has now arrived. The scheduling shape is no longer hypothetical: it is four
responses over a small, specified state. Keeping a second, unused copy of the same SM-2-shaped
state on notes means the store persists a shape nothing owns, the glossary has to defend two
meanings of "review", and a future note-level review would be constrained by a placeholder chosen
before the feature existed.

## Decision

Card JSON is the only home of review state. `VaultIndexEntry` loses `review`, the `ReviewMetadata`
type is deleted, and `VaultIndex.version` becomes `2`. A version 1 index is still read — its
entries, ids and tags are preserved — and the next write drops the field and writes version 2.

A future note-level review is not pre-empted: when it is specified it gets its own shape, version
and migration. Nothing about the card-level loop depends on notes carrying scheduling state.

## Consequences

- One review concept in the code, the glossary and the documentation.
- Reading a version 1 index is tolerant; its `review` field is silently discarded on rewrite, which
  is acceptable because neither value was ever consumed.
- Reintroducing note-level review later is a deliberate schema change, not a revival of dead state.
- The card store is now the only durable scheduling surface, so the review loop's writer is the
  card store writer.

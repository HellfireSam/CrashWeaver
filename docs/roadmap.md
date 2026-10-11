# Roadmap

Where the project is and what comes next. This is the one current document that is not
derived from the code: it records intent. Everything about how the system works today lives in
[the architecture documents](./architecture/overview.md) and
[the reference documents](./reference/card-schema.md).

## Where the project is

CrashWeaver was built in stages. Stages 1 to 6 are complete:

| Stage | Scope | State |
| --- | --- | --- |
| 1. Shell foundation | Electron shell, preload bridge, renderer base | complete |
| 2. Vault backend and editor shell | Vault open/read/write/index, editor shell | complete |
| 3. Crash Card parser and card store sync | Strict UID parser and reference sync | complete |
| 4. Crashpad canvas and card authoring | Crashpad files, card CRUD, undo/redo | complete |
| 5. Weaver planning and guided insert | Guided insert with optional content permissions, intelligent restructuring, live provider path, session history, progress feed, budget controls, embedding search | complete |
| 6. Approval layer and diff UX | Explicit accept/reject review before any Weaver write, apply service for all operation kinds, per-operation diff previews, destructive-operation confirmation | complete |

## The rework in flight

Before any further feature work, the repository is being brought up to a professional standard:
this documentation rewrite, enforced lint and formatting, a one-command gate in CI, a single test
runner, splitting the oversized modules, and centralising the IPC channel contract. Stage 7 waits
for that rework, because feature work on a repository that cannot state what is true or prove a
change is safe is the problem the rework exists to remove.

## Stage 7: card-level scheduling and review

The review loop does not exist yet. Its data does: a card carries `metadata.familiarity` (how
well the card is known) and `metadata.next_review` (when it becomes due), and the card metadata
panel and crashpad card editor are where they are read and written. Stage 7 is the scheduling
loop over those two fields.

One piece of state is already reserved for this stage. Each vault-index entry carries a
`ReviewMetadata` with a wider shape — `familiarity` plus `lastReviewedAt`, `nextReviewAt`,
`intervalDays`, `repetition` and `easeFactor` — which is written with defaults and whose
scheduling values are consumed nowhere today. It is kept
deliberately as a future concept rather than deleted; see
[the data model](./architecture/data-model.md) for where both copies live.

## Stage 8: hardening and release preparation

Integration coverage and release checks: packaging, signing and distribution were explicitly out
of scope for the rework and are not started.

## Known gaps

Real limitations of the current code, recorded here rather than implied away in the docs:

- Crashpads cannot be renamed or deleted through the app.
- Crashpad undo and redo are not scoped to a crashpad: the stacks survive switching crashpads, so an
  undo can replay entries against the wrong one.
- Renaming or moving a directory rewrites no card references and no note paths, although renaming a
  note does.
- Weaver dry-run reports success without running the validation the real apply runs.
- Boundary-integrity verification is not called on note delete or rename.
- A note rename updates only the first matching reference entry per card.
- The parser accepts interior whitespace in a boundary marker that the mutation services cannot
  match, and a Weaver-supplied block can place such a pair: it parses, but it is never stripped or
  UID-renamed afterwards.
- The `warning` diagnostic severity is declared but never produced.

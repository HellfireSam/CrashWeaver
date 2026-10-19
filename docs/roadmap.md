# Roadmap

An indicative record of the development steps that produced CrashWeaver, and of what is planned
next. It is **not a specification and not ground truth**: the code is the only authority for what
exists, and where this file and the code disagree, the code wins. Everything about how the system
works today lives in [the architecture documents](./architecture/overview.md) and
[the reference documents](./reference/card-schema.md).

## Development steps so far

The application was built in stages. The table records the steps in the order they were taken; the
state is a note about that sequence, not a verification.

| Step | Scope | State |
| --- | --- | --- |
| 1. Shell foundation | Electron shell, preload bridge, renderer base | reached |
| 2. Vault backend and editor shell | Vault open/read/write/index, editor shell | reached |
| 3. Crash Card parser and card store sync | Strict UID parser and reference sync | reached |
| 4. Crashpad canvas and card authoring | Crashpad files, card CRUD, undo/redo | reached |
| 5. Weaver planning and guided insert | Guided insert with optional content permissions, intelligent restructuring, live provider path, session history, progress feed, budget controls, embedding search | reached |
| 6. Approval layer and diff UX | Explicit accept/reject review before any Weaver write, apply service for all operation kinds, per-operation diff previews, destructive-operation confirmation | reached |

## The rework in flight

Before any further feature work, the repository is being brought up to a professional standard:
this documentation rewrite, enforced lint and formatting, a one-command gate in CI, a single test
runner, splitting the oversized modules, and centralising the IPC channel contract. Feature work
waits for that rework, because feature work on a repository that cannot state what is true or prove
a change is safe is the problem the rework exists to remove.

## Planned next

### Card-level scheduling and review

The review loop does not exist yet. Its data does: a card carries `metadata.familiarity` (how well
the card is known) and `metadata.next_review` (when it becomes due), and the card metadata panel and
crashpad card editor are where they are read and written.

The intended function is that the user reviews notes, and the app uses each card's familiarity
together with a standard spaced-repetition algorithm to compute the next recommended review time,
which `metadata.next_review` then records. The range for familiarity and the date format for
`next_review` will be specified with that function; until then the store enforces neither.

One piece of state is already reserved for this step. Each vault-index entry carries a
`ReviewMetadata` with a wider shape — `familiarity` plus `lastReviewedAt`, `nextReviewAt`,
`intervalDays`, `repetition` and `easeFactor` — which is written with defaults and whose scheduling
values are consumed nowhere today. It is kept deliberately as a future concept rather than deleted;
see [the data model](./architecture/data-model.md) for where both copies live.

### A boundary-marker visibility toggle

Boundary markers stay markdown comments. Authors need to see them in edit mode so they can place a
pair where it belongs. A view mode that toggles marker visibility — visible while authoring, hidden
otherwise — is a future convenience, not a change to the format.

### Card type suggestions

`type` stays free-form. The app should show the card types already used in the selected vault, so a
type can be reused instead of retyped.

### Hardening and release preparation

Integration coverage and release checks: packaging, signing and distribution were explicitly out of
scope for the rework and are not started.

## Known gaps

Real limitations of the current code, recorded here rather than implied away in the documents:

- Crashpads cannot be renamed or deleted through the app. The final application should support
  both: a rename moves the crashpad file and carries its cards and deleted-card snapshots across,
  and a delete removes the file.
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

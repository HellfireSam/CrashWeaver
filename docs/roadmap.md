# Roadmap

An indicative record of the development steps that produced CrashWeaver, and of what is planned
next. It is **not a specification and not ground truth**: the code is the only authority for what
exists, and where this file and the code disagree, the code wins. Everything about how the system
works today lives in [the architecture documents](./architecture/overview.md) and
[the reference documents](./reference/card-schema.md).

## Development steps so far

The application was built in stages. The table records the steps in the order they were taken; the
state is a note about that sequence, not a verification.

| Step                                     | Scope                                                                                                                                                                       | State   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1. Shell foundation                      | Electron shell, preload bridge, renderer base                                                                                                                               | reached |
| 2. Vault backend and editor shell        | Vault open/read/write/index, editor shell                                                                                                                                   | reached |
| 3. Crash Card parser and card store sync | Strict UID parser and reference sync                                                                                                                                        | reached |
| 4. Crashpad canvas and card authoring    | Crashpad files, card CRUD, undo/redo                                                                                                                                        | reached |
| 5. Weaver planning and guided insert     | Guided insert with optional content permissions, intelligent restructuring, live provider path, session history, progress feed, budget controls, embedding search           | reached |
| 6. Approval layer and diff UX            | Explicit accept/reject review before any Weaver write, apply service for all operation kinds, per-operation diff previews, destructive-operation confirmation               | reached |
| 7. Repository rework                     | Green baseline, one-command gate in CI, documentation consolidation, one test runner, module splits, naming rule, IPC channel contract, card titles that may contain spaces | reached |
| 8. Card review loop                      | Due-card queue, dedicated review surface, four-response SM-2-OSR scheduling on card metadata, card-level state only, note-level review metadata removed, ADR-0003/ADR-0004  | reached |

## The rework (completed)

Before further feature work, the repository was brought up to a professional standard: the
documentation rewrite, enforced lint and formatting, a one-command gate in CI, a single test runner,
the oversized-module splits, the naming rule and the centralised IPC channel contract. GitHub issue
#1 tracked it, and #24 — card titles that may contain spaces — was its last ticket. Feature work can
now resume on a repository that can state what is true and prove a change is safe.

## Planned next

### Review loop follow-ups

The loop schedules cards, and deliberately stops there. Deferred, in rough order of value:

- **Due visibility**: a due count/badge and a due filter in the Cards workspace (CRUD views are
  currently read-only about schedules).
- **A daily review entry point**: a "review today" surface, the shape the Obsidian reference started
  from.
- **Review history and statistics** — requires storing per-review events, which SM-2-OSR does not
  need and v1 does not keep.
- **Active-recall mode**: reveal the card after a prompt instead of reading it, plus a shuffle.
- **Algorithm refinements**: deterministic load balancing and late-review compensation, both of
  which the reference plugin has and v1 deliberately omits (ADR-0004).
- **A note-level review workflow**, which would need its own scheduling state now that the
  placeholder index field is gone (ADR-0003).

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

- The review loop has no history: only the latest scheduling state is kept, so "what did I rate
  last month" cannot be answered, and no statistics can be computed.
- A hand-dropped card file whose filename is outside the UID grammar can appear in the review
  queue; its preview fails the store's validation, the session reports the error and drops it.
- The scheduler has no load balancing or late-review compensation; every card rated in one batch
  shares a due date (ADR-0004 records the trade-off).
- Scheduling constants are not configurable; changing them means editing
  `electron/services/reviewScheduling.ts` and invalidating the assumption that a vault's state is
  comparable.
- Reviewing is only reachable from the widget rail; there is no due badge, due filter, statistics
  view, reminder or daily/periodic entry point.

- Crashpads cannot be renamed, deleted, or created by name through the app; the daily crashpad is
  the only creation path wired up. The final application should support all three: a rename moves
  the file and carries its cards and deleted-card snapshots across, a delete removes the file, and
  a control creates one under a chosen name.
- Crashpad undo and redo are not scoped to a crashpad: the stacks survive switching crashpads, so an
  undo can replay entries against the wrong one.
- Renaming or moving a directory rewrites no card references and no note paths, although renaming a
  note does.
- Weaver dry-run reports success without running the validation the real apply runs.
- The parser accepts interior whitespace in a boundary marker that the mutation services cannot
  match, and a Weaver-supplied block can place such a pair: it parses, but it is never stripped or
  UID-renamed afterwards.
- The `warning` diagnostic severity is declared but never produced, and duplicate-UID pairs reuse the
  `mismatched-boundary-uid` error code; a non-blocking diagnostic tier is not implemented.

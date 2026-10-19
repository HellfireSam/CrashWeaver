# Documentation rewrite: open questions and owner decisions

The documentation was rewritten from scratch in issue #3. Because the rewrite is grounded in code,
every claim about **mechanism** is verifiable; this file records the places where a **product rule or
intention** could not be derived from the code. Each item was put to the owner with a recommendation.

Status: **the owner answered on 2026-10-11.** Ten items are resolved and reflected in the documents;
one was not answered and one asked for an explanation, and both are still marked in place with
`> Open question:`. The remaining recorded questions have no decision yet and are listed at the end.

---

## Resolved decisions

### A1 — the card store is a configurable second storage root

**Decision (owner):** follow the recommendation. The vault rule covers notes and their boundaries;
the card store defaults inside the vault but can be configured elsewhere, and the app's own settings
file lives outside it.

**Applied:** `CONTEXT.md`'s Vault definition is scoped; the callouts in
`docs/architecture/overview.md` and `docs/architecture/data-model.md` are replaced with factual
statements.

### A2 — request logs and the embedding cache are outside the approval gate

**Decision (owner):** follow the recommendation. Weaver request logs and the embedding cache are
Weaver-owned diagnostics and caches; the gate's guarantee covers notes, boundaries and card
payloads.

**Applied:** `CONTEXT.md`'s Approval gate definition is scoped; the callout in
`docs/architecture/overview.md` is replaced with a factual statement.

### A3 — the roadmap is indicative, not ground truth

**Decision (owner):** the roadmap should act as an indicative note of the development steps taken,
and must not be treated as ground truth.

**Applied:** `docs/roadmap.md` is reframed: the introduction says the code is the only authority and
wins where the two disagree, "Where the project is" becomes "Development steps so far" (steps
"reached" rather than verified completions), and the future work is under "Planned next".

### B1 — crashpad rename and delete are known gaps for the final application

**Decision (owner):** record as a known gap; the final application should be able to perform both.

**Applied:** the callout in `docs/architecture/data-model.md` is replaced with the statement and a
pointer to the roadmap; the roadmap's known-gap entry now says the final application should support
a rename that carries the crashpad's contents and a delete that removes the file.

### B3 — boundary markers stay markdown comments

**Decision (owner):** the boundary markers should remain markdown comments. A view that toggles
their visibility would be a nice future option; users are expected to see them in edit mode so they
can insert a pair where necessary.

**Applied:** the callout in `docs/reference/boundary-format.md` is replaced with the decision; a
"boundary-marker visibility toggle" item is added to the roadmap's planned work.

### B4 — card types stay free-form

**Decision (owner):** keep `type` free-form, and retain a list of the types currently used in the
selected vault inside the application so the user can reuse them.

**Applied:** `docs/reference/card-schema.md` and `docs/reference/card-insert-templates.md` state the
intended in-app used-types list; the roadmap records it as planned work.

### B5 — the `fill_in_the_blanks` shape is removed

**Decision (owner):** remove the legacy shape; `qa_pairs` is the only shape.

**Applied:** `toLegacyFillQaPairs` and its call are removed from
`electron/cardStoreService.ts`; the legacy migration is removed from `card-schema.md`,
`card-insert-templates.md` and `data-model.md`. The full gate was run after the change.

### B6 — `mock-vault_sample/` is a retained pristine copy

**Decision (owner):** `mock-vault_sample/` was created as a copy users can open and test against
without ruining the original `mock-vault/` image. It is deliberately retained; only the template
gallery is furniture to remove.

**Applied:** both documents that describe the sample directories now say this; ticket #7's scope was
corrected (it previously said the duplicate sample vault would be deleted) and a comment records the
change.

### B7 — parser/mutator whitespace mismatch stays a documented gap

**Decision (owner):** follow the recommendation — document current behaviour as a known gap and
track tightening as a code change.

**Applied:** already stated in `docs/reference/boundary-format.md` and the roadmap's known gaps. No
code change.

### B8 — familiarity and next review feed a future review scheduler

**Decision (owner):** this is a future function in which users review notes based on their
familiarity and popular knowledge-review algorithms, to calculate the next recommended review time.

**Applied:** the callouts in `docs/reference/card-schema.md` and `docs/guides/using-crashweaver.md`
are replaced with the intended function; the roadmap's "Card-level scheduling and review" entry
describes it.

### B2 — the `warning` severity stays error-only, tracked as a gap

**Decision (owner):** follow the recommendation. The diagnostic type is documented as error-only in
practice, and a non-blocking tier (with its own code for duplicate pairs) is tracked as a gap.

**Applied:** the callout in `docs/reference/boundary-format.md` is replaced with the decision; the
roadmap's known-gap entry now also notes that duplicate-UID pairs reuse the `mismatched-boundary-uid`
error code.

### B9 — unknown card JSON keys keep being dropped

**Decision (owner):** follow the recommendation. Unknown keys are dropped on read and write, and a new
card field must arrive with a deliberate migration rather than relying on passthrough.

**Applied:** the callout in `docs/reference/card-schema.md` is replaced with the decision and its
rationale.

### C1 — Weaver dry run stays containment-only

**Decision (owner):** follow the recommendation. Dry run's contract is that it checks vault
containment and writes nothing; turning it into full pre-flight validation is apply-service work, not
a documentation change.

**Applied:** the callout in `docs/architecture/weave-pipeline.md` is replaced with the decision, and
the `dryRun` doc comment in `electron/vault-contract.ts` now states the actual behaviour instead of
"validate operations but don't write anything". The roadmap still records the limitation.

### C2 — window geometry is fixed and not persisted

**Decision (owner):** follow the recommendation. Document current behaviour rather than invent a
persistence rule.

**Applied:** the callout in `docs/architecture/process-model.md` is replaced with the statement that
the window opens at 1320 by 860 every time and geometry is not remembered.

### C3 — crashpad creation by name is intended

**Decision (owner):** follow the recommendation. The daily crashpad is the only creation path today;
a "new crashpad" control is intended alongside rename and delete.

**Applied:** the callout in `docs/guides/using-crashweaver.md` is replaced with the statement; the
roadmap's known-gap entry and `docs/architecture/data-model.md` now cover creating a crashpad under a
chosen name alongside rename and delete.

---

## Other recorded observations with no decision yet

These are not blockers; the documents describe current behaviour and the roadmap lists the ones that
are limitations.

- **Crashpad undo/redo scope** — the stacks are session-wide, so an undo after switching crashpads
  replays against the wrong one. Recorded as a known gap; recommendation is a per-crashpad stack.
- **`requireStrictConfirmationForExistingCards`** is never read by the renderer; the delete gate uses
  the new-cards preference for every card.
- **Default editor draft** pre-fills `Inbox/Stage-2-scratch.md` and `# Stage 2 Scratch Note`, which
  reads as leftover scratch content rather than a blank note.
- **Vault alias, editor font size, tabs and view state are in memory only** and do not survive a
  restart.
- **`"No operations selected to apply."`** is unreachable from the panel; it is defensive only.
- **`weaveTraceCompactor`** has no production caller; the graph truncates the trace inline.
- **`safety-error`** is declared but never raised; vault-escape failures surface as ordinary
  validation errors.
- **The request-logs directory setter** has no UI caller.
- **Some contract types never cross the bridge** (`WeaveModelProvider`, `WeaverKeyStatus`,
  `CardSyncSummary`); `WeaverSettings.configured` is the renderer-facing API-key surface.
- **Settings split** — per-Vault for the card store and image directories, global for crashpad delete
  preferences and Weaver settings.

# Documentation rewrite: open questions

Intent gaps found while rewriting the documentation from scratch (issue #3). The rewrite is
grounded in code, so every claim about **mechanism** is verifiable. This file records the
places where a **product rule or intention** could not be derived from the code, and therefore
has to come from the owner rather than from a guess.

Rules applied while collecting these:

- No normative claim ships unverified. Where an answer is missing, the document either omits
  the claim or carries an `> Open question:` callout.
- Nothing here blocks the structural rewrite. Unanswered items stay open and visible rather
  than being silently invented.

Status: **awaiting owner answers**. Split into decisions that change wording (A) and items
recommended for confirmation (B).

---

## A. Decisions needed

### A1. Does the vault-boundary rule cover the card store?

`CONTEXT.md` defines the Vault as "the folder the user opens as their knowledge base. The app
reads and writes inside it and never outside." But the card store is configurable to any
directory: `electron/settingsService.ts`'s `setCardStorePath` stores `path.resolve(cardStorePath)`
with no vault check, and settings plus the API key live under Electron's `userData`, outside the
vault. Does the rule cover the card store, or only notes and boundaries?

**Recommendation.** Keep the configurable card store, and scope the glossary claim to note
content and boundaries: the card store defaults to `<vault>/.crashweaver/cards` but is an
explicitly configurable second storage root.

**Affects.** `CONTEXT.md` (Vault), `docs/architecture/overview.md`, `docs/architecture/data-model.md`.

### A2. Are Weaver request logs outside the approval gate?

`CONTEXT.md` says of the approval gate that "nothing is written before it", but planning writes on
disk: Weaver request logs under `<vault>/.crashweaver/weaver-request-logs` and an embedding cache at
`<vault>/.crashweaver/embeddings.json`. Are those outside the gate's scope?

**Recommendation.** Treat request logs and the embedding cache as Weaver-owned diagnostics, and scope
the gate's claim to notes, boundaries and card payloads.

**Affects.** `CONTEXT.md` (Approval gate), `docs/architecture/overview.md`, `docs/architecture/weave-pipeline.md`.

### A3. Is the roadmap right?

The only current status record was `Project Timeline.md`, which contradicts itself (Stage 6
appears as both complete and planned). `docs/roadmap.md` is therefore derived from the rework
spec that scoped this rewrite, not from the old timeline: Stages 1-6 complete, Stage 7
card-level scheduling and review, Stage 8 hardening and release preparation.

**Recommendation.** Confirm or correct that framing, including whether later stages keep their
names.

**Affects.** `docs/roadmap.md`.

---

## B. Recommended for confirmation

These have a clear recommendation, which is what the documents currently state. Confirm, or say
which to change.

### B1. Crashpads have no rename or delete

`electron/crashpadService.ts`'s `writeCrashpad` derives the file path from `document.id`, so
changing the id would write a second file and leave the first, and no IPC channel removes a
crashpad file. **Recommendation:** record as a known gap; the app does not offer the capability
today and the docs do not imply it does.

**Affects.** `docs/architecture/data-model.md`, `docs/roadmap.md`.

### B2. The `warning` diagnostic severity is never produced

`CardParseDiagnostic.severity` is declared `'warning' | 'error'`, but no producer emits
`'warning'`, and the duplicate-UID case reuses the `mismatched-boundary-uid` error code.
**Recommendation:** document the type as error-only in practice and track a non-blocking tier as
a gap.

**Affects.** `docs/reference/boundary-format.md`.

### B3. Are boundary markers visible syntax or author-invisible?

The `%%...%%` marker form is not interpreted anywhere: no comment stripping, no renderer
awareness. **Recommendation:** document current behaviour — markers are plain text, visible in
the editor and any markdown preview — and leave invisibility as a possible future change.

**Affects.** `docs/reference/boundary-format.md`, `docs/guides/using-crashweaver.md`.

### B4. Should `type` become a controlled vocabulary?

No code enumerates card types: `CardDocument.type` is `string[]`, the crashpad labels it
"Tags (comma-separated)", and tags steer Weaver retrieval.
**Recommendation:** keep `type` free-form and do not publish a taxonomy.

**Affects.** `docs/reference/card-schema.md`, `docs/reference/card-insert-templates.md`.

### B5. Is the legacy `fill_in_the_blanks` shape still intended input?

`coerceCardDocument` folds a legacy `{ sentence, answers }` shape into `qa_pairs`.
**Recommendation:** document it as accepted legacy input only, and keep the current `qa_pairs`
shape canonical.

**Affects.** `docs/reference/card-schema.md`.

### B6. `mock-vault/` and `mock-vault_sample/` are manual sample vaults

No code, test or tooling references either directory. **Recommendation:** document them as
checked-in sample vaults for manual exercise only. (`mock-vault_sample/` is deleted and
`mock-vault/` moves under `fixtures/` by a separate layout ticket.)

**Affects.** `docs/guides/development-setup.md`, `docs/architecture/overview.md`.

### B7. The parser and the boundary mutators disagree about marker whitespace

`electron/cardParser.ts`'s `START_BOUNDARY_PATTERN` accepts `\s+` between `%%CW_CARD_START` and
`uid:`, so `%%CW_CARD_START  uid:x%%` parses. The mutators in
`electron/services/cardBoundaryService.ts` compare against the canonical single-spaced marker
with strict equality, so such a line is never stripped or renamed.
**Recommendation:** document current behaviour as a known gap (the roadmap already lists it) and
track tightening the parser or normalising the mutator matching as a code change.

**Affects.** `docs/reference/boundary-format.md`, `docs/roadmap.md`.

### B8. `familiarity` and `next_review` have no declared scale or format

The store enforces no bound on `CardMetadata.familiarity` (any number passes, including `NaN`)
and no format on `next_review` (any string passes; only the crashpad editor placeholder says
"ISO date or blank"). **Recommendation:** state only what the code stores, and declare the
intended range and ISO-8601 format when Stage 7 specifies the review loop.

**Affects.** `docs/reference/card-schema.md`, `docs/roadmap.md`.

### B9. Unknown card JSON keys are dropped silently

`coerceCardDocument` returns a fresh object literal, so unknown keys in a hand-edited card file
are discarded on read and on write. **Recommendation:** keep the drop — it clears stale legacy
keys — and treat any new field as requiring a migration path rather than relying on passthrough.

**Affects.** `docs/reference/card-schema.md`.

---

## C. Noted and documented as current behaviour

Observations that came out of the rewrite and the adversarial verification. Each is a real fact about
the code, recorded here rather than turned into an invented rule. The recommendation for all of them
is to keep documenting current behaviour; none needs a product decision before this ticket closes.
The two that are missing capability rather than description are listed in the roadmap's known gaps.

- **Directory rename and move rewrite no card references or note paths**, while note rename and move
  do (`applyRenameDirectory` versus `applyRenameNote`).
- **`weaveTraceCompactor` has no production caller** — the graph truncates the trace inline and only
  the module's own test uses the compactor.
- **The `safety-error` category is declared but never raised**; vault-escape failures surface as
  ordinary validation errors.
- **The request-logs directory setter has no UI caller** — the bridge exposes it, Settings does not.
- **A comment in `buildWeaveContextSnapshot` anticipates embedding full note content on tool reads**,
  but nothing updates the embedding cache after the initial title/tag proxy.
- **Window geometry is not persisted**; `createMainWindow` uses fixed literals.
- **`webPreferences` sets only `preload`, `contextIsolation` and `nodeIntegration`** — no `sandbox`
  or `webSecurity` option is set. (Security review is out of scope for this rework.)
- **Some contract types never cross the bridge** (`WeaveModelProvider`, `WeaverKeyStatus`,
  `CardSyncSummary`), and `getWeaverKeyStatus` has no channel; `WeaverSettings.configured` is the
  renderer-facing API-key surface.
- **The settings split is per-Vault for the card store and image directories, global for crashpad
  delete preferences and Weaver settings** — a code fact, now stated in the process model.
- **Editor font size, vault alias and tab/view state are in memory only** and do not survive a
  restart.
- **No UI creates a named crashpad.** `useCrashpadActions` exposes `handleCreateCrashpad`, but no
  renderer call site consumes it; the only creation path is the daily crashpad button.
- **Crashpad undo and redo are not scoped to a crashpad.** The stacks live in `UIContext` and are
  cleared only on vault load and on crashpad creation, so an undo after switching crashpads replays
  entries against the currently active one. Listed as a known gap in the roadmap.
- **`requireStrictConfirmationForExistingCards` is never read by the renderer.** The delete gate uses
  `requireConfirmationForNewCards` for every card, so the stricter preference is inert.
- **The empty editor draft is pre-filled** with the path `Inbox/Stage-2-scratch.md` and the body
  `# Stage 2 Scratch Note`, which reads as leftover scratch content rather than a blank note.
- **`"No operations selected to apply."` is unreachable from the panel**, because the apply control is
  disabled when nothing is selected; it is defensive only.

---

## Resolved without the owner

- **Index-level `ReviewMetadata`.** `docs/architecture/data-model.md` flagged that scheduling
  state exists both in `CardMetadata` (card file, read by the UI) and in each index entry's
  `ReviewMetadata` (never read). This was already decided: the note-level copy is **kept
  deliberately** for the planned review loop. The documents state it as reserved, not as a defect.

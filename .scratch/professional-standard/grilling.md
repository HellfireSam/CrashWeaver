# CrashWeaver — Rework Grilling Record

**Status: grilling COMPLETE; `/to-spec` and `/to-tickets` done; implementation in progress.**
Q27 and Q30–Q32 are resolved and the glossary is confirmed. The spec is [GitHub issue
#1](https://github.com/HellfireSam/CrashWeaver/issues/1) (`ready-for-agent`), broken into 21 tickets
(#2–#22) with native blocking edges. All 21 are sub-issues of #1. **Closed: #2 (green baseline), #3
(documentation rewrite), #6 (absorbed into #3), #5 (lint + format), #7 (layout), #8 (gate + CI +
governance), #10 (Vitest batch 1), #9 (coding standards), #11 (Vitest batch 2), #12
(characterization tests) and #13 (pure renderer logic extraction).** The newest
tickets were closed on GitHub with their evidence comments. `main` carries **unpushed commits** —
the rework through #11, its record and the correction is on the remote.
Resume by reading this file — it is the authoritative record of what was decided and why.

- **Repo:** `/root/CrashWeaver` (clone of `github.com/HellfireSam/CrashWeaver`). Moved here from
  `/root/workspace01/CrashWeaver`; the old copy was verified identical (same HEAD, 419 tracked files,
  byte-identical trees, `fsck` clean) and then deleted. **This path is canonical — never write to the
  old location.**
- **Branch / HEAD at time of writing:** `main` @ `6760903`
- **Session date:** recorded during the grilling session that created this file
- **Committed work so far:** none of the rework. Only `AGENTS.md` + `docs/agents/` (agent-skills config) and this record.

---

## 1. The goal

Rework the repo to a professional standard — documentation, folder structure, coding standards,
testing, CI — **before** any further feature development. The repo was written by an intern and the
docs are rough, siloed and self-contradicting.

**Evidence correction that shaped every later decision:** the code is *not* broadly makeshift. It has
a shared type contract, a service layer with pure mutation functions, a provider/transport seam for the
LLM layer, atomic writes, and 23 test files. The real problems are localised. The three test failures
turned out to be **stale tests**, not bad code — the production changes were deliberate and documented
in commit messages.

## 2. Baseline (measured, not assumed)

| Check | Result |
| --- | --- |
| `npm ci` | PASS — 286 packages |
| `npm run typecheck` | **FAIL** — `vite.config.ts(1,10): TS2305: Module '"vite"' has no exported member 'defineConfig'` |
| `npm test` | **FAIL** — 178 electron tests: 175 pass, 3 fail. `test:renderer` never ran (short-circuited) |
| `npm run build` | **FAIL** — blocked by the same TS error |
| Renderer suite (run directly) | **PASS** — 3 files, 11/11 tests |
| Electron runtime here | Cannot launch — missing `libnss3.so` (environmental, does not affect `node --test`) |

**Constrained baselines for the strictness measurements:** renderer 0 errors, electron 0 errors
(measured with `--moduleResolution bundler --module esnext` to bypass the vite issue).

**The three failing tests are ALL stale tests** (confidence: certain, via `git blame`):

| Test | Verdict | Evidence |
| --- | --- | --- |
| `weaveModelProfiles.test.cjs` (`200 !== 20`) | stale | commit `2d65327` deliberately raised the unrestricted iteration cap 20 → 200 |
| `weavePlanSchema.test.cjs` (expected throw) | stale | commit `856d826` deliberately made boundary markers optional, and updated the prompts in the same commit |
| `weavePromptBuilder.test.cjs` (`/read-only tool call/`) | stale | commit `f788ff8` deliberately removed the duplicated budget reminder from the user turn |

**`vite.config.ts` TS2305 root cause** (verified with `--traceResolution`): `tsconfig.json` sets
`module: Node16` / `moduleResolution: node16`; `package.json` has no `"type": "module"`, so the file is
treated as CJS and resolves vite's `require` condition → `node_modules/vite/index.d.cts`, a deprecated
shim with no named exports. The real declarations are only reachable via the `import` condition.
**Regression introduced by commit `6bb9751`**, which switched off `ESNext`/`Node`.

**Spurious failure to ignore:** a bare `npx vitest run` reports "20 failed | 3 passed". The 20 are the
`node:test` `.cjs` files being collected by Vitest's default glob ("No test suite found") — not a real
failure. `npm run test:renderer` passes the explicit paths and is green.

## 3. Settled decisions

### Scope and sequencing

| # | Decision |
| --- | --- |
| Q1 | **Selective rewrite of the worst parts** — not greenfield, not purely in-place |
| Q2 | **In scope:** docs consolidation, folder/layout normalisation, enforced coding standards, closing test gaps, CI gate, module splitting (re-added by Q6). **Out of scope:** packaging/release pipeline, product changes, security review, a11y |
| Q3 | **Behaviour frozen except outright bugs** |
| Q6 | **Module splitting IS in scope** — resolved the Q1/Q2 contradiction. Targets: `App.tsx` (1360), `weaveApplyService.ts` (792), `vault-contract.ts` (501) |
| Q7 | **Green baseline first, as its own PR**, with no restructuring mixed in |
| Q8 | **Small focused PRs straight to main** |
| Q5 | **Done = one green command from a clean clone**, CI-enforced: `npm ci && typecheck && test && build && lint` |
| Q12 | **Conventional Commits + a PR template** naming the gate command that was run |

### Documentation

| # | Decision |
| --- | --- |
| Q4 | Stage 1–6 docs **demoted to `docs/archive/`**; `00-Single-Source-of-Truth.md` retires; fresh docs written |
| Q9 | `CONTEXT.md` is a **pure glossary**; architecture lives in `docs/architecture/` |
| Q25 | Coding standards live in **`docs/standards/`**, one file per concern; `AGENTS.md` + `CONTRIBUTING.md` point at them |
| Q16/Q20 | **Weaver = the agent; weave = one run of the action.** Codified in `docs/standards/` (NOT in `CONTEXT.md`, which is glossary-only) |

### Testing

| # | Decision |
| --- | --- |
| Q10 | **Unify on Vitest** for both layers; keep `build:main` in CI so the compiled-artifact check survives |
| Q14 | **Update the 3 stale tests** to match current behaviour; file the marker-only validation gap separately. The green PR changes nothing but colour |
| Q23 | **Named test gaps + coverage reporting, no threshold gate** |

### Tooling and standards

| # | Decision |
| --- | --- |
| Q13 | **Split the tsconfigs** — Vite's canonical layout: `tsconfig.app.json` (bundler, `src`) + `tsconfig.node.json` (`vite.config.ts`) + the existing electron config |
| Q21 | Strictness ladder: **free options now** (`noFallthroughCasesInSwitch`, `noUnusedParameters`, `noImplicitOverride`); `noUnusedLocals` after the `App.tsx` split; `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` after the splits; **never `verbatimModuleSyntax`** (structurally incompatible with the CJS electron build) |
| Q24 | ESLint (flat config): recommended + typescript-eslint recommended + react-hooks + react-refresh, **plus type-aware async rules** (`no-floating-promises`, `no-misused-promises`, `await-thenable`) |
| Q18 | **One dedicated Prettier formatting commit** + `.git-blame-ignore-revs` so history stays readable |
| Q26 | **Pin Node 22 LTS** via `.nvmrc` + `engines`; CI matches. Electron 35 bundles Node 22.x |

### CI

| # | Decision |
| --- | --- |
| Q11 | **`ubuntu-latest` runs the full gate** (lint → typecheck → test → build); **`windows-latest` runs typecheck + tests**, because that's where the path/casing logic differs |
| Q19 | **Authenticate `gh`; tickets become GitHub issues.** ⚠️ **NOT YET DONE — `gh` is still unauthenticated** |

### Layout

| # | Decision |
| --- | --- |
| Q15 | Delete `mock-vault_sample/` + `template-mock-gallery/`; move `mock-vault/` → `fixtures/`; move the two root `.md` files into `docs/`; drop the empty `.vscode/settings.json`. **Update `docs/Stage 6 Setup.md` and the `00-SSOT.md` Documentation Contract in the same change**, or the moves create fresh drift |

### Code specifics

| # | Decision |
| --- | --- |
| Q22 | **Delete the dead imports in `weaveApplyService.ts`, keep the hand-rolled logic.** Consolidation becomes its own ticket requiring characterization tests first. **Validated: the swap would be destructive** — see §4 |
| Q28 | **Keep note-level `ReviewMetadata`** — the user judges it a real future concept (see §5 for the counter-evidence) |

## 4. Critical finding: the dead imports are a landmine

`weaveApplyService.ts` imports `upsertCardReference`, `removeCardBoundariesAcrossReferences`,
`renameCardBoundariesAcrossReferences`, `readReferenceNoteContent`, `resolveReferenceNotePath` — and
uses **none** of them (each appears exactly once, on its import line). Meanwhile `applyDeleteNote`
(470–523) and `applyRenameNote` (392–447) hand-roll that work.

**They are not interchangeable.** Wiring `removeCardBoundariesAcrossReferences` into `applyDeleteNote`
would **strip that card's boundary blocks from every other note** while losing all `referenced_in`
pruning. The two paths run in opposite directions:

- Hand-rolled: note → cards (parse the note for uids, prune card JSON, `rm` the file). Never rewrites
  note content, never calls `syncNoteToCardStore`.
- Service: cards → notes (walk `referenced_in`, strip boundary lines, normalise CRLF, sync line ranges).

And `renameCardBoundariesAcrossReferences` is **not the same operation** as `applyRenameNote` — one
renames card uids inside boundary markers, the other renames a file. Not a drop-in at any price.

**Consequence:** deleting the imports is not cosmetic. It removes a trap that looks like the obvious
de-duplication.

## 5. Domain model notes

**Confirmed by grep:** note-level `ReviewMetadata` is **never read in the renderer**. The real review
domain is card-level `metadata.familiarity` / `metadata.next_review`, displayed and edited in
`CardMetadataPanel`, `useCrashpadCardEditor` and `lib/cards.ts`. Stage 7 is *card-level* scheduling —
the opposite direction from the note-level field.

The user chose to keep note-level `ReviewMetadata` as a possible future concept (Q28). **Revisit at
Stage 7**, and note the cost: two distinct concepts currently share the word "review".

**Naming rule (Q16/Q20):** `Weaver` = the agent as a thing (identity, configuration, sessions,
retrieval, and the UI representing it). `weave` = one run of the action and its artifacts
(`WeavePlan`, `WeavePlanOperation`, `weaveGraph`, `weavePlanSchema`, `weaveApplyService`, the trace).
Under this rule most existing names are already correct.

**Three genuine violations to fix:**

1. IPC namespace — `weave:get-settings`, `weave:list-sessions`, `weave:set-api-key` use the *action*
   namespace for *agent* concerns; those should be `weaver:*`.
2. `weaveSessions` in `src/state/WeaverContext.tsx:90` — typed `WeaverSessionSummary[]`, named with the
   action prefix.
3. Provider types (`WeaveProviderName`) — provider infrastructure belongs to the agent.

**Related structural gap:** all **41 IPC channel names are uncentralised string literals** — 39
`ipcMain.handle` in `main.ts`, 39 `ipcRenderer.invoke` in `preload.ts`, plus 2 event channels, each
typed twice by hand. The renderer's `window.crashWeaver` type is hand-written in `src/vite-env.d.ts:31`
rather than derived from preload. Fixing both removes a silent-failure class (rename one side, the call
never resolves, no type error).

## 6. Structural findings for the splits

**`src/App.tsx` (1360 lines)** — the child interfaces are already clean and named (`*Props` per
component); the problem is threading volume. `InspectorPane` takes **39 props**, `CrashpadWorkspace` 30.
Consumes 22 custom hooks and calls `window.crashWeaver` 16 times. Candidate seams:

- **A.** weaver controller → `src/hooks/useWeaverController.ts` (~320 lines: 159–162 + 653–953) — biggest win
- **B.** editor surface → `src/components/EditorSurface.tsx` (JSX 1016–1262, plus 323–336, 190–206)
- **C.** shell chrome → `src/components/AppChrome.tsx` (955–1014 + `layoutStyle` 626–633)
- **D.** card projection → `src/hooks/useCardProjection.ts` (242–302, 61 lines, pure, unit-testable)

**`electron/weaver/weaveApplyService.ts` (792 lines)** — one export (`applyWeaveOperations` 645–792),
10 handlers that are already stateless and extractable, no module-level mutable state. Candidate seams:
guards 42–131 → `weaveApplyGuards.ts`; handlers 135–641 split into note-content (135–390) and
path-mutation (392–641); dispatch switch 662–728 → a `Record<Kind, Handler>` map (removes ten
`as XPayload` casts); positional args → an `ApplyContext` object.

**`electron/vault-contract.ts` (501 lines)** — 78 exports: 58 shared, 16 main-only, 4 renderer-only,
and **16 imported by neither side** (dead: `CardParseDiagnosticCode`, `WeaveProviderName`, the ten
`*Operation` aliases, `GuidedInsert`/`IntelligentWeavePlanRequest`, `GuidedInsert`/`IntelligentWeavePlan`).

**Strictness measurement (deltas from a clean baseline):**

| Option | Renderer | Electron |
| --- | --- | --- |
| `noFallthroughCasesInSwitch` | 0 | 0 |
| `noUnusedParameters` | 0 | 3 |
| `noImplicitOverride` | 2 | 0 |
| `noUnusedLocals` | 37 (26 in `App.tsx` alone) | 12 |
| `noUncheckedIndexedAccess` | 172 (top 2 files = 75%) | 20 |
| `exactOptionalPropertyTypes` | 34 | 47 (most spread: 13/34 files) |
| `verbatimModuleSyntax` | 292 | 392 |

## 7. OPEN — resume here

### Q27 (RESOLVED)

**Decision:** file the two genuine code defects as GitHub issues; **rewrite the dry-run test to assert
its actual behaviour**. No production behaviour changes. The test rewrite is its own small PR,
separate from the green PR.

**Defect 1 — `applyRenameNote` updates only the FIRST matching `referenced_in` entry per card**
(`findIndex`, line 436). Duplicate entries would be half-updated.

**Defect 2 — `verifyBoundaryIntegrity` is never called by delete or rename**, only by insert/edit.

**Defect 3 — the dry-run gap: VERIFIED, and dormant.**

Verified across all ten handlers: each calls `assertWithinVault`, then returns `{ok: true}`
immediately — lines 144, 278, 327, 402, 479, 534, 553, 611, with `move-note` (457) and
`move-directory` (598) delegating to those. Dry-run therefore skips:

- `assertNoteExists` (148, 282, 483)
- target-text presence (288–296) and `verifyBoundaryIntegrity` (300, 309)
- `fs.stat` existence (615–622)
- **the vault-root guard (624–627)** — dry-run reports `ok` for an operation the real run refuses
- the non-empty-directory warning (629–636)

**Two corrections to what was recorded while paused:**

1. **`dryRun: true` is never called in production.** The only production call site is `main.ts:394`
   with `dryRun: false`; the only `true` is in the test. The diff preview is computed in the renderer
   from the plan and does **not** consume dry-run. **Live impact today: zero.** The earlier note that
   this undermined the Stage 6 safety story was wrong.
2. **The existing test is near-vacuous.** `tests/electron/weaveApplyService.test.cjs:536` asserts
   "does not modify any files" and `allOk === true` — both guaranteed by the early return. It cannot
   detect that validation was skipped. That is false confidence, and it is the reason for the rewrite.

**Real exposure is latent:** `WeaveApplyOptions.dryRun` is public API (`vault-contract.ts:499`) and
IPC-reachable, so anyone wiring a "validate before apply" feature gets a silent all-clear.

### Q29 (RESOLVED): workspace moved

Canonical copy is now **`/root/CrashWeaver`**. The old copy at `/root/workspace01/CrashWeaver` was
deleted after a guarded verification: matching HEAD (`f7f01a4`), 419 tracked files each,
byte-identical working trees, `git fsck` clean, `node_modules` intact.

### Q30–Q32 (RESOLVED): glossary vocabulary

- **Q30** — **Crash Card** is canonical; "card" is an accepted short form in prose.
- **Q31** — **Reference** is the domain concept; `referenced_in` is only the field that stores
  references. The glossary holds the concept, not the field name.
- **Q32** — **A weave is one run of the Weaver, ending in one plan.** The plan is its artifact; the
  session log is its record. This makes the naming rule mechanical: *Weaver = the agent; a weave = one
  run.*

**Confirmed `CONTEXT.md` content** (glossary only — no implementation detail):

| Term | Definition |
| --- | --- |
| **Crash Card** | The core unit. Holds a piece of knowledge to remember, its categorisation, its mnemonic aids, and its review state. Short form in prose: "card". |
| **Note** | A markdown file in the vault. Holds prose and, where cards are placed, the boundaries marking which text belongs to which card — never a card's full payload. |
| **Vault** | The folder the user opens as their knowledge base. The app reads and writes inside it and never outside. |
| **Card store** | The folder holding the full payload of every card, one file per card. |
| **UID** | A card's unique identifier — the only thing linking a note's boundaries to a card's payload. |
| **UID boundary** | The paired start/end markers delimiting the span of a note attributed to one card. |
| **Reference** | A link from a card to a specific line span in a specific note where that card appears. A card holds many. |
| **Orphaned card** | A card whose references have all gone. |
| **Crashpad** | The authoring surface where cards are composed and arranged before being woven into notes. |
| **Weaver** | The LLM agent that acts on the user's behalf: reads the vault, reasons, proposes changes. |
| **weave** | One run of the Weaver, ending in one plan. |
| **Weave plan** | The ordered set of proposed operations a weave produces, reviewed by the user before anything is written. |
| **Weave operation** | One proposed change within a plan. |
| **Approval gate** | The point where the user accepts or rejects a plan. Nothing is written before it. |
| **Guided insert** | A weave kind that adds one specific card to a note. |
| **Intelligent weave** | A weave kind that restructures notes and folders. |
| **Weave strength** | How much autonomy a weave is granted (light / standard / go ham). Changes autonomy only, never model routing. |
| **Memory tricks** | A card's mnemonic aids: one technique phrase plus question/answer pairs. |
| **Familiarity** | How well the user knows a card, as scheduling state. |
| **Next review** | The date a card becomes due for review. Exists before the review loop does. |
| **Diagnostic** | A parser report of a malformed boundary. |

Note: the **Weaver/weave naming rule itself is a coding standard**, so it belongs in
`docs/standards/` (Q25), not in the glossary. The glossary only defines the two terms.

### Still open

- **`gh` is now authenticated** as `HellfireSam` — the Q19 blocker is cleared.
- **Everything previously tracked is now filed.** The two defects are #16 and #17 (both also labelled
  `bug`); the boundary-marker gap is #4; the destructive-consolidation reconciliation is #22.

### Next steps

The grilling frontier is otherwise **empty**. In order:

1. ~~Shared-understanding sign-off~~ — **DONE**.
2. ~~`/to-spec`~~ — **DONE**: published as
   [issue #1](https://github.com/HellfireSam/CrashWeaver/issues/1), labelled `ready-for-agent`. The spec
   additionally commits to centralising the 41 IPC channel names and deriving the renderer bridge type
   from preload, which §5 above had left as an undecided "related structural gap". It also commits to
   the gate command as the single acceptance seam plus characterization tests at boundaries that
   already exist — **the module splits add no new test seam**.
3. ~~`/to-tickets`~~ — **DONE**: 21 tickets, #2–#22, all sub-issues of #1 with native `blocked_by`
   edges. The frontier (nothing blocking it) is **#2** (the green baseline), **#3** (documentation
   reorganisation + glossary), and **#4** (the boundary-marker gap). Ticket map, in dependency order:

   | Phase | Tickets |
   | --- | --- |
   | Green baseline | #2 |
   | Enforceable | #5 lint+format → #8 gate/CI/governance |
   | Documentation | #3 reorg+glossary · #6 architecture · #7 layout · #9 standards |
   | Testing | #10 Vitest batch 1 → #11 batch 2 → #12 characterization |
   | Splits | #14 apply service · #13 pure logic → #15 renderer split · #18 dead exports |
   | Naming / IPC | #19 naming · #20 centralise → #21 rename+assert |
   | Tracked | #16, #17 defects · #4 marker gap · #22 reconciliation |

4. `/implement` per ticket, clearing context between tickets.
   - ~~#2 the green baseline~~ — **DONE** in `f90ed8e`: tsconfigs split (app / node / electron solution),
     root cause of the TS2305 regression recorded and proven loud, three stale tests updated. Closed.
     Gate verified on the frozen revision: typecheck 0, build 0, 178/178 electron + 11/11 renderer.
   - ~~#3 the documentation rewrite + glossary~~ — **DONE** across seven commits on `main`
     (`fe11d0a` archive · `baea6b1` glossary · `5f781e6` documentation set · `403988f` open questions ·
     `bac2b52` user-guide corrections · `8bdaa40` setup/roadmap corrections · `5116745` record, plus
     record-maintenance commits). Scope was expanded by a second grilling round: rather than
     reindexing the old docs, **every document was rewritten from scratch**, because the archived set
     conflicts with itself and does not reliably state what was intended. #6 (fresh architecture) was
     absorbed and
     closed as a duplicate; #9 (standards) stays separate because it depends on #5/#8 tooling.
     - 21 superseded documents moved to `docs/archive/` behind a uniform banner, plus an archive
       index mapping each to its replacement. Nothing deleted.
     - `CONTEXT.md` published at the root: the 21 confirmed terms, verbatim from #1, glossary only.
     - 13 fresh documents written from the code (~2,700 lines): root README, docs index, four
       architecture documents, three reference documents, two guides, and `docs/roadmap.md`.
     - Verification: each fresh document was falsified against the code by an independent adversarial
       verifier. 61 findings were raised, including six majors (a false "each surface has one owner"
       claim, a false claim that every marker writer emits the canonical form, two card-schema
       errors, a false claim that the diff preview mirrors apply's placement rules, and the user
       guide's restatement of the vault rule). All were fixed; nothing was invented.
     - Intent gaps: `.scratch/professional-standard/docs-open-questions.md` — three decisions for the
       owner (card store versus the vault rule, request logs and the embedding cache versus the
       approval gate, roadmap framing) plus recommendations. Per the agreed protocol, unresolved
       entries are documented as open rather than guessed, and they do not block closing the ticket.
     - Gate on the committed revision: typecheck 0, build 0, 178/178 electron + 11/11 renderer.
       Documentation-only change.
   - ~~#5 lint + format~~ — **DONE**: `0a9111a` (ESLint 10 flat config, Prettier, and the
     violations cleared) · `573b302` (one formatting-only commit, listed in
     `.git-blame-ignore-revs`) · `7521af2` (docs + blame-ignore entry). ESLint exits 0 with 28
     recorded warnings. Typed async rules resolve against the right tsconfig per file group; a
     deliberate floating promise fails lint in both `src/` and `electron/`.
   - ~~#7 layout~~ — **DONE** in `8121683`: fixtures under `fixtures/` (`mock-vault/` retained as the
     live vault, `mock-vault_sample/` retained per the owner decision B6), template gallery deleted,
     empty `.vscode/settings.json` deleted, root `README.md` folded into `docs/README.md` (owner
     decision in this session: `AGENTS.md` and `CONTEXT.md` stay at the root). Every reference
     updated in the same commit.
   - ~~#8 gate + CI + governance~~ — **DONE** in `b6dbcb5`: `npm run gate` (npm ci → format check →
     lint → typecheck → tests → build) and `npm run checks` (same, no reinstall); GitHub Actions with
     the full gate on Linux and typecheck+tests on Windows; Node 22 pinned via `.nvmrc` + `engines`;
     PR template asking for the gate command and result; Conventional Commits recorded in
     `CONTRIBUTING.md` with an `AGENTS.md` pointer. Gate verified green end to end (39s).
   - ~~#10 Vitest batch 1~~ — **DONE** in `3c001d5`: `vitest.config.ts` is the one config and
     `include`s only the suites it can execute, so the twenty phantom "No test suite found"
     failures are gone (a bare `npx vitest run` is 9 files / 34 tests green). Coverage is reported
     by the v8 provider with no threshold (gate total 11.86% at the time of writing); the six
     vault/card suites were ported to TypeScript `.test.ts` files that still import the compiled
     `dist-electron/` output through `createRequire`; the known gaps are named by module in
     `tests/README.md`. `tsconfig.tests.json` joined the typecheck solution and the typed ESLint
     programs. Scripts: `test:node` (remaining `node:test`) + `test:vitest`, chained by
     `npm test`. Gate verified green.
   - ~~#9 coding standards~~ — **DONE** in `c630d79`: five standards in `docs/standards/` (naming,
     module structure, testing, formatting and linting, commits and pull requests) plus an index;
     the Weaver/weave rule is recorded as a naming standard, with the known violations listed
     against #19/#20/#21. `AGENTS.md` and `CONTRIBUTING.md` are reduced to setup plus pointers; the
     development guide, docs index, PR template and `tests/README.md` point at the standards
     instead of restating them. Gate verified green.
   - ~~#11 Vitest batch 2~~ — **DONE** in `590e25e`: all twenty main-process suites are `.test.ts`
     files under Vitest, so `npm test` is one command (`npm run build:main && vitest run --coverage`)
     with one configuration and one report. The fourteen remaining `node:test` suites moved over
     test-for-test and assertion-for-assertion — 155 tests and 393 assertions, still loading the
     compiled `dist-electron/` output through `createRequire`, so the compiled-artifact check
     survives. `test:node`/`test:vitest`, the ESLint `.cjs` exception and the migration notes in
     `vitest.config.ts`/`tsconfig.tests.json` are deleted; the testing standard, development guide,
     architecture documents and `tests/README.md` describe the single runner. The ported suites also
     took the port as the moment to obey the standards: `weavePromptBuilder.test.cjs` became
     `weavePlanPrompts.test.ts` (the module it actually tests) and the apply suite now uses
     `fs.mkdtemp`. Gate green from a clean install: 23 files / 189 tests, 0 lint errors with the
     unchanged 28 warnings, coverage 35.19% statements / 35.94% lines.
   - ~~#12 characterization~~ — **DONE** in `992db39`: the weave apply service is pinned at its
     single public entry point by 83 tests, up from 21, with one `describe` per operation kind plus
     reporting and dry run. Every kind is exercised end to end — insert (all five placements, the
     empty-block fallback, each missing-anchor warning, the boundary-integrity failure), edit
     (global replacement, CRLF normalisation, absent target text, broken pair), create (default card
     document, occupied path, preserved card), rename (reference rewrite, missing source, occupied
     destination, missing card document), move, delete (reference pruning, orphan warning, missing
     note) and the four directory handlers — against files on disk, card JSON and the returned
     `WeaveApplyResult`. The near-vacuous dry-run test is replaced by tests that can fail: ten
     no-write cases compare full vault snapshots, eleven paired cases make a dry run report success for
     an operation the real run provably refuses, two pairs pin the skipped vault-root guard and
     non-empty-directory warning, and ten more prove the containment guard still runs first for every
     handler. Mutation-checked against the compiled output: forcing the eight `if (dryRun)` early
     returns off made 23 assertions fail, so the dry-run tests observe the early return rather than
     restate it. `tests/README.md` drops the dry-run gap and the apply section of
     `docs/architecture/weave-pipeline.md` records what the suite pins. Production behaviour is
     untouched; dry run still validates containment only and that product gap stays on the roadmap.
     Gate green from a clean install: 23 files / 251 tests, 0 lint errors with the unchanged 28
     warnings, coverage 36.1% statements / 36.84% lines (from 35.19 / 35.94).
   - ~~#13 extract and unit-test the pure renderer logic~~ — **DONE** in `ad5852d`: the pure logic
     of the largest renderer module now lives in two tested `src/lib/` modules, so the #15 split
     has a seam that is already pinned. `src/lib/cardProjection.ts` projects the active surface's
     visible cards and the crashpad's cards from the raw renderer state — 19 tests covering the
     note, vault, card-file and crashpad surfaces, the surface and scope selection rules,
     linked-card payloads, Reference preference and fallback, a missing card store, crashpad
     entries whose card has left the catalog, crashpad cards projected while another surface is
     active, plus `selectFocusedCard` and `selectDefaultWeaveCardUid`. `src/lib/layout.ts` gains
     `computeLayoutStyle`, the shell grid's custom properties, with the splitter and widget-rail
     widths taken from the `LAYOUT` constants — 4 tests. `App.tsx` consumes both: seven local memo
     blocks, the default-card helper and the inline style object are gone, and a focus change no
     longer re-projects or re-sorts a card list. The old draft-path fallback in the note projection
     was unreachable — the card record's `filePath` is required and parsed cards only exist with an
     open note document — and is dropped, so no rendered output changes. No new test seam: the
     suites test the extracted modules' own exported behaviour, and `App.tsx` still has no tests.
     Both modules are at 100% statements, branches, functions and lines; `tests/README.md` drops
     the covered gap, and the card-schema reference and process-model architecture document
     describe the new modules. Gate green from a clean install on Linux: 25 files / 274 tests,
     0 lint errors with the unchanged 28 warnings, coverage 36.86% statements / 37.57% lines
     (from 36.1 / 36.84).
   - ~~#14 split the weave apply service~~ — **DONE** in `36971a6`: the 843-line module is now five
     modules behind one export. `weaveApplyGuards.ts` holds the containment, note-existence and
     boundary-integrity guards; `weaveApplyNoteHandlers.ts` holds insert, edit and create;
     `weaveApplyPathHandlers.ts` holds the seven path-mutation handlers and the comment recording that
     the note-to-card and card-to-note mutation directions are not interchangeable;
     `weaveApplyHandlerContract.ts` holds the explicit context, the handler result and the warning
     format; `weaveApplyService.ts` holds `applyWeaveOperations`, the kind-to-handler map and the
     reporting loop. Handlers take `(context, operation)` rather than five positional arguments, and
     the map's `satisfies` clause proves kind by kind that each handler accepts its own operation, so
     the ten payload casts are gone. The 83 characterization tests pass unmodified. Review caught a
     real regression in the first cut: a plain object index for the dispatch map resolved inherited
     property names, so kind `constructor` ran the `Object` constructor instead of reporting "Unknown
     operation kind" as the old `switch` did; the lookup now checks `Object.hasOwn`, two regression
     tests pin `constructor` and `hasOwnProperty` (mutation-checked: removing the guard fails both),
     and that is the only test change — the characterization suite's existing assertions are
     untouched. Review also corrected two inaccurate statements in the new docs, unified the edit
     handler's duplicated retry tail and the shared write-and-sync, and renamed three confusable
     dispatch types. No new test seam. Gate green from a clean install on Linux: 25 files / 276
     tests, 0 lint errors with the unchanged 28 warnings, coverage 37.09% statements / 37.8% lines
     (from 36.86 / 37.57).
   - ~~#16 note rename half-updated duplicate references~~ — **DONE** in `102081c`:
     `renameNoteAtPath` used `findIndex` and rewrote only the first `referenced_in` entry carrying the
     old note path, so a card holding stored duplicates was left half-migrated. It now rewrites every
     matching entry with `map`, preserving list order, leaving other notes' entries alone and skipping
     the write when nothing matched. The regression test writes a card with two entries for the
     renamed note plus an unrelated entry and fails against the first-match update. The roadmap's
     known-gap line is removed. Gate green: 25 files / 277 tests.
   - ~~#17 boundary integrity on note delete and rename~~ — **DONE** in `0283e66`: delete and rename
     now call `verifyBoundaryIntegrity` on the note they read, before any mutation — rename before it
     checks or creates the destination, delete before it prunes a reference or removes the file.
     `move-note` inherits the check through the shared rename path; that is a deliberate, benign
     extension of the ticket (moving a malformed note now fails the same way renaming it does). The
     tests add an unterminated pair for both operations and assert the diagnostic code, the surviving
     note and untouched card references; the two `it` titles were made distinct in `2ecce4b`. The
     roadmap and `tests/README.md` gap lines are removed and the boundary/reference/architecture
     documents corrected. Gate green: 25 files / 279 tests.
   - ~~#22 reconcile the note-to-card and card-to-note reference mutations~~ — **DONE** in `980d61d`,
     corrected in `d75f763`: the decision is **keep them separate**. ADR-0001 records both directions
     and why the swap is destructive, the data model documents them side by side, and the warning
     comment above the path-mutation handlers now points at the ADR as the single home for the
     rationale. Review caught two precision errors in the first cut: the card-to-note services do not
     leave `referenced_in` untouched (the note re-sync they trigger rewrites it), and restore is a
     third card-to-note service (`reinsertCardBoundariesForReferences`); both were corrected, along
     with the data-model claim that every note write runs the integrity guard (`create-note` does not).
   - ~~#15 split the largest renderer module~~ — **DONE** in `d107335`: `App.tsx` went from 1431 to
     709 lines. `useWeaverController` owns the Weaver (composer and its effects, provider health,
     generation, apply with the destructive-operation gate, sessions, settings writes);
     `EditorSurface` owns the editor pane; `AppChrome` owns the window strip, widget rail and layout
     grid; `App.tsx` is the composition root, keeping the shared hooks, the external-change
     subscription and the projections both surfaces need. The controller spreads `inspectorProps` and
     `settingsProps` typed as `Pick` of the panes' own prop types, so no component's prop interface
     changed. No test seam was added — the ticket forbids one — so the split is proven by typecheck,
     tests and build plus a static comparison of the old component's UI strings, class names and
     bridge calls; that comparison caught the external-change subscription being dropped in the first
     cut, restored before commit. Lint warnings fell from 28 to 12 because the moved callbacks now
     list their stable setters. Gate green: 25 files / 279 tests, coverage 37.04% statements / 37.75%
     lines (from 37.09 / 37.8; the fall is the new untested UI modules).
   - ~~#18 remove the unused contract exports~~ — **DONE** in `01d43dd`, corrected in `8ed725f`: the
     filed "sixteen unimported exports" premise had drifted after #14/#15. Re-deriving the list
     across every `.ts`/`.tsx`/`.d.ts` outside the contract showed the ten operation aliases are now
     imported by the split apply handlers, leaving six exports referenced only inside the contract
     itself (`CardParseDiagnosticCode`, `WeaveProviderName` and the two request/plan pairs). They
     cannot be deleted while exported shapes use them, so their `export` keyword is dropped and they
     stay module-private; the sweep is recorded in the commit and the process-model contract section.
     Review then found `WeaverModelProvider` was dead in a second way — imported by `weaveService`
     only to be re-exported — so the correction deletes it and the barrel re-export, making the
     "no other export is unused" claim true.
   - ~~#19 name the agent's session and provider symbols~~ — **DONE** in `2f3e236`, corrected in
     `daaa462`: `weaveSessions`/`setWeaveSessions` become `weaverSessions`/`setWeaverSessions`, and
     the provider layer (`WeaveProviderName`, `WeaveProviderHealth`, `OpenRouterWeaveProvider`,
     `StubWeaveProvider`, the internal provider interface and the `stubWeaveProvider.ts` module and
     suite) takes the agent prefix. The naming standard reads on the corrected names and its two
     fixed rows leave the known-violations table. Review caught two renames that were out of the
     ticket's scope — the preload member and a refresh callback caught by substring — and they were
     reverted; the provider, model and session identifiers that still use the action prefix were
     filed as **#26** and re-added to the standard's tracked table rather than silently left
     untracked.
   - ~~#20 centralise the IPC channel contract~~ — **DONE** in `1429390`, corrected in `7c39167` and
     `1673db9`: `electron/ipcChannels.ts` declares all 41 channel names once as a nested `as const`
     object (39 request/response by area, plus the two push channels under `events`); `main.ts` and
     `preload.ts` read it, and no channel literal remains at a call site. `electron/preload.ts` now
     exports `CrashWeaverBridge = typeof crashWeaverBridge`, and `src/vite-env.d.ts` types
     `Window.crashWeaver` from it, so the hand-written copy is gone. Mutation-checked: renaming a
     preload member makes `tsc -b` fail at the renderer call sites, which the duplicated copies could
     not catch. Review replaced the `channel()` helper with plain literals (`as const` already gives
     the literal types), and the docs now state the boundary precisely: a renamed or re-signatured
     bridge member is a compile error, while a missing handler or a wrong *declared* key at a call
     site compiles and hangs — that runtime assertion is **#21**. The renderer boundary rule in
     module-structure now permits the type-only `preload.ts` import it needs.
   - ~~#26 the residual provider, model and session identifiers~~ — **DONE** in `029d33d`, corrected
     in `846744a`: the renderer state and setters, the `refreshWeaverProviderHealth` callback, the
     service functions, the provider test seams, the preload members and `WeaverModelInfo` take the
     agent prefix; `weaveModelProfiles.ts` and its suite become `weaverModelProfiles.ts`, and because
     the ticket's own reason is that model policy is agent configuration its exported types and the
     renderer's `DEFAULT_WEAVER_MODEL` follow. No IPC string or state shape changed. Review caught
     `setWeaveApiKey`/`clearWeaveApiKey` still on the action prefix while the standard calls an API
     key an agent concern; `846744a` renames them. The known-violations table is empty and removed.
   - ~~#21 rename the agent-concern channels and assert handler coverage~~ — **DONE** in `5d8f105`,
     corrected in `b16e381` and `84ef564`: `IPC_CHANNELS.weaver` holds the fourteen agent-concern
     channels and `weave` keeps only plan generation and apply; no call site restates a channel. The
     two push channels keep their areas (a run event, a vault event), and `tests/electron/ipcChannels.test.ts`
     is the runtime assertion: it loads the compiled `main.js` and `preload.js` with a stubbed
     `electron`, calls every exposed bridge member, and asserts each invoked channel has a handler,
     each handler is exposed, each declared request/response channel is realised by both sides, and
     the preload subscribes to every declared event channel. A negative-control test pins the failing
     direction, and the suite was mutation-checked by deleting a handler from the build output.
     Review corrected two docs that overclaimed what the suite can see, trimmed the electron stub and
     a member-name heuristic, and updated the testing standard for the stub.
   - ~~#23 the card chip truncates card titles~~ — **DONE** in `9e126b8`, corrected in `17a996a` and
     `e1e3e51`: the chip is `src/components/WeaverCardChip.tsx`, all three `slice(-8)` calls are gone,
     the chip wraps the complete title for three lines and clamps after that with the full UID in the
     `title` tooltip, the session row stays a single ellipsized line and the detail header wraps.
     `src/components/WeaverCardChip.test.tsx` is the repository's first component suite (per-file
     jsdom). The manual narrow/wide clamp check could not run — this environment has no desktop
     session — and `tests/README.md` records it as outstanding. Review made the tests one behaviour
     each, removed an unreachable chip modifier, and updated the testing/naming/module-structure
     standards for the component-suite form.
   - ~~#25 card UIDs are not validated on read or in weaver apply~~ — **DONE** in `fac9dfe`:
     `getCardFilePath` calls `assertValidCardUid`, so the single UID-to-path hop fails closed and every
     read, exists, write and delete inherits it; `weavePlanSchema.normalizeCardUid` rejects a traversal
     UID at normalisation; `applyCreateNote` and `applyInsertBoundaryPair` validate the payload UID
     before building boundaries, writing a note or touching the store. New `cardStoreService.test.ts`
     covers the rejection matrix and the untouched sibling file, the apply suite asserts the vault
     snapshot is unchanged after a traversal plan, and `restoreDeletedCard`/`renameCard` — which
     already validated — gained regression tests for a hand-edited crashpad snapshot.
   - **Frontier is now #4** (the weave plan schema accepts boundary-marker-omitted operations; a
     tracked gap that needs a characterisation test and a decision) and **#24** (card titles may
     contain spaces, now unblocked feature work). **#1** stays open until both close.

Each ticket landed so far went through the two-axis `/code-review` before being recorded, and its
findings were corrected first. For #10 and #9 that meant bringing the commit subjects and types
under the commit standard, making the "bare `npx vitest run` is green" claim accurate (the ported
suites need `npm run build:main` first on a clean clone), reducing duplicated rule homes in the
guides to pointers, and matching the error-message and path-wording rules to production code. For
#11 it caught a suite named for a module that does not exist (`weavePromptBuilder` tests
`weavePlanPrompts`), an apply-suite helper that did not use `fs.mkdtemp`, and duplicated test-local
shapes; all were fixed before the commit, so no assertion was weakened and no test was lost. For #12
it caught the returned-failure `stopOnError` skip path being unpinned (the unknown-kind case now has
a second operation after it), the hand-rolled contract mirrors (replaced by a type-only import of
`electron/vault-contract.ts`, which compiles to an empty module so the runtime still loads
`dist-electron/`), repeated case and pairing shapes (one shared case type and one dry-run/real-run
helper), a retired create-note assertion (restored) and a dry-run validation case missing the
insert handler's boundary check (added); the spec axis also caught an inaccurate sentence in
`docs/architecture/weave-pipeline.md`, corrected before the commit. For #13 it caught an over-long
commit subject, two exports nothing imports (`CardProjection`, `LayoutStyleInput`), the catalog
fields threading positionally through the projection helpers (now one `CardCatalogSource`), a
card-file projection that sorted the whole catalog to keep one card (it filters first), a hardcoded
widget-rail width beside the `LAYOUT` constants, a stale "no React" sentence in the one architecture
paragraph the change rewrote, and tests that bundled several behaviours under one name (split); the
spec axis then caught the focused-card state sitting inside the projection memo, so a focus click
re-projected and re-sorted both card lists — focus and the default Weave card are now selectors over
the projection, restoring the old memo granularity. A second spec pass then found the projection
suite exercised only fallback cards and that `tests/README.md` over-claimed `cards.ts` coverage;
linked-card payloads, a missing card store and the Reference fallback are now asserted, and the
README narrows its claim. The spec axis verified all four acceptance criteria and agreed the
draft-path fallback is unreachable. For #14 the standards axis caught two false statements in the
rewritten docs (the note handlers were said to own the boundary-integrity check, and the module map
did not cover the handler-contract module), the duplicated edit-retry and write-and-sync tails, and
three confusable dispatch-type names; the spec axis caught a prototype-chain regression in the new
dispatch map (an inherited property name such as `constructor` ran as a handler), a false
unknown-kind claim in the architecture doc, and an over-broad note-handler header. All were
corrected before the commit. For the four-ticket batch the standards axis caught an 80-character
#15 subject, commit-body claims that no longer matched the final code (`674 lines`, both prop groups
typed `Pick`, four contexts read), a `tests/README.md` gap that named only the closed #15, the
controller's type-only dependency on the panes' prop interfaces, and the duplicated editor-kind
flags; the spec axis caught the two ADR/data-model precision errors listed under #22, the missing
restore service, the `create-note` integrity exception and a stale controller-options sentence. One
spec finding — that `verifyBoundaryIntegrity` now also runs for `move-note` — was reviewed and kept
as a deliberate consequence of the shared rename path. Two standards findings were considered and
recorded rather than actioned: "one hook per concern", because #15 itself asks for a single Weaver
controller hook and the controller is the one Weaver concern, and "characterise before refactoring",
because the renderer layer has no existing seam to characterise at and #15 forbids adding one, so
the split is proven by the static equivalence check, typecheck, tests and build, with the gap named
in `tests/README.md`. Corrections landed in `d107335` (the amended #15 commit), `d75f763` and
`2ecce4b`. For the #18/#19/#20 batch the standards axis caught a false self-contradiction in the
renderer boundary rule (the bridge-type import it had just introduced), the dead
`WeaverModelProvider` export, two commit subjects over the 72-character limit, stale export/dead-code
claims in the docs, a known-violations table that had been emptied while violations remained, and
the `channel()` helper as a middle man; the spec axis caught that a wrong *declared* key or a missing
handler is still not a compile error (now stated precisely rather than over-claimed), and two
identifier renames outside #19's scope. Corrections landed in `8ed725f`, `daaa462`, `7c39167` and
`1673db9`, and the two long subjects were reworded. For the #21/#26 batch the standards axis caught
documentation that overclaimed what the new runtime assertion can see (the area rule is a review
convention), the service-layer API-key functions still on the action prefix, and a stale
`ipcChannels.ts` header; the spec axis confirmed the table renames and the no-literal rule, and
pressed on the "two event channels" line, which is answered in #21's close comment. Corrections
landed in `846744a`, `b16e381` and `84ef564` (#26/#21), and in `17a996a` and `e1e3e51` for the #23
review, which caught the new suite kind leaving the testing standards stale and the manual-check
claim with no owner.

**Branch state:** the #15/#16/#17/#22 batch is on `origin/main` at `d803258` with CI green, and the
#18/#19/#20 batch (`01d43dd`, `2f3e236`, `1429390`) plus its review corrections (`8ed725f`,
`daaa462`, `7c39167`, `1673db9`) is on `origin/main` too. The newest commits are the #21/#26 batch
(`029d33d`, `5d8f105`) with its review corrections (`846744a`, `b16e381`, `84ef564`), the #23 fix
(`9e126b8`) with its corrections (`17a996a`, `e1e3e51`), the #25 fix (`fac9dfe`) and this record
update; they are pushed together as part of this session.

## 8. How to resume

```bash
cd /root/CrashWeaver
cat .scratch/professional-standard/grilling.md
```

In a new session, say:

> Resume the CrashWeaver rework. Read `.scratch/professional-standard/grilling.md` in
> `/root/CrashWeaver` and continue from section 7.

**Durability:** this file is committed to the local clone's git history, so it survives working-tree
changes. It does **not** survive loss of this workspace or a fresh clone elsewhere — only a `git push`
would do that. `gh` is authenticated (Q19 cleared) and the spec plus all 21 tickets live on GitHub, so
the decisions are no longer only local. The #15/#16/#17/#22 batch is on `origin/main` at `d803258`
with CI green; the #18/#19/#20 batch is on `origin/main` too, and the #21/#26/#23/#25 batch, its
review corrections and this record update are pushed together with this record.

## 9. Post-implementation owner decisions (2026-10-11)

After #3 closed, the owner answered the rewrite's open questions. The full record with what changed
for each lives in `.scratch/professional-standard/docs-open-questions.md`; the decisions in brief:

| Item | Decision |
| --- | --- |
| A1 | The card store is an explicitly configurable second storage root; the vault rule covers notes and boundaries only. `CONTEXT.md` scoped accordingly. |
| A2 | Weaver request logs and the embedding cache are Weaver-owned diagnostics, outside the approval gate; the gate covers notes, boundaries and card payloads. `CONTEXT.md` scoped accordingly. |
| A3 | The roadmap is **indicative**, not ground truth: it records the development steps, and the code wins where they disagree. Reframed. |
| B1 | Crashpad rename and delete are known gaps that the final application should support. |
| B3 | Boundary markers remain markdown comments; authors see them in edit mode; a visibility toggle is a future convenience. |
| B4 | Card types stay free-form, with an in-app list of the types used in the selected vault planned. |
| B5 | The legacy `fill_in_the_blanks` shape is **removed**; `qa_pairs` is the only shape. Implemented in `electron/cardStoreService.ts`. |
| B6 | `mock-vault_sample/` is a deliberately retained working copy for user testing, not a duplicate to delete. Ticket #7 corrected; #7's move also found it is not byte-identical to `mock-vault/` (four files and `index.json` differ), so the docs call it a slightly older copy. |
| B7 | The parser/mutator whitespace mismatch stays a documented known gap. |
| B8 | Familiarity and next review feed a planned review-scheduling function using standard spaced-repetition algorithms. |
| B2 | The `warning` severity stays error-only in practice; a non-blocking tier is tracked as a gap in the roadmap. |
| B9 | Unknown card JSON keys keep being dropped; a new field must arrive with a migration. |
| C1 | Weaver dry-run stays containment-only; the `dryRun` doc comment now states the actual behaviour, and the limitation stays on the roadmap. |
| C2 | Window geometry is fixed and not persisted; documented as current behaviour. |
| C3 | Crashpad creation by name is intended alongside rename and delete; the daily crashpad remains the only path today. |

Everything else is unchanged: the closed tickets, the frontier (**#4** and **#24**; **#1** stays
open until both close), and the pushed state of the newest commits.

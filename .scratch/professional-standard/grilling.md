# CrashWeaver — Rework Grilling Record

**Status: grilling COMPLETE; `/to-spec` and `/to-tickets` done; implementation in progress.**
Q27 and Q30–Q32 are resolved and the glossary is confirmed. The spec is [GitHub issue
#1](https://github.com/HellfireSam/CrashWeaver/issues/1) (`ready-for-agent`), broken into 21 tickets
(#2–#22) with native blocking edges. All 21 are sub-issues of #1. **Closed: #2 (green baseline), #3
(documentation rewrite), #6 (absorbed into #3), #5 (lint + format), #7 (layout), #8 (gate + CI +
governance), #10 (Vitest batch 1), #9 (coding standards) and #11 (Vitest batch 2).** The newest
tickets were closed on GitHub with their evidence comments. `main` is **five commits ahead of
`origin/main` and unpushed** — everything through #8 is on the remote.
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
   - **Frontier is now #12** (characterize the weave apply service) and **#13** (extract the pure
     renderer logic), both unblocked by #11. #14 needs #12; #15 needs #13; #20 needs #15; #19 needs
     #15; #21 needs #20. #4 (boundary-marker gap) remains unblocked but is a tracked product gap,
     not rework: leave it until the rework is done.

Each ticket landed so far went through the two-axis `/code-review` before being recorded, and its
findings were corrected first. For #10 and #9 that meant bringing the commit subjects and types
under the commit standard, making the "bare `npx vitest run` is green" claim accurate (the ported
suites need `npm run build:main` first on a clean clone), reducing duplicated rule homes in the
guides to pointers, and matching the error-message and path-wording rules to production code. For
#11 it caught a suite named for a module that does not exist (`weavePromptBuilder` tests
`weavePlanPrompts`), an apply-suite helper that did not use `fs.mkdtemp`, and duplicated test-local
shapes; all were fixed before the commit, so no assertion was weakened and no test was lost. The
commits above carry the corrections; the hashes are the final ones.

**Branch state:** the five newest commits are on `main` in this clone and **not pushed**: `3c001d5`
(#10), `c630d79` (#9), `0db1391` (the previous record), `590e25e` (#11) and the record update that
adds this sentence. Everything through #8 is on `origin/main`.

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
the decisions are no longer only local. The five newest commits (#10, #9, their record, #11 and its
record) are **not pushed**; the rework through #8 is on `origin/main`.

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

Everything else is unchanged: the closed tickets, the frontier (#4), and the unpushed state of the five
newest commits.

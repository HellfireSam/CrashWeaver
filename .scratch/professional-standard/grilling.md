# CrashWeaver — Rework Grilling Record

**Status: grilling PAUSED, incomplete.** One question unanswered (Q27), plus the glossary draft.
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

- **`gh` is unauthenticated** (Q19 chose GitHub Issues). Blocks **filing the two defects above** and
  blocks `/to-tickets`.

### Next steps

The grilling frontier is otherwise **empty**. In order:

1. Shared-understanding sign-off — the grilling skill forbids acting before this.
2. `/to-spec` — turn this record into a spec.
3. `/to-tickets` — split into tracer-bullet tickets with blocking edges.
4. `/implement` per ticket, clearing context between tickets.

**The first implementation ticket is the green PR:** split the tsconfigs (Q13) + update the 3 stale
tests (Q14). Nothing else. No restructuring.

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
would do that, and that needs GitHub credentials (Q19 is still outstanding).

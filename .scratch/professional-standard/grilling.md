# CrashWeaver — Rework Grilling Record

**Status: grilling PAUSED, incomplete.** One question unanswered (Q27), plus the glossary draft.
Resume by reading this file — it is the authoritative record of what was decided and why.

- **Repo:** `/root/workspace01/CrashWeaver` (clone of `github.com/HellfireSam/CrashWeaver`)
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

### Q27 (unanswered): the three latent defects

1. **`applyRenameNote` updates only the FIRST matching `referenced_in` entry per card**
   (`findIndex`, line 436). Duplicate entries would be half-updated.
2. **`verifyBoundaryIntegrity` is never called by delete or rename** — only by insert/edit.
3. **Possible dry-run validation hole** — the dry-run path may return `{ok: true}` *before* reading
   content (lines 144–146, 278–280), so it never validates that target text or headings exist.
   **This finding is INFERRED, NOT VERIFIED.** It matters because Stage 6's entire safety story is
   "the user reviews the diff before any write." **Verify before writing an issue.**

**Recommendation on the table:** file all three as GitHub issues and fix none during the rework —
subject to verifying #3 first, and noting that if it holds it qualifies as an outright bug under the
Q3 freeze.

### Also open

- **Glossary contents for `CONTEXT.md`** — not yet drafted. Terms available from the surveys: Card /
  Crash Card, Note, Vault, Card store, UID boundary, `referenced_in`, Crashpad, Weaver, weave, Weave
  plan / operation, memory tricks, familiarity / `next_review`. Remember: glossary only, no
  implementation detail.
- **`gh` is unauthenticated** (Q19 chose GitHub Issues). Blocks `/to-tickets`.

### After Q27 is answered

The grilling frontier is otherwise **empty**. Next steps in order:

1. Answer Q27. Draft and confirm `CONTEXT.md` (glossary only).
2. Shared-understanding sign-off — the grilling skill forbids acting before this.
3. `/to-spec` — turn this record into a spec.
4. `/to-tickets` — split into tracer-bullet tickets with blocking edges.
5. `/implement` per ticket, clearing context between tickets.

**The first implementation ticket is the green PR:** split the tsconfigs (Q13) + update the 3 stale
tests (Q14). Nothing else. No restructuring.

## 8. How to resume

In this workspace:

```bash
cd /root/workspace01/CrashWeaver
cat .scratch/professional-standard/grilling.md
```

In a new session, say:

> Resume the CrashWeaver rework. Read `.scratch/professional-standard/grilling.md` in
> `/root/workspace01/CrashWeaver` and continue from section 7 "OPEN — resume here".

**Durability:** this file is committed to the local clone's git history, so it survives working-tree
changes. It does **not** survive loss of this workspace or a fresh clone elsewhere — only a `git push`
would do that, and that needs GitHub credentials (Q19 is still outstanding).

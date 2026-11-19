# Tests

Both layers run under one runner, Vitest ([`vitest.config.ts`](../vitest.config.ts)). This file
records how to run the suites and which behaviour is deliberately **not** tested.

## Running

```bash
npm test # builds the main process, then runs every suite under Vitest with coverage
```

`npm test` builds the main process before it runs Vitest because the main-process suites import
the compiled CommonJS output in `dist-electron/` through `createRequire`, not the TypeScript
sources. That build is the compiled-artifact check: if it breaks, the suite cannot run. The command
also prints the coverage report; the HTML report is written to `coverage/` (git-ignored). The
coverage policy is in the [testing standard](../docs/standards/testing.md).

Run a single suite by hand — this needs the main-process build first too:

```bash
npm run build:main
npx vitest run tests/electron/weaveApplyService.test.ts
npx vitest run src/lib/markdownPreview.test.ts
```

Vitest's `include` lists every suite in the repository: the renderer suites beside the modules they
cover — the pure helpers in `src/lib/` and the first component suite beside
`src/components/WeaverCardChip.tsx` — and the main-process suites in `tests/electron/`. The card
grammar has its own suites: `tests/electron/cardUid.test.ts` pins the title alphabet, the 100-cap,
trimming and case-folded identity, and `tests/electron/cardParser.test.ts` pins the boundary
handling of spaced titles.

| Layer    | Files                                            |
| -------- | ------------------------------------------------ |
| renderer | `src/lib/*.test.ts`, `src/components/*.test.tsx` |
| main     | `tests/electron/*.test.ts`                       |

## Known test gaps

These are real gaps: no test exists for the named behaviour today. They are listed here so the
absence is visible rather than implied away by a green run. Each one names the ticket that owns
it where a ticket does.

- **Main-process composition — `electron/main.ts`.** The service functions below it are tested
  directly. The handler inventory is covered: `tests/electron/ipcChannels.test.ts` loads the
  compiled `main.js` with a stubbed `electron` module and asserts that every channel the preload
  invokes has a registered handler, every registered handler is exposed, and every declared
  request/response channel is realised by both sides (#21). What remains untested is the rest of the
  composition root: window creation and lifecycle, the native folder pickers, the vault watcher
  wiring and the `crashweaver-local` protocol handler.
- **Preload bridge — `electron/preload.ts`.** The channel names come from the single declaration
  in `electron/ipcChannels.ts` (#20), so the two sides cannot spell a name differently, and the
  renderer's bridge type is derived from the preload (#20), so renaming or re-signaturing a bridge
  member is a compile error. The handler-coverage suite (#21) calls every exposed bridge member
  against a stubbed `ipcRenderer` and proves each invoked channel has a main-process handler and
  that the preload subscribes to every declared event channel. Main's side of the push channels —
  the `event.sender.send` and `webContents.send` calls — is not observable in a Node test, and a
  wrong _declared_ key selection at a call site still compiles; no test can see a channel the code
  never passes.
- **Renderer UI layer.** The pure helpers in `src/lib/` and two components are covered:
  `src/components/WeaverCardChip.test.tsx` asserts the card chip's rendered title, and
  `src/components/ReviewWorkspace.test.tsx` renders the review surface and asserts its card,
  per-response intervals, click and keyboard ratings, and completion state; both run under jsdom
  (`// @vitest-environment jsdom`). The rest of `src/components/**`, `src/App.tsx`, `src/hooks/**`
  and `src/state/**` have no tests, including `src/hooks/useReviewSession.ts`, whose queue and
  preview/rating orchestration is exercised only through the review main-process suites and by
  hand. The pure logic extracted from the largest module is tested — `src/lib/cardProjection.ts`
  (the rendered card surface) and `src/lib/layout.ts` (the shell layout style) — and the review
  queue is `src/lib/reviewQueue.ts`. The remaining split landed as
  `src/components/EditorSurface.tsx` and `src/hooks/useWeaverController.ts` (#15); it added no
  test seam, so those components and hooks stay untested, and no open ticket currently owns adding
  more renderer component tests.
- **The title inputs and the case-preserving UID labels.** The add-card and editor inputs'
  `maxLength` and spaced placeholders, the renderer's case-folded attach/duplicate checks in
  `src/hooks/useCrashpadCardMutationActions.ts`, and the `detailUid` label class are not covered by
  a unit test — the hooks and components have no test harness. The main-process side of the same
  rules is covered by the vault and store suites; the DOM behaviour was checked by driving the
  built app under the headless harness recorded in `.scratch/` (see
  `.scratch/professional-standard/grilling.md` §10). No open ticket owns adding a renderer test
  seam for it.
- **The Weaver card chip's three-line clamp and ellipsis.** CSS clamping is not unit-testable
  (#23), so the chip suite only asserts the rendered text and the `title` tooltip. A headless
  Electron harness now exists (`.scratch/professional-standard/grilling.md` §10), but the manual
  narrow- and wide-panel visual check the ticket asked for is still outstanding and no open ticket
  owns it.
- **Untested pure renderer helpers.** `src/lib/crashpadHistory.ts`, `src/lib/errorUtils.ts`,
  `src/lib/explorerTree.ts` and `src/lib/stateUtils.ts` have no test files of their own.
  `src/lib/cards.ts` has a suite only for its case-folded title comparison; its mapping functions
  are exercised indirectly through the card-projection suite.
- **Weaver orchestration — `electron/weaver/weaveService.ts`.** The graph, nodes, providers,
  schema, prompts and context retrieval have suites; the service facade that sequences them and
  owns session history and request logging (`weaverSessionHistory.ts`, `weaveRequestLogger.ts`)
  does not.
- **No end-to-end test.** Nothing launches the Electron app, opens a real window, drives the UI
  or exercises the release build. The suites run under plain Node; a desktop session is needed
  only to run the app by hand.
- **No packaging or signing check.** Out of scope for the rework (GitHub issue #1), and not
  started.

One gap is product behaviour rather than missing harness work: a weave plan that omits a UID
boundary marker from `create-note` content is accepted. That is deliberate — the decision and its
reference consequence are in
[ADR-0002](../docs/adr/0002-boundary-markers-optional-in-create-note.md), and the acceptance
behaviour is pinned by the `weavePlanSchema` characterisation tests rather than left untested.

A second product limitation comes with case-insensitive card identity: a legacy card store that
already contains two files whose titles differ only in letter case is not migrated or reconciled.
`createCard` and `renameCard` refuse to add another such pair (a corrupt case-folded match fails the
duplicate check instead of being skipped), and the store's own reads still take one UID per
filename; #24 records the limitation rather than silently rewriting a user's files.

Boundary pairing has the same residual edge. `parseCrashCardsFromNote` compares the two captured
titles exactly, not folded, so a hand-authored note that spells a stored card's title in another
casing becomes its own UID on a case-sensitive filesystem (or a body/filename casing disagreement
on a case-insensitive one). That is pre-existing parser strictness, recorded in
[boundary-format.md](../docs/reference/boundary-format.md) and [data-model.md](../docs/architecture/data-model.md),
and it is not migrated with the rest of #24.

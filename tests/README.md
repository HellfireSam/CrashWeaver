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

Vitest's `include` lists every suite in the repository: the renderer suites beside the pure modules
they cover, and the main-process suites in `tests/electron/`.

| Layer    | Files                      |
| -------- | -------------------------- |
| renderer | `src/lib/*.test.ts`        |
| main     | `tests/electron/*.test.ts` |

## Known test gaps

These are real gaps: no test exists for the named behaviour today. They are listed here so the
absence is visible rather than implied away by a green run. Each one names the ticket that owns
it where a ticket does.

- **Main-process composition — `electron/main.ts`.** The service functions below it are tested
  directly. The handler inventory is covered: `tests/electron/ipcChannels.test.ts` loads the
  compiled `main.js` with a stubbed `electron` module and asserts that every channel the preload
  invokes has a registered handler, every registered handler is exposed, and every declared
  channel is realised by both sides (#21). What remains untested is the rest of the composition
  root: window creation and lifecycle, the native folder pickers, the vault watcher wiring and the
  `crashweaver-local` protocol handler.
- **Preload bridge — `electron/preload.ts`.** The channel names come from the single declaration
  in `electron/ipcChannels.ts` (#20), so the two sides cannot spell a name differently, and the
  renderer's bridge type is derived from the preload (#20), so renaming or re-signaturing a bridge
  member is a compile error. The handler-coverage suite (#21) now calls every exposed bridge member
  against a stubbed `ipcRenderer` and proves each invoked channel has a main-process handler and
  that the preload subscribes to every declared event channel. A wrong _declared_ key selection at
  a call site still compiles; no test can see a channel the code never passes.
- **Renderer UI layer.** `src/App.tsx`, `src/components/**`, `src/hooks/**` and `src/state/**`
  have no tests; only the pure helpers in `src/lib/` are covered. The pure logic extracted from
  the largest module is tested — `src/lib/cardProjection.ts` (the rendered card surface) and
  `src/lib/layout.ts` (the shell layout style). The remaining split landed as
  `src/components/EditorSurface.tsx` and `src/hooks/useWeaverController.ts` (#15); it added no
  test seam, so the components and hooks are still untested, and no open ticket currently owns
  adding renderer component tests.
- **Untested pure renderer helpers.** `src/lib/cards.ts`, `src/lib/crashpadHistory.ts`,
  `src/lib/errorUtils.ts`, `src/lib/explorerTree.ts` and `src/lib/stateUtils.ts` have no test
  files of their own; only the `cards.ts` mapping functions are exercised, indirectly through the
  card-projection suite.
- **Weaver orchestration — `electron/weaver/weaveService.ts`.** The graph, nodes, providers,
  schema, prompts and context retrieval have suites; the service facade that sequences them and
  owns session history and request logging (`weaverSessionHistory.ts`, `weaveRequestLogger.ts`)
  does not.
- **No end-to-end test.** Nothing launches the Electron app, opens a real window, drives the UI
  or exercises the release build. The suites run under plain Node; a desktop session is needed
  only to run the app by hand.
- **No packaging or signing check.** Out of scope for the rework (GitHub issue #1), and not
  started.

One gap is product behaviour rather than missing harness work and is tracked on its own ticket: a
weave plan that omits a UID boundary marker is accepted (#4).

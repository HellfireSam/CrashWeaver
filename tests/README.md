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
  directly, but the composition root is not: the 39 `ipcMain.handle` registrations, window
  creation and lifecycle, the native folder pickers, the vault watcher wiring and the
  `crashweaver-local` protocol handler have no test. Ticket #20 centralises the channel contract
  and #21 adds handler coverage.
- **Preload bridge — `electron/preload.ts`.** Nothing asserts that the exposed
  `window.crashWeaver` members match the main-process handlers, or that the channel literals on
  the two sides agree. A rename on one side is still a silent runtime hang. Tickets #20 and #21.
- **Renderer UI layer.** `src/App.tsx`, `src/components/**`, `src/hooks/**` and `src/state/**`
  have no tests; only the pure helpers in `src/lib/` are covered. The pure card projection and
  layout computation inside the largest module are extracted and tested by #13, and the module
  split is #15.
- **Untested pure renderer helpers.** `src/lib/cards.ts`, `src/lib/crashpadHistory.ts`,
  `src/lib/errorUtils.ts`, `src/lib/explorerTree.ts`, `src/lib/layout.ts` and
  `src/lib/stateUtils.ts` have no test files.
- **Weaver orchestration — `electron/weaver/weaveService.ts`.** The graph, nodes, providers,
  schema, prompts and context retrieval have suites; the service facade that sequences them and
  owns session history and request logging (`weaverSessionHistory.ts`, `weaveRequestLogger.ts`)
  does not.
- **The dry run is effectively untested.** `tests/electron/weaveApplyService.test.ts` asserts
  that a dry run writes nothing, which the early return guarantees; it cannot detect that dry
  run skips the validation the real run performs. Ticket #12 rewrites it to assert the actual
  behaviour.
- **No end-to-end test.** Nothing launches the Electron app, opens a real window, drives the UI
  or exercises the release build. The suites run under plain Node; a desktop session is needed
  only to run the app by hand.
- **No packaging or signing check.** Out of scope for the rework (GitHub issue #1), and not
  started.

Two gaps are product behaviour rather than missing harness work and are tracked on their own
tickets: a weave plan that omits a UID boundary marker is accepted (#4), and boundary-integrity
verification is not run on note delete or rename (#17).

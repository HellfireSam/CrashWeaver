# Module structure

Where code lives, which way dependencies point, and where a seam goes. The system itself is
described in [`docs/architecture/`](../architecture/overview.md); this standard is about
placement and boundaries.

## The three processes, and the direction of dependency

CrashWeaver is the standard Electron split — main process, preload bridge, renderer — and the
split is enforced, not merely conventional.

- **The renderer (`src/`) never imports main-process runtime code.** Its only dependency on
  `electron/` is `import type` from `electron/vault-contract.ts`. It has no `node:` built-ins and
  no `electron` import; every privileged act goes through `window.crashWeaver`, and nothing else in
  the renderer may reach the main process.
- **The main process (`electron/`) never imports from `src/`.** Anything both sides need belongs
  in `electron/vault-contract.ts`.
- **The preload bridge (`electron/preload.ts`) forwards and nothing else.** It imports `electron`
  and the contract, exposes one global, and holds no behaviour.
- **`electron/vault-contract.ts` is the shared type surface.** It has no imports of its own, every
  export is an `interface` or a `type`, and both sides import it with `import type` only. It adds
  no runtime dependency to the renderer bundle.

Data crosses the boundary as vault-relative POSIX paths and plain JSON shapes. Absolute paths and
filesystem handles stay on the main side.

## Where code goes

| Location                                           | What belongs there                                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/main.ts`                                 | The composition root: window lifecycle, native dialogs, `ipcMain` registration, the vault watcher, the `crashweaver-local` protocol, and the calls that wire services together. No domain logic.           |
| `electron/<name>Service.ts`                        | A domain service: the exported behaviour for one domain noun (`vaultService`, `cardStoreService`, `cardSyncService`, `crashpadService`, `settingsService`).                                                |
| `electron/cardParser.ts`                           | The boundary grammar: pure parsing and formatting of notes and UID boundaries.                                                                                                                             |
| `electron/services/`                               | Filesystem mutation services with explicit inputs — boundary lines, references, restore, the vault index. No `electron` import; they take paths and content and return results.                            |
| `electron/weaver/`                                 | The agent and its runs: the service facade, context retrieval, the ReAct graph and nodes, prompts, plan schema, providers, model profiles, request logging, session history.                               |
| `electron/weaver/weaveApplyService.ts` and similar | A weave artifact's behaviour: guards, handlers and dispatch for applying a plan.                                                                                                                           |
| `electron/utils/`                                  | Generic helpers with no domain knowledge (`paths`, `fsErrors`, `jsonFile`).                                                                                                                                |
| `src/lib/`                                         | Pure renderer helpers: no React state, no bridge calls, no side effects. Unit-tested from a file beside the module.                                                                                        |
| `src/hooks/`                                       | React stateful logic and effects. One hook per concern; name it `useXxx`.                                                                                                                                  |
| `src/state/`                                       | The shared state contexts and their providers; `index.ts` re-exports the providers, consumers and types.                                                                                                   |
| `src/components/`                                  | Presentation: components and their props. They read state through hooks and render; where they need main-process data they go through a hook or `window.crashWeaver`, never through Node or Electron APIs. |
| `tests/electron/`                                  | Main-process suites. Renderer suites sit beside their module (`src/lib/*.test.ts`).                                                                                                                        |

A new module name is expected to fit one of those rows. A file that needs two rows is two files:
`main.ts` registers and delegates to services rather than also implementing them, and pure logic
that a hook or service needs goes in `src/lib/` or a helper rather than inside the component or
the handler.

## Seams

- **Seam = an existing module boundary.** Tests exercise the exported behaviour of a module; they
  do not reach into its internals or reshape the production API to make a test easier. When a
  module is too tangled to test, split it at a boundary the domain already has (pure logic out of
  the handler is the pattern this repository uses) and let the split be the test seam.
- **The Weaver provider seam.** The LLM layer is reached through the provider interface; a test
  replaces the provider at the seam (`__setWeaveProviderForTests`) or supplies a fake transport,
  never by making the production path reach the network.
- **The filesystem seam in tests is a real temporary directory.** Tests use `fs.mkdtemp` under the
  OS temporary directory, not an in-memory filesystem double, so the code under test exercises
  real Node behaviour.
- **Test-only exports** exist only where a seam must be constructed or reset from a test. Name
  them `__...ForTests` (see [naming.md](./naming.md)) and keep them documented as test seams.
  Production code must not call them.

## Exports

- **An export exists because someone imports it.** Delete unused exports instead of keeping them
  "for later"; the compiler does not warn about an unimported export, which is exactly how the
  contract accumulated sixteen dead ones. When removing dead code would be ambiguous, record the
  reason in the commit body.
- **One public behaviour, one export.** A service exports the operations its callers use; helpers
  that only one module uses stay private to it.
- **Do not add barrel files.** Import the module directly. The one existing barrel is
  `src/state/index.ts`, which re-exports the state providers; new re-export layers hide the real
  dependency graph.

## Failures and logging

- **Throw at the point that can detect the failure; decide at the caller.** Filesystem services
  throw `Error`s with an actionable message; the main process lets the error reject the IPC call
  and the renderer surfaces it to the user. Do not swallow an error to keep a flow going.
- **Check Node error codes, not messages.** Use `getFsErrorCode` (`electron/utils/fsErrors.ts`)
  to tell `ENOENT` from `EACCES`.
- **Guard paths at the point where a relative path enters filesystem code.** The vault-root
  guards are described in [the data model](../architecture/data-model.md); new filesystem entry
  points use them.
- **Logging is a main-process diagnostic.** Main-process code logs prefixed messages
  (`CrashWeaver: ...`, and `CrashWeaver Weaver: ...` from the Weaver layer). The renderer logs only
  from its error boundary.

## Module systems and imports

- The main process compiles to **CommonJS** (`tsconfig.electron.json`). The renderer is **ES
  modules** bundled by Vite (`tsconfig.app.json`). Write new code as ESM syntax in both; `tsc`
  emits the CommonJS build.
- **Use `import type` for type-only imports** in every project. It keeps the main-process build
  from requiring type-only modules at runtime and keeps the renderer bundle free of the contract.
- The compiler options that back this split — including the one option that must never be enabled —
  are in [formatting-and-linting.md](./formatting-and-linting.md).
- **Comments explain why.** A comment that restates the code is noise; a comment that records a
  trap, a deliberate trade-off or a piece of history is required. The repository's warning
  comments — for example the note in `weaveApplyService.ts` recording that the note-to-card and
  card-to-note mutation directions are not interchangeable, and the TypeScript-configuration
  notes — exist because that history was expensive to learn.

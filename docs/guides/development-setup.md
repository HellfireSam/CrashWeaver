# Development setup

Prerequisites and the scripts you use while working on the repository. The test commands and the
known gaps are in [`tests/README.md`](../../tests/README.md), because the coverage report needs more
explanation than a script list. The code lives in [`electron/`](../../electron) (main process) and
[`src/`](../../src) (renderer); the architecture is described in
[the overview](../architecture/overview.md).

## Prerequisites

- **Node 22 LTS and npm.** The version is pinned twice: `.nvmrc` names it for `nvm`, and
  `package.json` declares `engines: { "node": ">=22.13.0 <23" }`. The floor is 22.13 because ESLint
  10 requires it. Electron 35 bundles Node 22.x, so the test runtime and the shipped runtime match.
  Run `nvm use` before installing.
- **A desktop session** for running the app window. The test suites do not need one: they
  run under plain Node and Vitest. In a headless container Electron may fail to start with
  a missing shared library such as `libnss3`; that is environmental and does not affect the
  tests.

## Install

```bash
npm ci
```

`npm ci` installs exactly what `package-lock.json` records and is the recommended first
install. `npm install` also works and is what you use when you are changing dependencies.

## Run the app in development

```bash
npm run dev
```

That single script starts three processes concurrently:

1. `dev:renderer` — the Vite dev server on `127.0.0.1:5173`. The port is fixed with
   `strictPort`, so the command fails rather than silently moving ports if 5173 is taken.
2. `dev:main` — `tsc -p tsconfig.electron.json --watch`, recompiling the main process into
   `dist-electron/` on every change.
3. `dev:electron` — waits for the dev server and for `dist-electron/main.js`, then launches
   Electron with `VITE_DEV_SERVER_URL` pointing at the dev server.

To run a production-shaped build and launch it:

```bash
npm run start
```

## Checks

The definition of done — the gate, what it proves and what CI runs — is in
[commits and pull requests](../standards/commits-and-pull-requests.md). The commands are:

```bash
npm run gate      # npm ci, then every check below
npm run checks    # every check below, without the reinstall
```

Each part is available on its own. Run the compiler across every project:

```bash
npm run typecheck
```

`typecheck` runs `tsc -b` over the solution file (the app, Vite-config and test projects) and
then `tsc -p tsconfig.electron.json --noEmit` for the main process, which is kept out of the
solution because it emits CommonJS.

Run the tests:

```bash
npm test
```

`npm test` builds the main process, then runs every suite under Vitest with coverage. The
single-suite commands, coverage and the known test gaps are documented in
[`tests/README.md`](../../tests/README.md).

The test command builds the main process first because the main-process suites import the compiled
`dist-electron/` output, never the TypeScript sources; that build is the compiled-artifact check.
A main-process suite run by hand therefore needs `npm run build:main` first.

## Lint and format

Lint the repository:

```bash
npm run lint
npm run lint:fix   # ESLint with its safe automatic fixes
```

ESLint lints every TypeScript and JavaScript file. The rule set is in
[`eslint.config.mjs`](../../eslint.config.mjs); the rules, the type-aware wiring and the warning
policy are the [formatting and linting](../standards/formatting-and-linting.md) standard.

Check or apply formatting:

```bash
npm run format:check
npm run format
```

Prettier owns formatting; the configuration and the blame-ignore arrangement are in the
[formatting and linting](../standards/formatting-and-linting.md) standard.

Build everything:

```bash
npm run build
```

`build` runs `typecheck`, then `build:renderer` (Vite, output in `dist/`), then
`build:main` (`tsc -p tsconfig.electron.json`, output in `dist-electron/`). The individual
halves are available as `npm run build:renderer` and `npm run build:main`.

## Committing

Commit messages, pull requests and the gate are the
[commits and pull requests](../standards/commits-and-pull-requests.md) standard.

## TypeScript project layout

The repository splits its TypeScript configuration the way Vite expects:

| File                     | Covers                                          | Resolution                                                                                                |
| ------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`          | solution file only — no inputs, just references | —                                                                                                         |
| `tsconfig.app.json`      | `src` (renderer)                                | `module: ESNext`, `moduleResolution: bundler`, `noEmit`                                                   |
| `tsconfig.node.json`     | `vite.config.ts`, `vitest.config.ts`            | `module: ESNext`, `moduleResolution: bundler`, `noEmit`                                                   |
| `tsconfig.tests.json`    | `tests/**/*.ts` (the test suites)               | `module: ESNext`, `moduleResolution: bundler`, `noEmit`; Node types                                       |
| `tsconfig.electron.json` | `electron` (main process)                       | `module: CommonJS`, `moduleResolution: Node`, `lib: ES2022` for `Error` `cause`, emits to `dist-electron` |

The split exists to protect a specific failure. `vite.config.ts` is an ES module, and
`package.json` declares no `"type": "module"`. When the config file inherited
`module: Node16` / `moduleResolution: node16`, TypeScript treated it as CommonJS and
resolved Vite's deprecated `index.d.cts` shim, which has no named exports — producing
`TS2305: Module '"vite"' has no exported member 'defineConfig'` and blocking the build.
`tsconfig.node.json` carries that history in a comment so the setting is not reverted. The
electron project keeps CommonJS resolution because the main process is compiled to
CommonJS.

## Directory map

| Path                                                       | What it holds                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/`                                                | main process, services, and the Weaver pipeline                                                                                                                                                                                                                                           |
| `electron/services/`                                       | boundary and reference mutation services                                                                                                                                                                                                                                                  |
| `electron/weaver/`                                         | planning graph, prompts, providers, schema, context, logging                                                                                                                                                                                                                              |
| `src/`                                                     | renderer: components, hooks, state contexts, pure helpers, styles                                                                                                                                                                                                                         |
| `src/lib/`                                                 | pure renderer helpers, with the renderer test files beside them                                                                                                                                                                                                                           |
| `tests/electron/`                                          | main-process test suites that load compiled output from `dist-electron/` under Vitest; the known gaps are named in [tests/README.md](../../tests/README.md)                                                                                                                               |
| `dist/`                                                    | Vite renderer build output                                                                                                                                                                                                                                                                |
| `dist-electron/`                                           | compiled main-process output                                                                                                                                                                                                                                                              |
| `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore` | lint and format configuration: the rules, and the files both tools skip                                                                                                                                                                                                                   |
| `.github/`                                                 | CI workflow and the pull-request template                                                                                                                                                                                                                                                 |
| `fixtures/`                                                | checked-in sample vaults for manual exercise: `mock-vault/` is the original image and `mock-vault_sample/` is a slightly older copy to open and test against, so the original stays untouched. See [fixtures/README.md](../../fixtures/README.md); neither is referenced by code or tests |
| `docs/`                                                    | current documentation, plus the [archive](../archive/README.md) and the [coding standards](../standards/README.md)                                                                                                                                                                        |

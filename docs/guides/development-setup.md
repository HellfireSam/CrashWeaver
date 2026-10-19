# Development setup

Prerequisites and every script that exists in this repository today. The code lives in
[`electron/`](../../electron) (main process) and [`src/`](../../src) (renderer); the architecture
is described in [the overview](../architecture/overview.md).

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

One command runs the whole gate from a clean clone — install, format check, lint, typecheck, tests
and build:

```bash
npm run gate
```

When dependencies are already installed, run the same checks without reinstalling:

```bash
npm run checks
```

The gate is what CI runs: the full command on Linux, and typecheck plus tests on Windows, where path
and casing behaviour differs. The configuration is
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

Each part is available on its own. Run the compiler across every project:

```bash
npm run typecheck
```

`typecheck` runs `tsc -b` over the solution file (the app and Vite-config projects) and then
`tsc -p tsconfig.electron.json --noEmit` for the main process, which is kept out of the
solution because it emits CommonJS.

Run the tests:

```bash
npm test
```

`npm test` runs `test:electron` and then `test:renderer`. The two suites use different
runners today:

| Suite                   | Runner                      | Target                                                                                     | Notes                                                                               |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `npm run test:electron` | Node's built-in `node:test` | checked-in `tests/electron/**/*.test.cjs`, which load the compiled `dist-electron/` output | runs `npm run build:main` first, so the suites always exercise current build output |
| `npm run test:renderer` | Vitest                      | explicit `src/lib/*.test.ts` files                                                         | the three files are listed in the script rather than globbed                        |

Two consequences worth knowing:

- A bare `npx vitest run` is **not** how the renderer suite is run. Vitest's default glob
  also collects the `node:test` `.cjs` files and reports them as "No test suite found"
  failures. Those are not real failures; `npm run test:renderer` is.
- `test:electron` depends on the compiled output, so a single electron test file is run
  after building:

```bash
npm run build:main
node --test tests/electron/weaveApplyService.test.cjs
```

A single renderer test file needs no build:

```bash
npx vitest run src/lib/markdownPreview.test.ts
```

## Lint and format

Lint the repository:

```bash
npm run lint
```

`lint` runs ESLint over `src/`, `electron/`, `vite.config.ts` and the CommonJS test
suites. The rule set is ESLint's recommended set, typescript-eslint's recommended set, the
React hooks and React refresh plugins, and three type-aware async rules —
`no-floating-promises`, `no-misused-promises` and `await-thenable` — which catch the failure this
codebase has actually suffered: a promise that never settles and raises no error. Those rules need
a TypeScript program, so each file group is resolved against its own project
(`tsconfig.app.json`, `tsconfig.electron.json`, `tsconfig.node.json`). The config lives in
[`eslint.config.mjs`](../../eslint.config.mjs).

The command currently exits 0 with warnings: 20 `react-hooks/exhaustive-deps` and 8
`react-refresh/only-export-components`. They are left visible rather than suppressed. The
warnings-to-zero ratchet belongs with the coding standards, not with the change that introduced the
linter, so treat a _new_ warning as a regression even though the command stays green.

Check or apply formatting:

```bash
npm run format:check
npm run format
```

Prettier owns formatting and no stylistic ESLint rule is enabled, so the two cannot contradict each
other. One commit in this repository's history is a whole-repository Prettier run; its hash is
listed in [`.git-blame-ignore-revs`](../../.git-blame-ignore-revs) and excluded from blame. To have
`git blame` honour that file in your clone:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Build everything:

```bash
npm run build
```

`build` runs `typecheck`, then `build:renderer` (Vite, output in `dist/`), then
`build:main` (`tsc -p tsconfig.electron.json`, output in `dist-electron/`). The individual
halves are available as `npm run build:renderer` and `npm run build:main`.

`npm run gate` is the definition of green: it runs `npm ci`, then `npm run checks`, which is
`format:check`, `lint`, `typecheck`, `npm test` and `build` in that order. CI enforces it on every
push and pull request to `main`.

## Committing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The type list, scopes
and pull-request expectations are in [CONTRIBUTING.md](../../CONTRIBUTING.md); [AGENTS.md](../../AGENTS.md)
carries the same rules for automated agents.

## TypeScript project layout

The repository splits its TypeScript configuration the way Vite expects:

| File                     | Covers                                          | Resolution                                                                                                |
| ------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `tsconfig.json`          | solution file only — no inputs, just references | —                                                                                                         |
| `tsconfig.app.json`      | `src` (renderer)                                | `module: ESNext`, `moduleResolution: bundler`, `noEmit`                                                   |
| `tsconfig.node.json`     | `vite.config.ts`                                | `module: ESNext`, `moduleResolution: bundler`, `noEmit`                                                   |
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
| `tests/electron/`                                          | `node:test` suites that load compiled output from `dist-electron/`                                                                                                                                                                                                                        |
| `dist/`                                                    | Vite renderer build output                                                                                                                                                                                                                                                                |
| `dist-electron/`                                           | compiled main-process output                                                                                                                                                                                                                                                              |
| `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore` | lint and format configuration: the rules, and the files both tools skip                                                                                                                                                                                                                   |
| `.github/`                                                 | CI workflow and the pull-request template                                                                                                                                                                                                                                                 |
| `fixtures/`                                                | checked-in sample vaults for manual exercise: `mock-vault/` is the original image and `mock-vault_sample/` is a slightly older copy to open and test against, so the original stays untouched. See [fixtures/README.md](../../fixtures/README.md); neither is referenced by code or tests |
| `docs/`                                                    | current documentation, plus the [archive](../archive/README.md)                                                                                                                                                                                                                           |

# Development setup

Prerequisites and every script that exists in this repository today. The code lives in
[`electron/`](../../electron) (main process) and [`src/`](../../src) (renderer); the architecture
is described in [the overview](../architecture/overview.md).

## Prerequisites

- **Node.js and npm.** The dependency set is built against Node 22: `@types/node` is major
  22 and Electron 35 bundles Node 22.x. The repository does **not** pin a Node version yet
  — there is no `.nvmrc` and no `engines` field in `package.json` — so install Node 22 LTS
  to match the types and the runtime the app ships with.
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

Run the compiler across every project:

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

| Suite | Runner | Target | Notes |
| --- | --- | --- | --- |
| `npm run test:electron` | Node's built-in `node:test` | checked-in `tests/electron/**/*.test.cjs`, which load the compiled `dist-electron/` output | runs `npm run build:main` first, so the suites always exercise current build output |
| `npm run test:renderer` | Vitest | explicit `src/lib/*.test.ts` files | the three files are listed in the script rather than globbed |

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

Build everything:

```bash
npm run build
```

`build` runs `typecheck`, then `build:renderer` (Vite, output in `dist/`), then
`build:main` (`tsc -p tsconfig.electron.json`, output in `dist-electron/`). The individual
halves are available as `npm run build:renderer` and `npm run build:main`.

There is no one-command gate and no linter or formatter yet; until they land, "green" means
the checks above.

## TypeScript project layout

The repository splits its TypeScript configuration the way Vite expects:

| File | Covers | Resolution |
| --- | --- | --- |
| `tsconfig.json` | solution file only — no inputs, just references | — |
| `tsconfig.app.json` | `src` (renderer) | `module: ESNext`, `moduleResolution: bundler`, `noEmit` |
| `tsconfig.node.json` | `vite.config.ts` | `module: ESNext`, `moduleResolution: bundler`, `noEmit` |
| `tsconfig.electron.json` | `electron` (main process) | `module: CommonJS`, `moduleResolution: Node`, emits to `dist-electron` |

The split exists to protect a specific failure. `vite.config.ts` is an ES module, and
`package.json` declares no `"type": "module"`. When the config file inherited
`module: Node16` / `moduleResolution: node16`, TypeScript treated it as CommonJS and
resolved Vite's deprecated `index.d.cts` shim, which has no named exports — producing
`TS2305: Module '"vite"' has no exported member 'defineConfig'` and blocking the build.
`tsconfig.node.json` carries that history in a comment so the setting is not reverted. The
electron project keeps CommonJS resolution because the main process is compiled to
CommonJS.

## Directory map

| Path | What it holds |
| --- | --- |
| `electron/` | main process, services, and the Weaver pipeline |
| `electron/services/` | boundary and reference mutation services |
| `electron/weaver/` | planning graph, prompts, providers, schema, context, logging |
| `src/` | renderer: components, hooks, state contexts, pure helpers, styles |
| `src/lib/` | pure renderer helpers, with the renderer test files beside them |
| `tests/electron/` | `node:test` suites that load compiled output from `dist-electron/` |
| `dist/` | Vite renderer build output |
| `dist-electron/` | compiled main-process output |
| `mock-vault/`, `mock-vault_sample/`, `template-mock-gallery/` | checked-in sample material for manual exercise: `mock-vault/` is the sample vault, `mock-vault_sample/` is a duplicate copy of it, and `template-mock-gallery/` is a template gallery; none of them is referenced by code or tests |
| `docs/` | current documentation, plus the [archive](../archive/README.md) |

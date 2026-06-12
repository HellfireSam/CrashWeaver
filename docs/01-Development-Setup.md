# Development Setup (Canonical)

This file is the single source of truth for local setup and standard validation commands.

For product definitions and architecture boundaries, see `docs/00-Single-Source-of-Truth.md`.

## Prerequisites

- Windows environment (project validation target)
- Node.js 20 LTS or newer
- npm (bundled with Node.js)

## Initial Setup

1. Open a terminal in the repository root.
2. Install dependencies:

```bash
npm install
```

## Daily Development

Run the app in development mode:

```bash
npm run dev
```

## Standard Validation

Typecheck:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Test infrastructure:
- **Electron (main process)**: Node.js built-in test runner (`node:test`) targeting compiled `.cjs` output in `dist-electron/`. Test files live in `tests/electron/*.test.cjs`. Run with `npm run test:electron`. Requires `npm run build:main` first.
- **Renderer (Vite)**: Vitest targeting TypeScript source in `src/`. Run with `npm run test:renderer`.
- To run a single test file: `node --test tests/electron/weaveGraphNodes.test.cjs` (after build).

Build all targets:

```bash
npm run build
```

Build Electron main only:

```bash
npm run build:main
```

## Stage Validation Guides

Use these files for manual validation flows:
- `docs/Stage 1 Setup.md`
- `docs/Stage 2 Setup.md`
- `docs/Stage 3 Setup.md`
- `docs/Stage 4 Setup.md`
- `docs/Stage 5 Setup.md`


> **Superseded.** Archived 2026-10-11 from `docs/01-Development-Setup.md` during the
> [documentation rewrite](https://github.com/HellfireSam/CrashWeaver/issues/3). This document records what was believed when it was
> written and carries no authority.
> Current documentation: [docs index](../README.md) · Replacement: [archive index](./README.md).

---

# Development Setup

This file described local setup and standard validation commands. For current setup instructions see [`docs/guides/development-setup.md`](../guides/development-setup.md).

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
- `./stage-1-setup.md`
- `./stage-2-setup.md`
- `./stage-3-setup.md`
- `./stage-4-setup.md`
- `./stage-5-setup.md`


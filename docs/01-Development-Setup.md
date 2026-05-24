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


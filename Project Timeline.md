# Project Timeline

This file tracks sequencing and planning only.

Canonical product and architecture source:
- docs/00-Single-Source-of-Truth.md

## Status (May 2026)

Completed:
- Stage 1: shell foundation
- Stage 2: vault workflows and editor shell
- Stage 3: card boundary parser and card-store synchronization
- Stage 4: crashpad canvas and card authoring workflows

Planned:
- Stage 5: Weaver planning, guided insert permissions, intelligent strengths, and staged proposal contracts
- Stage 6: accept/reject diff gate and apply or reject UX for Weaver changes
- Stage 7: card-level scheduling and review
- Stage 8: hardening and release preparation

## Stage Plan

| Stage | Status | Notes |
|---|---|---|
| 1. Shell Foundation | complete | Electron shell, preload bridge, renderer base |
| 2. Vault Backend and Editor Shell | complete | Vault open/read/write/index and editor shell |
| 3. Crash Card Parser and Card Store Sync | complete | Strict UID parser and reference sync |
| 4. Crashpad Canvas and Card Authoring | complete | Crashpad files, card CRUD flows, undo/redo |
| 5. Weaver Planning and Guided Insert | planned | Single-card guided insert with optional `edit-content` / `create-note` permissions, plus intelligent light/standard/go ham restructuring; read-only proposal staging |
| 6. Approval Layer and Diff UX | planned | Explicit accept/reject diff review before any Weaver writes |
| 7. Card-Level Scheduling and Review | planned | Familiarity and next-review loop |
| 8. Test Hardening and Release Prep | planned | Integration coverage and release checks |

## Planning Rules

- If timeline detail conflicts with docs/00-Single-Source-of-Truth.md, the canonical file wins.
- Keep this file focused on status and sequencing, not product definitions.


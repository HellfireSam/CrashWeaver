> **Superseded.** Archived 2026-10-11 from `Project Timeline.md` during the
> [documentation rewrite](https://github.com/HellfireSam/CrashWeaver/issues/3). This document records what was believed when it was
> written and carries no authority.
> Current documentation: [docs index](../README.md) · Replacement: [archive index](./README.md).

---

# Project Timeline

This file tracked sequencing and planning only.

## Status (June 2026)

Completed:
- Stage 1: shell foundation
- Stage 2: vault workflows and editor shell
- Stage 3: card boundary parser and card-store synchronization
- Stage 4: crashpad canvas and card authoring workflows
- Stage 5: Weaver planning — guided insert + intelligent restructuring, live OpenRouter path, session history, live progress feed, budget controls, schema/repair hardening, embedding search
- Stage 6: approval layer and diff UX — accept/reject diff gate, apply service for 10 operation kinds, per-operation diff previews, destructive-op confirmation dialog, apply result feedback

Planned:
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
| 5. Weaver Planning and Guided Insert | complete | Guided insert with optional `edit-content` / `create-note` permissions, intelligent light/standard/go ham restructuring, live OpenRouter, session history, progress feed, budget controls, embedding search; read-only proposal staging |
| 6. Approval Layer and Diff UX | complete | Explicit accept/reject diff review before any Weaver writes |
| 7. Card-Level Scheduling and Review | planned | Familiarity and next-review loop |
| 8. Test Hardening and Release Prep | planned | Integration coverage and release checks |

## Planning Rules

- This rule referenced a document that has been retired; it is retained only as a record of the planning convention in force at the time.
- Keep this file focused on status and sequencing, not product definitions.


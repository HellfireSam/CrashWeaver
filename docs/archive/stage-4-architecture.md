> **Superseded.** Archived 2026-10-11 from `docs/Stage 4 Architecture.md` during the
> [documentation rewrite](https://github.com/HellfireSam/CrashWeaver/issues/3). This document records what was believed when it was
> written and carries no authority.
> Current documentation: [docs index](../README.md) · Replacement: [archive index](./README.md).

---

# Stage 4 Architecture

## Stage Goal

Implement crashpad card authoring over the shared card store.

## Delivered

- Crashpad files at .crashweaver/crashpads/*.crashpad.json
- Daily crashpad open/create workflow
- Open existing card and create new card flows
- Card edit and delete workflows with configurable confirmation behavior
- Session undo/redo across crashpad mutations
- Explorer surfacing for crashpad and internal .crashweaver directories

## Stage Boundary

Stage 4 does not implement Weaver planning, accept/reject diff gating, or review scheduling.


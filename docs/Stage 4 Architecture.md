# Stage 4 Architecture

Canonical source:
- docs/00-Single-Source-of-Truth.md

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


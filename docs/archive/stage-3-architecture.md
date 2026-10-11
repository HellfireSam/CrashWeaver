> **Superseded.** Archived 2026-10-11 from `docs/Stage 3 Architecture.md` during the
> [documentation rewrite](https://github.com/HellfireSam/CrashWeaver/issues/3). This document records what was believed when it was
> written and carries no authority.
> Current documentation: [docs index](../README.md) · Replacement: [archive index](./README.md).

---

# Stage 3 Architecture

## Stage Goal

Implement strict card boundary parsing and card-store synchronization.

## Delivered

- Parser for paired UID boundaries in markdown notes
- Per-card JSON persistence in configurable card-store path
- Note reference tracking with note_path, start_line, and end_line
- Sync on vault open, note save, index refresh, and external markdown changes
- Read-only Cards workspace diagnostics in renderer

## Stage Boundary

Stage 3 does not include crashpad authoring UX or Weaver workflows.


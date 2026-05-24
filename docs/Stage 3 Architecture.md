# Stage 3 Architecture

Canonical source:
- docs/00-Single-Source-of-Truth.md

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


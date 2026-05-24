# Stage 1 Architecture

Canonical source:
- docs/00-Single-Source-of-Truth.md

## Stage Goal

Provide the runtime safety foundation used by all later stages.

## Delivered

- Electron desktop shell
- React plus TypeScript renderer shell
- Preload bridge pattern for restricted API exposure
- Build scripts for local development and production packaging

## Stage Boundary

Stage 1 does not implement card parsing, card-store sync, crashpad authoring, or Weaver.


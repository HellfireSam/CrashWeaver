> **Superseded.** Archived 2026-10-11 from `docs/Stage 1 Architecture.md` during the
> [documentation rewrite](https://github.com/HellfireSam/CrashWeaver/issues/3). This document records what was believed when it was
> written and carries no authority.
> Current documentation: [docs index](../README.md) · Replacement: [archive index](./README.md).

---

# Stage 1 Architecture

## Stage Goal

Provide the runtime safety foundation used by all later stages.

## Delivered

- Electron desktop shell
- React plus TypeScript renderer shell
- Preload bridge pattern for restricted API exposure
- Build scripts for local development and production packaging

## Stage Boundary

Stage 1 does not implement card parsing, card-store sync, crashpad authoring, or Weaver.


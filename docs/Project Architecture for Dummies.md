# CrashWeaver Architecture for Beginners

This file is a simplified entry point.

Canonical source:
- docs/00-Single-Source-of-Truth.md

## Mental Model

CrashWeaver has three layers:
- Main process: native power and filesystem access
- Preload process: safe API bridge to renderer
- Renderer process: React UI

Crash cards use two storage surfaces:
- Markdown notes: boundary comments only
- Card store JSON: full structured card data

Crashpad is the card authoring canvas operating on the shared card store.

Weaver is the planned LLM-assisted vault insertion assistant:
1. **Guided Insert**: Starts from a single focused crashpad card and inserts that card into related markdown note(s) in the vault. Insert is always allowed. Users may optionally grant `edit-content` and `create-note` permissions.
2. **Intelligent Weaver**: Starts from the same focused-card entry point but may propose broader note and directory restructuring, including create, edit, move, rename, and delete operations when that improves knowledge presentation.

Weaver planning uses a condensed retrieval layer plus read-only access to the vault's directory structure and selected markdown note content, so it can reason about the vault without loading every note into the prompt.

Intelligent Weaver strength levels guide how aggressive the restructuring may be:
- Light
- Standard
- Go ham

Users may provide insertion intent. Stage 5 handles non-destructive, read-only agentic proposals. Stage 6 provides explicit accept/reject approval before any vault structural adjustments or card mutations occur.

## How To Use This Doc

Use this file for orientation only. Use docs/00-Single-Source-of-Truth.md for exact rules, schema, and current implementation status.


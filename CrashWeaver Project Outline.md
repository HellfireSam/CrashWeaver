# CrashWeaver Project Outline

This file is now an executive summary.

Canonical source of truth:
- docs/00-Single-Source-of-Truth.md

Global setup and validation commands:
- docs/01-Development-Setup.md

Timeline and delivery sequencing:
- Project Timeline.md

## Summary

CrashWeaver is an Electron app for working with Obsidian vault content through Crash Cards.

- Notes contain lightweight UID boundaries.
- Full card payloads live in per-card JSON files in a configurable card store.
- Crashpad supports card authoring over the same shared store.
- Weaver is the LLM-assisted vault insertion workflow, starting from a single focused crashpad card by default.
- Guided insert always stages note insertion and may optionally receive `edit-content` and `create-note` permissions.
- Intelligent Weaver may propose broader note and directory restructuring, guided by light, standard, and go ham strength levels plus user insertion intent.
- Weaver uses compact vault retrieval plus targeted read-only note access rather than sending the full vault to the model.
- Stage 5 stages read-only Weaver proposals; Stage 6 adds accept/reject diff approval before any writes.

For definitions, schema, architecture boundaries, stage status, and acceptance principles, use docs/00-Single-Source-of-Truth.md only.


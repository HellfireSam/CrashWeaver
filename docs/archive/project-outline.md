> **Superseded.** Archived 2026-10-11 from `CrashWeaver Project Outline.md` during the
> [documentation rewrite](https://github.com/HellfireSam/CrashWeaver/issues/3). This document records what was believed when it was
> written and carries no authority.
> Current documentation: [docs index](../README.md) · Replacement: [archive index](./README.md).

---

# CrashWeaver Project Outline

This file was an executive summary for the project.

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

See [the documentation index](../README.md) for current documentation.


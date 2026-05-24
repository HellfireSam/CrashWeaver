# CrashWeaver Single Source of Truth

This document is the canonical source for product definitions, architecture boundaries, stage status, and delivery direction.

If any other documentation disagrees with this file, this file wins.

## 1. Product Model

CrashWeaver is an Electron desktop app that works with an Obsidian vault.

Core unit:
- Crash Card (card)

Storage model:
- Notes contain only UID boundary comments around relevant note text.
- Full card payload lives in per-card JSON files in a configurable card store folder.

Boundary format:

```md
%%CW_CARD_START uid:<UID>%%
<markdown text linked to card>
%%CW_CARD_END uid:<UID>%%
```

Canonical card JSON shape:

```json
{
  "uid": "CW-001",
  "type": ["concept"],
  "raw_content": "...",
  "metadata": {
    "familiarity": 0,
    "next_review": null
  },
  "memory_tricks": {
    "memory_technique": "...",
    "qa_pairs": []
  },
  "referenced_in": [
    {
      "note_path": "notes/example.md",
      "start_line": 10,
      "end_line": 16
    }
  ]
}
```

## 2. Runtime Architecture

Layers:
- Main process: privileged filesystem and native app lifecycle.
- Preload process: safe, limited bridge for renderer calls.
- Renderer process: React UI and interaction orchestration.

Core Electron services:
- `vaultService.ts`: orchestration layer for vault and card workflows.
- `cardParser.ts`: strict boundary parsing and diagnostics.
- `cardStoreService.ts`: per-card JSON persistence.
- `cardSyncService.ts`: note-to-card reference sync.
- `crashpadService.ts`: crashpad file lifecycle.
- `services/cardBoundaryService.ts`: pure boundary line transforms.
- `services/noteReferenceMutationService.ts`: safe note path and read helpers.
- `services/cardReferenceMutationService.ts`: rename and delete boundary mutations.
- `services/cardRestoreMutationService.ts`: boundary reinsertion in restore flows.
- `services/crashpadCardMutationService.ts`: crashpad UID mutation propagation.

## 3. Functional Areas

Crashpad:
- Canvas files at `{vaultRoot}/.crashweaver/crashpads/*.crashpad.json`
- Open existing cards, create new cards, edit fields, delete with preferences, undo and redo
- Daily shortcut opens or creates `YYYY-MM-DD.crashpad.json`

Vault sync:
- On vault open, note save, index refresh, and external markdown changes
- Maintains `referenced_in` links with `note_path`, `start_line`, and `end_line`
- Parser errors block destructive cleanup for safety

Weaver:
- Planned
- Any LLM-proposed edit must remain behind explicit accept/reject approval before writes

## 4. Current Status (May 2026)

Implemented:
- Stage 1 foundation
- Stage 2 vault workflows and renderer shell
- Stage 3 parser plus card-store sync
- Stage 4 crashpad workflows and crashpad-focused undo/redo

Planned:
- Stage 5 Weaver planning and insert modes
- Stage 6 accept/reject diff gate for LLM changes
- Stage 7 card-level scheduling and review loop
- Stage 8 hardening and release prep

## 5. Acceptance Principles

- Card boundaries must parse as strict start/end UID pairs.
- Full card payload belongs in card JSON, not in boundary comments.
- `referenced_in` must track note path and boundary line range.
- Note create/modify/delete must reconcile references deterministically.
- Crashpad operations must preserve shared card schema compatibility.
- LLM edits must never auto-apply.

## 6. Documentation Contract

The following files are supporting docs and must defer to this canonical source:
- `CrashWeaver Project Outline.md`
- `Project Timeline.md`
- `docs/Project Architecture for Dummies.md`
- `docs/Stage 1 Architecture.md`
- `docs/Stage 2 Architecture.md`
- `docs/Stage 3 Architecture.md`
- `docs/Stage 4 Architecture.md`
- `docs/Card Insert Templates.md`
- `docs/Card Workspace Template Options.md`

Setup and validation source split:
- Global setup commands: `docs/01-Development-Setup.md`
- Stage-specific manual validation: `docs/Stage X Setup.md`


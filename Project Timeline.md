# Project Timeline

## Executive Summary

This timeline reflects the clarified product direction:

- Crash Card is the core data unit
- cards are represented in vault notes using two UID-linked comment boundaries
- full card payloads are stored as separate JSON files in a user-configurable card store folder
- each card file tracks `note_path`, `start_line`, and `end_line` for every note reference
- vault note create, modify, and delete events synchronize the affected card files
- Crashpad is the card drafting canvas over the shared card store
- Weaver performs LLM-assisted insertion with multiple modes
- all Weaver edits require explicit accept-reject approval before execution

Stage 1 and Stage 2 are already implemented in this repository. The table below is the working plan for Stage 3 and beyond.

## Status Update (May 2026)

Implemented now:

- Electron shell and preload bridge
- vault open, read, write, and index refresh workflows
- note-level index generation
- source and preview workflows with math rendering
- explorer behavior and layout stabilization

Not yet implemented:

- card boundary parsing
- external card store and note-reference sync
- Crashpad workflows over the shared card store
- Weaver insertion modes
- card-level review execution

## Stage Plan

| Stage | Duration (weeks) | Dependencies | Milestones and Deliverables |
|---|---:|---|---|
| 1. Shell Foundation | complete | - | Electron shell, preload bridge, initial renderer |
| 2. Vault Backend and Editor Shell | complete | 1 | Vault open/read/write/index, Stage 2 UI shell |
| 3. Crash Card Parser and Card Store Sync | 2-3 | 2 | Parse paired UID boundaries; write per-card JSON files in configurable folder; track start and end lines; reconcile note create, modify, and delete changes |
| 4. Crashpad Canvas and Card Authoring | 2-3 | 3 | Create, edit, and organize cards in shared store; card create/edit/delete-confirm/undo/redo; boundary copy helpers |
| 5. Weaver Planning and Insert Modes | 3-4 | 3,4 | Plain insert, insert+edit, create new, intelligent weaver levels |
| 6. Approval Layer and Diff UX | 2-3 | 5 | Accept-reject layer for all Weaver proposals, no auto-apply |
| 7. Card-Level Scheduling and Review | 2-3 | 3,4,6 | Metadata updates, due queue, card review updates persisted to card files |
| 8. Test Hardening and Release Prep | 2 | 3-7 | Parser tests, workflow tests, packaging validation |

## Delivery Notes By Stage

### Stage 3: Crash Card Parser and Card Store Sync

Deliverables:

- parser for two-comment card boundaries in markdown notes
- per-card JSON store keyed by UID in a configurable folder
- tracking of `note_path`, `start_line`, and `end_line` for each note reference
- sync logic for note create, modify, and delete events
- migration-safe handling for malformed or partial boundaries

Acceptance criteria:

- selected test notes produce stable card extraction results
- note edits deterministically update linked card files without losing unrelated references
- deleted note references are removed from affected card files

### Stage 4: Crashpad

Deliverables:

- Crashpad canvas operating on the shared card store
- card store folder setting
- open existing cards and create new card flows
- canvas actions: create, edit, delete (confirm), undo, redo

Acceptance criteria:

- user can manage multiple cards in the configured card store folder
- card field edits persist correctly to per-card JSON files

### Stage 5: Weaver Modes

Deliverables:

- plain insert mode
- insert plus edit mode
- create new note mode
- intelligent weaver mode with light, standard, and go ham options
- support for user-provided insertion intent hints

Acceptance criteria:

- Weaver proposals are generated for each mode with clear operation plans

### Stage 6: Accept-Reject Layer

Deliverables:

- visual diff of proposed additions and removals
- staged execution model that only runs after user acceptance

Acceptance criteria:

- rejected plans apply zero changes
- accepted plans apply only approved operations

### Stage 7: Card-Level Scheduling

Deliverables:

- card metadata update pipeline (familiarity, next review, etc.)
- due list and review queue
- card-level review result persistence to card files

Acceptance criteria:

- review outcomes deterministically change next review schedule

### Stage 8: Test and Release Prep

Deliverables:

- parser and workflow integration tests
- acceptance tests for approval gate behavior
- build and packaging validation for target platforms

Acceptance criteria:

- release candidate passes all gating tests and manual checklist

## Risks And Controls

- parser ambiguity in free-form markdown:
  define strict boundary grammar and add recovery behavior
- accidental destructive LLM edits:
  enforce mandatory accept-reject gating with operation-level previews
- card schema drift:
  version the card JSON schema and provide migration handling
- sync drift between notes and card store:
  combine incremental change handling with a full rebuild or reconcile command
- performance on large vaults:
  lazy load and incremental synchronization

## Suggested Milestone Sequence

1. parser stability first
2. Crashpad authoring second
3. Weaver generation third
4. approval layer before any broad automation
5. scheduling and release hardening last

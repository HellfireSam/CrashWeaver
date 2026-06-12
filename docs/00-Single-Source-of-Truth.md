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

Card field semantics:
- `uid` is the single card title or ID and must be unique.
- `type` stores category tags or labels.
- `metadata` holds scheduling state even before review workflows are implemented.
- `memory_tricks.memory_technique` stores a short mnemonic phrase or keyword.
- `memory_tricks.qa_pairs` stores prompt and answer pairs, including blank-style prompts written directly into the question text.

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

Stage 5 services (`electron/weaver/`):
- `weaveService.ts`: plans and stages Weaver proposals for inserting a focused crashpad card into vault notes, plus intelligent vault restructuring proposals driven by explicit permissions, strength, and user intent.
- `weaveGraph.ts` and `weaveGraphNodes.ts`: run the procedural ReAct planning loop (transition-table state machine, no LangChain/LangGraph) with schema validation and repair passes.
- `weaveGraphState.ts`: typed state model, `WeaveMessage` type, graph step/route enums, budget guard constants.
- `weaveHttpClient.ts`: `WeaveHttpClient` interface and `OpenRouterHttpClient` (Electron net.fetch + AbortController timeout).
- `openRouterClient.ts`: `OpenRouterWeaveProvider` — model resolution, profile, context → graph execution.
- `stubWeaveProvider.ts`: deterministic stub for offline/testing.
- `weavePlanPrompts.ts`: 10-layer composable prompt architecture.
- `weavePlanSchema.ts`: request and result schema validation, path normalisation, boundary marker checks.
- `weaveContextService.ts`: context snapshot builder, hybrid candidate note scoring (keyword + embedding), read-only tool runtime (7 tools via a handler registry, including `refresh_candidates`).
- `weaveModelProfiles.ts`: single source of truth for model resolution (UI tiers → OpenRouter IDs), provider-prefix-based model detection, structured output config, repair strategy, execution budgets with safe bounds.
- `weaverEmbeddingService.ts`: OpenRouter embeddings API client (`text-embedding-3-small`), cosine similarity, embedding cache with SHA256 content-hash validation.
- `weaveRequestLogger.ts`: per-session JSONL request logs with sensitive-data redaction.
- `weaveTraceCompactor.ts`: ReAct trace compaction for bounded memory.
- `weaverSessionHistory.ts`: session history index from JSONL logs (list/get/delete/clear).

Planned services:
- `reviewService.ts`: future scheduling and familiarity updates over the shared card schema.

## 3. Functional Areas

Crashpad:
- Canvas files at `{vaultRoot}/.crashweaver/crashpads/*.crashpad.json`
- Open existing cards, create new cards, edit fields, delete with preferences, undo and redo
- Daily shortcut opens or creates `YYYY-MM-DD.crashpad.json`
- Manual insert support exposes copyable start and end boundary comments keyed to the card UID
- Any future LLM assistance in crashpad must preserve the shared card schema and stay non-destructive until approved

Vault sync:
- On vault open, note save, index refresh, and external markdown changes
- Maintains `referenced_in` links with `note_path`, `start_line`, and `end_line`
- Parser errors block destructive cleanup for safety

Weaver:
- An AI-assisted vault insertion and restructuring system that starts from crashpad cards and targets markdown notes and folders in the vault.
- Default scope is a single focused crashpad card. That focused card is the primary Stage 5 planning unit.
- Guided insert is the default Weaver workflow:
  - Insert into existing vault notes is always allowed.
  - Optional permissions let Weaver also edit surrounding note content and create a new markdown note when no suitable note exists.
  - A `create-note` proposal must create a real markdown note with meaningful supporting prose plus the embedded card boundary pair.
- Intelligent Weaver is the broader restructuring workflow:
  - It may propose creating, editing, moving, renaming, or deleting notes and directories when that improves knowledge presentation around the focused card.
  - Intelligent Weaver strength levels (Light, Standard, Go Ham) guide how aggressively the model may restructure the vault. Strength changes prompt autonomy only; it does not define model routing.
- Because the full vault exceeds context limits, Weaver uses a condensed retrieval layer plus read-only access to vault directory structure and markdown note content, requesting deeper note reads only when needed.
- Stage 5 responses include a structured ReAct trace (thought, action, observation, and repair outcomes) for transparent review in the renderer.
- Crashpad is Weaver's source context, not a target mutation surface.
- Stage 5 must stage proposals generated by the agentic flow in a deterministic, reviewable format without immediately writing files.
- Stage 5 settings include preferred model persistence plus optional budget overrides and an explicit disable switch for budget restrictions.
- Stage 6 must provide the accept/reject diff gate before any Weaver-driven vault structural writes or note edits exist.
- Until the approval layer exists, Weaver remains read-only for physical file changes.

Review:
- Planned card-level scheduling loop based on `metadata.familiarity`, `metadata.next_review`, and `memory_tricks`
- Review workflows must remain compatible with the shared card JSON schema and note-boundary model

## 4. Current Status (June 2026)

Implemented:
- Stage 1 foundation
- Stage 2 vault workflows and renderer shell
- Stage 3 parser plus card-store sync
- Stage 4 crashpad workflows and crashpad-focused undo/redo
- Stage 5 core planning loop with live OpenRouter path, schema/repair hardening, request logging, renderer ReAct trace visibility, and user-configurable budget settings
- Stage 5 June 2026 hardening pass: removed LangChain dependency (native `WeaveMessage` type), transition-table state machine, `AbortController` timeout, tool handler registry, unified model profiles, split HTTP transport layer

Planned:
- Stage 6 accept/reject diff gate and apply or reject UX for Weaver changes
- Stage 7 card-level scheduling and review loop
- Stage 8 hardening and release prep

## 5. Acceptance Principles

- Card boundaries must parse as strict start/end UID pairs.
- Full card payload belongs in card JSON, not in boundary comments.
- `referenced_in` must track note path and boundary line range.
- Note create/modify/delete must reconcile references deterministically.
- Crashpad operations must preserve shared card schema compatibility.
- Weaver proposals must preserve boundary rules and shared-card invariants even when they propose broader note, file, or directory changes.
- LLM edits must never auto-apply.
- Any future apply path must show additions and removals clearly and require explicit user acceptance before writes.

## 6. Documentation Contract

The following files are supporting docs and must defer to this canonical source:
- `CrashWeaver Project Outline.md`
- `Project Timeline.md`
- `docs/Project Architecture for Dummies.md`
- `docs/Stage 1 Architecture.md`
- `docs/Stage 2 Architecture.md`
- `docs/Stage 3 Architecture.md`
- `docs/Stage 4 Architecture.md`
- `docs/Stage 5 Architecture.md`
- `docs/LLM Layer - OpenRouter Implementation.md`
- `docs/Card Insert Templates.md`
- `docs/Card Workspace Template Options.md`

Setup and validation source split:
- Global setup commands: `docs/01-Development-Setup.md`
- Stage-specific manual validation: `docs/Stage X Setup.md`


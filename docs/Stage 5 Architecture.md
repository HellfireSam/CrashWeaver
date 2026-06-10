# Stage 5 Architecture

Canonical source:
- docs/00-Single-Source-of-Truth.md

## Stage Goal

Introduce Weaver as a non-destructive planning layer for inserting a focused crashpad card into vault notes, with explicit guided permissions and a separate intelligent vault-restructuring mode.

## Planned Deliverables

- A Weaver workflow entry point from the right-side LLM panel while a crashpad is active
- Single focused-card planning by default, using the currently focused crashpad card as the source context
- Guided insert controls where insert is always allowed and `edit-content` / `create-note` are explicit optional user permissions
- Intelligent Weaver mode with light, standard, and go ham strengths for broader vault restructuring proposals
- Integration with a condensed retrieval layer plus read-only vault exploration of directory structure and targeted markdown note content
- Optional insertion intent captured as structured user guidance for planning
- A staged proposal contract describing vault note and directory changes only, including create, edit, move, rename, and delete proposals where permitted
- A procedural ReAct orchestration loop with model-call, tool-call, validation, and repair steps captured as structured trace output
- Renderer visibility into ReAct traces for proposal review and debugging
- User-configurable model budget policy controls, including max tokens, timeout, iteration limits, and an explicit disable-budgets toggle
- A split right sidebar that can host both context/properties and LLM interaction, with each subpanel independently closable and reopenable
- Agentic context packaging that gives Weaver the active crashpad state, focused card, user guidance, compact vault summaries, and on-demand note-read access


## Delivery Sequence

Stage 5 is being delivered in parts so the non-destructive contract lands before any live provider dependency.

- Part 1: shared Weaver contracts, IPC/preload bridge, safety validation, a split right-panel proposal surface, and a deterministic stub provider that mirrors guided insert and intelligent restructuring semantics
- Part 2: live OpenRouter-backed plan generation using read-only vault exploration tools and condensed retrieval contexts
- Part 3: additional hardening, richer error UX, and focused Stage 5 regression coverage

During Part 1, proposal generation may be stub-backed, but the staged output must still use the same Stage 5 contracts mapping to valid vault note or directory edits.

## Implementation Update (June 2026)

- Part 1 and Part 2 are now implemented in the codebase.
- Part 3 hardening has started, including:
	- ReAct trace propagation through contracts, graph state, provider responses, and renderer surfaces.
	- Expanded schema/repair handling in graph nodes for malformed output and boundary/schema violations.
	- Settings persistence and IPC bridge support for user-adjustable budget controls and disable-budgets mode.
	- OpenRouter request log coverage used for iterative validation and repair-loop tuning.
- June 2026 hardening pass completed:
	- Removed LangChain dependency — replaced `BaseMessage`/`SystemMessage`/`HumanMessage`/`AIMessage` with native `WeaveMessage` type (`{ role, content }`).
	- Replaced fragile `while(true)` string-dispatch loop with a `resolveNextStep()` transition table.
	- Added hard step cap (`MAX_TOTAL_STEPS = 24`) to prevent infinite repair oscillation.
	- HTTP timeout upgraded from `Promise.race` to `AbortController` for proper request cancellation.
	- Collapsed `weaveCostPolicy.ts` into `weaveModelProfiles.ts` as the single source of truth for model resolution and budgets.
	- Extracted HTTP transport to `weaveHttpClient.ts`; `openRouterClient.ts` now contains only the provider.
	- Refactored `WeaveContextToolRuntime.execute()` from monolithic switch to a tool handler registry.
	- Fixed misleading JSDoc in `weaveTraceCompactor.ts` (was claiming SHA256, actually using DJB2).

## Stage Boundary

- Stage 5 does not execute writes to markdown notes, rename or move folders, delete files or directories, or immediately commit any Weaver output
- Crashpad remains Weaver's source context and selection surface, not a target mutation surface
- Stage 5 proposals must be representable in a future accept/reject diff UX
- Final diff rendering and apply or reject controls belong to Stage 6
- Card scheduling and review remain out of scope until Stage 7
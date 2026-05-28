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
- A split right sidebar that can host both context/properties and LLM interaction, with each subpanel independently closable and reopenable
- Agentic context packaging that gives Weaver the active crashpad state, focused card, user guidance, compact vault summaries, and on-demand note-read access


## Delivery Sequence

Stage 5 is being delivered in parts so the non-destructive contract lands before any live provider dependency.

- Part 1: shared Weaver contracts, IPC/preload bridge, safety validation, a split right-panel proposal surface, and a deterministic stub provider that mirrors guided insert and intelligent restructuring semantics
- Part 2: live OpenRouter-backed plan generation using read-only vault exploration tools and condensed retrieval contexts
- Part 3: additional hardening, richer error UX, and focused Stage 5 regression coverage

During Part 1, proposal generation may be stub-backed, but the staged output must still use the same Stage 5 contracts mapping to valid vault note or directory edits.

## Stage Boundary

- Stage 5 does not execute writes to markdown notes, rename or move folders, delete files or directories, or immediately commit any Weaver output
- Crashpad remains Weaver's source context and selection surface, not a target mutation surface
- Stage 5 proposals must be representable in a future accept/reject diff UX
- Final diff rendering and apply or reject controls belong to Stage 6
- Card scheduling and review remain out of scope until Stage 7
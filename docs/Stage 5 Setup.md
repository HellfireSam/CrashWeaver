# Stage 5 Setup

Canonical setup commands:
- docs/01-Development-Setup.md

## Manual Stage 5 Validation Flow

Part 1: stub-backed read-only scaffolding

1. Launch app with npm run dev.
2. Open a vault and navigate to a crashpad with at least one attached card.
3. Focus a single crashpad card and confirm Weaver uses that focused card as the default planning scope.
4. Open the right panel, confirm it shows separate upper and lower subpanels, and use the top-bar widgets to hide and re-open each subpanel.
5. Confirm that closing either subpanel lets the remaining subpanel fill the full height of the right panel.
6. In the lower LLM subpanel, confirm provider health reports the stub-backed Stage 5 provider.
7. Enter an insertion intent and generate a proposal with guided insert in its default state.
8. Confirm the default guided insert proposal stages only vault-note insertion work into related existing markdown notes. It must not stage crashpad mutations.
9. Enable the optional `edit-content` permission and confirm the next proposal may edit surrounding note prose near the inserted card boundaries.
10. Enable the optional `create-note` permission and confirm the next proposal may stage a new markdown note in an appropriate vault location, with meaningful note content plus the embedded card.
11. Switch to intelligent Weaver mode and cycle through light, standard, and go ham strengths.
12. Confirm intelligent mode may stage broader note and directory proposals, including create, edit, move, rename, and delete operations, while still remaining non-destructive in Stage 5.
13. Confirm light proposals stay narrower than go ham proposals when reasoning about vault restructuring around the focused card.
14. Regenerate or close the lower panel and verify no markdown notes, folders, crashpad files, or card JSON files are immediately modified.
15. Reopen the affected vault content and confirm the filesystem still entirely matches its pre-Weaver state, proving the Stage 5 proposal contract caught all planned changes without executing live edits.

Part 2 and later: live provider validation

1. Re-run the Part 1 checks after enabling the live provider.
2. Verify health-check behavior with and without the required provider configuration.
3. Confirm the live provider starts from compact vault context and only performs bounded read-only retrieval before finalizing the proposal. It may inspect ranked candidate notes, bounded note excerpts or full-note reads, and compact directory summaries, but it must not perform any write-capable action in Stage 5.
4. Change the explicit model picker selection, reopen the Weaver panel or restart the app, and confirm the selected model persists as the preferred model.
5. Confirm the generated proposal still uses the same staged contract, including guided insert permissions and intelligent restructuring semantics, and remains non-destructive before Stage 6 exists.

## OpenRouter Interaction Logs

Weaver now records per-session OpenRouter interaction logs as JSONL when running the live provider path.

Default log directory:
- `<vaultRoot>/.crashweaver/weaver-request-logs`

What each session log includes:
- session start metadata (request summary)
- resolved budget and model details
- raw OpenRouter chat request bodies (without API key headers)
- raw OpenRouter chat responses
- model tool actions
- local tool execution results
- final accepted plan summary or terminal error category

Configure a custom log directory through the main-process bridge:
- `window.crashWeaver.getWeaverRequestLogsDirectory()`
- `window.crashWeaver.setWeaverRequestLogsDirectory(directoryPathOrNull)`
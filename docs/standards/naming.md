# Naming

Names are how the code and the domain stay the same language. The domain vocabulary is
[`CONTEXT.md`](../../CONTEXT.md); this standard says how that vocabulary becomes identifiers.

## Use the glossary's words

Every domain concept has one name, defined in [`CONTEXT.md`](../../CONTEXT.md): Crash Card (short
form "card"), Note, Vault, Card store, UID, UID boundary, Reference, Orphaned card, Crashpad,
Weaver, weave, Weave plan, Weave operation, Approval gate, Guided insert, Intelligent weave, Weave
strength, Memory tricks, Familiarity, Next review, Diagnostic.

Use those words — in identifiers, tests, comments, commit messages and documentation. Do not
introduce a synonym, however natural it sounds: "flashcard", "learning item", "study unit" and
"run" are not the project's words for a card or a weave. If a concept has no glossary term yet,
that is a gap to resolve before naming code after it, not permission to invent vocabulary.

## The Weaver/weave rule

This is the naming rule the glossary implies, stated mechanically:

- **`Weaver` / `weaver` names the agent as a thing.** Its identity, configuration, sessions,
  retrieval, providers, and the UI that represents it. Write `Weaver` in prose and at the start of
  a type or component name, and `weaver` inside identifiers and in module file names. Examples:
  `WeaverSettings`, `WeaverSessionSummary`, `WeaverProposalPanel`, `weaverSessionHistory`,
  `weaverEmbeddingService`, `src/state/WeaverContext.tsx`.
- **`weave` / `Weave` names one run of the action and its artifacts.** One run of the Weaver, the
  plan it produces, the operations in that plan, the graph that reasons about it, the trace, the
  apply step, the request logs of that run. Write `Weave` at the start of a type name and `weave`
  inside identifiers and file names. Examples: `weave`, `WeavePlan`, `WeavePlanOperation`,
  `weaveGraph`, `weavePlanSchema`, `weaveApplyService`, `weaveTraceCompactor`.

Before naming anything that contains "weave" or "weaver", answer one question: **is this the
agent, or one run and its artifacts?** Agent → `weaver`; run → `weave`. There is no third case.
A name that mixes them is wrong even when it reads well: `weaveSessions` holds Weaver session
summaries, so it belongs to the agent; `WeaveProviderName` names provider infrastructure, so it
belongs to the agent.

### IPC channel names

Channel names are `<area>:<name>`, lower-case and kebab-cased inside each part:

- **Request/response channels** are `<area>:<imperative-verb>`, for example `vault:read-note`,
  `card-store:save-card`, `weave:generate-plan`. The verb is what the main process does.
- **Push/event channels** are `<area>:<event>`, for example `weave:plan-progress`,
  `vault:external-change`. The name is the event, not an instruction.
- The area follows the same rule as everything else: **agent concerns use `weaver:`**, and
  `weave:` is for operations on a run. A settings, key or session channel is an agent concern
  even though it is reached while using the Weaver.

Known violations of the rule are tracked, not silently tolerated:

| Violation                                                                                                                                 | Ticket   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `weave:get-settings`, `weave:update-settings`, `weave:set-api-key`, `weave:list-sessions` (and the other agent-concern `weave:` channels) | #20, #21 |
| `weaveSessions` renderer state in `WeaverContext`                                                                                         | #19      |
| Provider types named with the action prefix (`WeaveProviderName`, `WeaveModelProvider`)                                                   | #19      |

## Code conventions

These are the conventions the code already follows; match them in new code.

| Kind                                    | Convention                     | Examples                                                                 |
| --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| Types, interfaces, React components     | `PascalCase`                   | `CardDocument`, `WeavePlanOperation`, `WeaverProposalPanel`              |
| Functions, variables, parameters, props | `camelCase`                    | `removeCardBoundaryLines`, `rootPath`, `cardStorePath`                   |
| React hooks                             | `use` + `PascalCase`           | `useEditorTabs`, `useCrashpadActions`, `usePaneLayout`                   |
| Shared constant values                  | `SCREAMING_SNAKE_CASE`         | `MAX_TOTAL_STEPS`, `MIN_REMAINING_TIME_MS`, `EMBEDDING_SIMILARITY_BOOST` |
| Module-scoped state and derived values  | `camelCase`                    | `isDev`, `pendingChangedPaths`                                           |
| Component files                         | `PascalCase.tsx`               | `InspectorPane.tsx`, `WeaverDiffPreview.tsx`                             |
| Hook files                              | `usePascalCase.ts`             | `useEditorTabs.ts`, `useVaultLoadActions.ts`                             |
| Other modules                           | `camelCase.ts`                 | `vaultService.ts`, `cardParser.ts`, `weavePlanSchema.ts`                 |
| Test files                              | `<module>.test.ts`             | `vaultService.test.ts`, `markdownPreview.test.ts`                        |
| Test-only exports                       | `__` prefix, `ForTests` suffix | `__setSettingsFilePathForTests`, `__resetWeaveProviderForTests`          |

The remaining `tests/electron/*.test.cjs` suites keep their current names until ticket #11 ports
them into the TypeScript layer; the row above is the convention new tests follow.

More rules, in the same spirit:

- **Booleans read as a question.** `isDev`, `isGeneratingWeavePlan`, `hasCardStore`, `shouldWarn`,
  `canApply` — or the name of the option when it is an option, not a state: `dryRun`,
  `removeNoteBoundaries`.
- **Abbreviations are the common ones only.** `uid`, `ipc`, `fs`, `url`, `dir` and `logsDir` are
  readable in context; do not invent a new shortening for a word the existing code spells out
  (`service`, `parser`, `settings`, `document`).
- **Persisted shapes keep their on-disk names.** `electron/vault-contract.ts` mirrors the card JSON
  exactly, so its fields are `snake_case` (`raw_content`, `memory_tricks`, `referenced_in`,
  `next_review`, `note_path`). Renderer-local presentation types can translate to `camelCase`
  (`CardViewRecord.rawContent`); do not rename a contract field to make it prettier.
- **Error messages read as sentences.** Start with the problem and include the offending value
  after a colon when it helps; where the value ends the message, there is no trailing full stop
  (`Vault path does not exist: ${rootPath}`), and a message that ends with prose gets one
  (`Card title / ID is required.`).
- **Paths that identify a note are vault-relative POSIX strings** (`web/http.md`). Absolute paths
  appear only as machine-local runtime values the main process returns (a `VaultDescriptor.rootPath`,
  a configured card-store directory); do not add an absolute path to note references or card JSON.

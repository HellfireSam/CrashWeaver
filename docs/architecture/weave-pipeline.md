# The weave pipeline

One **weave** is one run of the **Weaver** and ends in exactly one **weave plan**. This pipeline turns a renderer request into that plan through ordered stages: entry, context retrieval, model
resolution, planning, prompting, validation, observability, the **approval gate**, and apply. Each stage is a module under `electron/weaver/`, and the plan crosses the process boundary as plain
JSON defined in `electron/vault-contract.ts`. Vocabulary is fixed by the [domain glossary](../../CONTEXT.md): **Weaver**, **weave**, **weave plan**, **weave operation**, **approval gate**,
**guided insert**, **intelligent weave**, **weave strength**.

Two properties shape the design. Planning is read-only, so the plan comes from a bounded ReAct loop whose tools can only read notes. And nothing in the vault changes until the user accepts
operations at the approval gate, so apply is a separate module that planning never invokes.

## Entry: what starts a weave

A weave starts in the renderer. `InspectorPane` hosts `WeaverProposalPanel`, which owns the composer controls; its callbacks reach `handleGenerateWeavePlan` in `App.tsx`, which builds the request
and calls `window.crashWeaver.generateWeavePlan(...)`.

**Request shape.** Every `WeavePlanRequest` requires `rootPath`, `kind`, `intent`, `cardUid`, `activeCrashpadId`, and `activeCrashpadPath`, and accepts optional `preferredModel`,
`activeNotePath`, `selectedText`, and `maxOperations`. `GuidedInsertWeavePlanRequest` adds `permissions: GuidedInsertPermissions`; `IntelligentWeavePlanRequest` adds `strength: WeaveStrength`,
and the plan shapes echo them.
The active Crashpad is source context only — plans target vault notes and directories.

**Guided insert versus intelligent weave.** Guided insert adds one specific card to a note, targeting existing notes plus, when permitted, one new note. `getAllowedOperationKinds` in
`weavePlanSchema.ts` gives it `insert-boundary-pair` always, `edit-note-content` only with `permissions.editContent`, and `create-note` only with `permissions.createNote` — the two toggles the
panel exposes. Intelligent weave restructures notes and folders: the same function returns all ten operation kinds, and the panel exposes **weave strength** instead.

**Weave strength.** `light | standard | go-ham`. `resolveBudget` (`weaveModelProfiles.ts`) and `resolveRetrievalBudget` (`weaveContextService.ts`) turn it into token, timeout, iteration, and
retrieval budgets; `resolveDefaultMaxOperations` into an operation cap; `getStrengthDescription` into autonomy guidance. It never changes routing: `resolveModel` reads only
`request.preferredModel` and the persisted preference.

**Permissions and insertion intent.** The optional permissions also widen retrieval: `resolveRetrievalBudget` treats `editContent || createNote` as "expanded", and prompt layer 7 prints each as
`ALLOWED` or `FORBIDDEN` with a constraint line. Intent is carried by `intent` plus `selectedText` and `activeNotePath`: intent feeds token extraction and the embedding query, while `selectedText`
drives `after-selection` / `replace-selection` placements and the excerpt window in `WeaveContextToolRuntime.readNoteSlice`; `App.tsx` reads it from the editor textarea.

**IPC path.**

| Step           | Location                     | Symbol                                                                             |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| Renderer call  | `src/App.tsx`                | `handleGenerateWeavePlan` → `window.crashWeaver.generateWeavePlan`                 |
| Preload bridge | `electron/preload.ts`        | `generateWeavePlan` → `invoke('weave:generate-plan', request)`                     |
| Main handler   | `electron/main.ts`           | `ipcMain.handle('weave:generate-plan')` → `generateWeavePlan(request, onProgress)` |
| Progress push  | `electron/main.ts` → preload | `event.sender.send('weave:plan-progress', …)` → `onWeavePlanProgress`              |
| Apply call     | `src/App.tsx`                | `handleApplyWeaveOperations` → `applyWeavePlan`                                    |

`weaveService.generateWeavePlan` is the service layer: read settings, `validateWeavePlanRequest`, `assertVaultRoot`, resolve the request-log directory, attach embedding options when an OpenRouter
key exists, `buildWeaveContextSnapshot`, delegate to the active provider's `generatePlan`, then validate the result. Provider selection happens once in `initializeWeaveProvider`:
`OpenRouterWeaveProvider` with a key, otherwise `StubWeaveProvider`; `isStubProviderActive` drives the panel's demo badge.

## Context retrieval

`weaveContextService.ts` builds the `WeaveContextSnapshot` that is both prompted into the model and handed to the tool runtime.

**Snapshot builder.** `buildWeaveContextSnapshot(request, options)` reads the focused card via `getVaultCardStore` + `readCardDocument` (throwing when it is missing), reads the stored index via
`readVaultIndex` from `.crashweaver/index.json` with a legacy root `index.json` fallback, and builds the note catalog with `buildInitialNoteCatalog`, merging indexed notes with supplemental
entries for the active note and every note the card references (`buildFallbackNoteSummary` fills gaps). It then produces `candidateNotes` and `directorySummaries`, trims excerpts, and attaches the
runtime-only `_allNotes`, `_searchTokens`, and `_anchorPaths`. An empty index adds a warning instead of failing. Excerpt sizes come from `CARD_RAW_CONTENT_EXCERPT_CHARS` (600),
`SELECTED_TEXT_EXCERPT_CHARS` (600), `REFERENCE_EXCERPT_PADDING_LINES` (4), and the budget; `trimExcerpt` marks truncation. The snapshot's `warnings` reach the model in prompt layer 8, so a
thin-context weave is told to plan conservatively.

**Candidate scoring (keyword + embedding hybrid).** `extractNoteSearchTokens` collects at most 24 lowercase tokens of length ≥3 from intent, card type, card content, memory technique, and Q&A
pairs, dropping `STOP_WORDS`. `scoreCandidateNote` then scores each catalog note:

| Signal                                                           | Points                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Card already references the note                                 | +220                                                                                   |
| Note is the active note                                          | +150                                                                                   |
| Title / tag / path keyword match                                 | +20 / +15 / +8 each                                                                    |
| Path proximity                                                   | 10 per shared leading directory segment, +18 when the parent directory matches exactly |
| Embedding cosine similarity × `EMBEDDING_SIMILARITY_BOOST` (180) | up to +180                                                                             |

`getCandidateReasonFragments` produces the reason strings shown in the prompt and live feed: existing reference, active note, semantic match at ≥0.3, keyword overlaps. Zero-score notes are
dropped; the rest sort by score with a path tiebreak and slice to `maxCandidateNotes`. `buildDirectorySummaries` aggregates the candidate set per directory (note count, candidate count, summed
score, up to three samples, reasons for containing references, the active directory, or top candidates), keeping only directories with candidates.

**Retrieval budgets.** `resolveRetrievalBudget` returns one of three shapes, quoted as candidate notes / directory summaries / note reads / excerpt chars / full-note chars / retrieved chars:
guided insert without optional permission `8 / 6 / 1 / 1200 / 3200 / 3600`; guided insert expanded `12 / 8 / 2 / 1500 / 5000 / 7000`; intelligent weave by strength — light `10 / 8 / 2 / 1400 /
4200 / 7000`, standard `14 / 10 / 4 / 1800 / 6000 / 12000`, go-ham `18 / 12 / 6 / 2200 / 8000 / 18000`. With `settings.disableBudgetRestrictions` it returns deliberately generous values (`60 / 40
/ 30 / 10000 / 50000 / 200000`).

**Read-only tool runtime and registry.** `createWeaveContextToolRuntime` builds a `WeaveContextToolRuntime` holding `candidateLookup`, `referenceLookup`, a merged `retrievalBudget`, and a
`toolHandlers` registry mapping tool names to bound private methods:

| Tool                     | Handler                                            | Behaviour                                                                           |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `list_candidate_notes`   | `toolListCandidateNotes`                           | Ranked candidates, optional directory filter and limit                              |
| `list_directory_summary` | `toolListDirectorySummary`                         | Directory summaries, capped by budget                                               |
| `search_notes`           | `toolSearchNotes`                                  | Substring search over path/title/tags; requires a query                             |
| `read_note_excerpt`      | `toolReadNoteExcerpt` → `readNoteSlice('excerpt')` | Reference window (±4 lines), else a window around the selection, else the note head |
| `read_note_full`         | `toolReadNoteFull` → `readNoteSlice('full')`       | Whole note, capped by `maxFullNoteChars`                                            |
| `read_note_span`         | `toolReadNoteSpan`                                 | Anchor-to-anchor span via `findNoteSpan`, with line numbers                         |
| `refresh_candidates`     | `toolRefreshCandidates`                            | Registered only with refresh params; expands the candidate set once                 |

`execute(toolName, args)` is the dispatcher: unknown names return an `unsupported-tool` error, and `classifyToolError` converts every thrown validation error into a structured
`WeaveToolErrorResult` carrying one of the diagnostic codes declared on `WeaveReActStep['diagnostics']` (`budget-note-reads-exhausted`, `budget-chars-exhausted`, `note-outside-candidates`,
`invalid-arguments`, `unsupported-tool`, `runtime-error`). `WeaveToolRuntimeUsage` reports reads and characters used and remaining in every result. Three guards bound the loop:
`assertNoteReadBudget` refuses reads past `maxNoteReads`; `resolveRequestedChars` refuses reads once `maxRetrievedChars` is spent and otherwise caps the request at what remains; and
`readNoteSlice` refuses any path absent from `candidateLookup`, keeping the model inside the ranked set unless it calls `refresh_candidates`, which re-scores the full catalog, excludes
already-offered notes, merges the new candidates into `candidateLookup`, and refuses a second call (`maxRefreshes = 1`).

**Embedding service and cache.** `weaverEmbeddingService.ts` adds semantic ranking through OpenRouter's embeddings endpoint with `openai/text-embedding-3-small` (1536 dimensions), a 15-second
abort timeout, and best-effort failures. `buildQueryEmbedding` composes intent, card type, and up to 500 characters of card content. `getOrComputeNoteEmbedding` returns a cached vector when
`contentHash` matches and the dimension is right, otherwise computes one and writes the cache asynchronously (`hashContent` hashes title plus the first 2000 characters). `cosineSimilarity` clamps
negatives to zero; `buildSimilarityMap` keeps notes at or above `MIN_SIMILARITY_THRESHOLD` (0.15) and counts boosts. The cache is `.crashweaver/embeddings.json`, loaded and saved by
`loadEmbeddingCache` / `saveEmbeddingCache` and discarded when `version` or `model` mismatches. `generateWeavePlan` enables enrichment only with an API key; per-note failures are skipped and any
error falls back to keyword-only ranking with a warning. One precision point: the first round passes `note.tags.join(' ') || note.title` as the note's content, so initial vectors are a
title-and-tags proxy; no code path refreshes them with full prose, despite a source comment anticipating that.

## Model layer

**Model profiles.** `weaveModelProfiles.ts` owns model resolution and the rest of model-driven execution policy. `DEFAULT_MODEL_BY_UI_TIER` maps `cw-fast` → `openai/gpt-4o-mini`, `cw-balanced` →
`openai/gpt-4o`, `cw-deep` → `anthropic/claude-sonnet-4-5`; `resolveModel` prefers the request model, then the persisted preference, then the balanced default, treating a value containing `/` as
an ID and anything else as a tier. `resolveStructuredOutputMode` inspects the provider prefix: members of `JSON_MODE_PROVIDERS` (`openai`, `google`, `deepseek`, `x-ai`) get `json_mode`, everything else
gets `fences_and_braces`; `resolveResponseFormatParams` turns `json_mode` into `responseFormatParams` `{ response_format: { type: 'json_object' } }`, which `resolveFullModelProfile` assigns.
`resolveSystemPromptOverlay` returns a `<thinking>`-tolerant JSON-only instruction
for `anthropic`, a bare-JSON instruction for JSON-mode providers, and a conservative fallback; `buildModelOverlayLayer` appends it as prompt layer 6. `resolveRepairStrategy` returns `conservative`
for Anthropic and `aggressive` otherwise. `resolveFullModelProfile(modelId, request, settings)` combines all of it with `resolveBudget`.

| Request                      | Max tokens | Timeout | Temperature               | Iteration limit |
| ---------------------------- | ---------- | ------- | ------------------------- | --------------- |
| Guided insert, base          | 1400       | 30 s    | 0.1                       | 3               |
| Guided insert, expanded      | 2200       | 45 s    | 0.2                       | 4               |
| Intelligent light            | 1500       | 30 s    | 0.18                      | 2               |
| Intelligent standard         | 3000       | 60 s    | 0.3                       | 4               |
| Intelligent go-ham           | 6000       | 120 s   | 0.5                       | 6               |
| Budget restrictions disabled | 32000      | 600 s   | 0.15–0.5 by kind/strength | 200             |

`BUDGET_VALIDATION_BOUNDS` fixes the accepted ranges (tokens 100–32000, timeouts 5–600 s, iterations 1–20) and `validateAndClampBudgetValue` clamps out-of-range settings with a warning rather than
failing the weave; `settingsService.ts` re-bounds the same fields through `WEAVER_BUDGET_FIELD_REGISTRY`.

**OpenRouter provider.** `OpenRouterWeaveProvider.generatePlan(request, context, options)` resolves model and settings, resolves the profile, creates the tool runtime, creates a session logger
when a log directory was supplied (logging `budget-resolved` with profile, budget, and context sizes), instantiates `OpenRouterHttpClient`, and returns `runWeaveGraph(...)` — it owns no loop
logic. `healthCheck` probes `/models` with a 10-second race and maps 401/403, 402, other non-OK statuses, and network failure onto `WeaveProviderHealth` with a matching `WeaveErrorCategory`.
`listModels` fetches `/models` with a 15-second race, derives `costLabel` and `isFree`, sorts free models first, and caches for 30 minutes (`MODEL_LIST_CACHE_TTL_MS`); `clearModelListCache` runs
on key changes.

**Stub provider.** `StubWeaveProvider.generatePlan` ignores the snapshot and builds a fixed operation list from the request: guided insert gets an insert plus, when allowed, an edit and a
create-note; intelligent weave gets progressively more restructuring for `standard` and `go-ham`. It slices to `request.maxOperations`, sets `provider: 'stub'`, synthesises a short trace, and
returns zero usage. `listModels` returns a curated list so the picker works without a key.

**Transport.** `OpenRouterHttpClient.chatCompletion` in `weaveHttpClient.ts` builds the body (`model`, `messages`, `max_tokens`, `temperature`, plus `responseFormatParams`), logs it, and runs a
retry loop of `DEFAULT_MAX_RETRIES` (2, so three attempts), each attempt receiving the remaining wall-clock budget; a spent budget fails as `provider-timeout`. `_sendRequest` arms an
`AbortController` for that remainder and posts to `/chat/completions` through Electron's `net.fetch`; aborts become `provider-timeout` and network errors `provider-error`. `categorizeHttpError`
maps 401/403 to `auth-error`, 402 to `provider-error` with a credits message, 429 to `rate-limit`, 5xx to `provider-error`, and other statuses to `provider-error` with any OpenRouter message
attached. The response is parsed for `choices[0].message.content`; empty or unparseable responses are errors. Only `rate-limit` and `provider-error` are retried, with `backoffDelayMs` = `min(8000,
800 × 2^attempt) × random()`.

## Planning

**State model.** `weaveGraphState.ts` declares `WeaveMessage` (`role` + `content`), `WeaveGraphStep` (`callModel`, `executeTool`, `repair`, `finalize`, `validate`, `fail`, `done`),
`WeaveAgentRoute` (`execute-tool`, `finalize`, `repair-syntactic`, `repair-semantic`, `repair-schema`, `repair-exhaustion`, `fail`), and `WeaveAgentState`: immutable inputs, the message list,
`toolCallCount` and `repairAttemptCount`, the inter-node `pending*` fields, `accumulatedUsage`, `trace`, and the terminal `result` / `errorMessage` / `errorCategory`. It also exports the message
helpers, `WeaveProgressEvent` / `WeaveProgressCallback`, `MIN_REMAINING_TIME_MS` (10 s), and `MAX_TOTAL_STEPS` (24).

**Transition table.** `resolveNextStep(current, state)` in `weaveGraph.ts` is a pure, exhaustive function over the current step and `state.pendingRoute`:

| From          | Condition                                                    | To            |
| ------------- | ------------------------------------------------------------ | ------------- |
| `callModel`   | `execute-tool`                                               | `executeTool` |
| `callModel`   | `finalize`                                                   | `finalize`    |
| `callModel`   | `repair-syntactic` / `repair-semantic` / `repair-exhaustion` | `repair`      |
| `callModel`   | any other route                                              | `fail`        |
| `executeTool` | always                                                       | `callModel`   |
| `repair`      | always                                                       | `callModel`   |
| `finalize`    | always                                                       | `validate`    |
| `validate`    | result set, no route, no error                               | `done`        |
| `validate`    | `repair-schema`                                              | `repair`      |
| `validate`    | anything else                                                | `fail`        |
| `fail`        | terminal                                                     | `done`        |

`runWeaveGraph` seeds messages with `systemMsg(buildSystemPrompt(...))` and `userMsg(buildInitialUserTurn(...))`, instantiates the six node factories with injected dependencies, logs and emits
`graph-start`, and runs the switch until `done`.

**Iteration and budget guards.** `resolveWeaveEffectiveBudget` computes `promptToolCalls = min(profile.iterationLimit, max(1, snapshot.retrievalBudget.maxNoteReads))` and passes through
`maxNoteReads` and `maxRetrievedChars`. The note-read and character budgets advertised in the system prompt are the ones enforced exactly at runtime; the advertised tool-call budget is
`min(iterationLimit, maxNoteReads)`, while the enforced ceiling is `iterationLimit`. Three guards stop the loop: a step cap (`stepCount` above
`effectiveMaxSteps`, which is `MAX_TOTAL_STEPS` or 200 with `disableBudgetRestrictions`, forces a `provider-error`); the tool budget (`toolCallCount` against `iterationLimit`, routing to
`repair-exhaustion` when a repair is affordable, else failing); and the time budget (a failed remaining-time check yields `provider-timeout`, and repairs run only while more than
`MIN_REMAINING_TIME_MS` remains). `updateState` concatenates messages and trace entries and merges usage through `mergeUsage`, which sums token fields independently and preserves the previous
value when a node reports no usage.

**Node behaviour.** `weaveGraphNodes.ts` exports one factory per step.

- `makeCallModelNode` — checks request/profile and time, then calls `httpClient.chatCompletion`. `extractJsonFromText` parses bare, fenced, or brace-delimited JSON, and `parseActionFromJson`
  recognises `{ type: 'tool', toolName, arguments }` or `{ type: 'final', plan }`. Outcomes are `execute-tool`, `finalize`, `repair-syntactic` (unparseable but braces present), `repair-semantic`
  (valid JSON, wrong envelope), `repair-exhaustion` (over-budget tool request), or `fail` with `schema-error` / `provider-error`; it records usage and appends a trace entry when routing into a
  repair.
- `makeExecuteToolNode` — dispatches through `toolRuntime.execute`, builds the observation with `buildObservationMessage`, increments `toolCallCount`, clears pending tool fields, and
  appends a trace entry whose observation is truncated at 800 characters.
- `makeRepairNode` — selects `buildSyntacticRepairMessage`, `buildSemanticRepairMessage`,
  `buildSchemaRepairMessage(errorMessage)`, or `buildExhaustionRepairMessage` by route, appends it as a user message, increments `repairAttemptCount`, and clears route and error.
- `makeFinalizeNode` — wraps `pendingPlanData` in a `WeavePlanResult` shell with model, `provider: 'openrouter'`, accumulated usage, and elapsed latency; the plan is deliberately not validated here.
- `makeValidateNode` — runs `validateWeavePlanResult`; on success it logs `node-validate-success` and `plan-final` (the full plan session history later reads), appends the closing trace step, and
  clears the route; on failure it routes to `repair-schema` when a repair and time remain, else fails with `schema-error`.
- `makeFailNode` — emits `graph-fail`, logs `node-fail`, and seals
  `errorMessage` / `errorCategory` for the runner to throw.

**Repair passes and trace.** `maxRepairs` is 1 for `conservative` and 2 for `aggressive`, and a repair requires `repairAttemptCount < maxRepairs` plus enough remaining time. Syntactic and semantic
repairs are decided in `callModel`, schema repairs in `validate`, exhaustion repairs in `callModel`; all funnel through the single `repair` step. The trace accumulates in `state.trace`: one entry
per tool call (thought, action, truncated observation, tool diagnostics), one per repair-entering model turn, and a closing entry in `validate` naming the operation count. `runWeaveGraph` logs
`graph-complete` with success, operations, usage, latency, tool-call count, repair count, and total steps, then returns the result or throws a typed error built by `makeWeaveError`. Error
categories come from `WeaveErrorCategory` (`config-error`, `auth-error`, `rate-limit`, `provider-timeout`, `provider-error`, `schema-error`); `safety-error` is declared but no path in this
pipeline raises it, because path safety is enforced by ordinary throws from `normalizeVaultRelativePath` and `assertWithinVault`.

## Prompts

`weavePlanPrompts.ts` composes the prompt from independently replaceable layers. `buildSystemPrompt(profile, requestKind, maxToolCalls, maxNoteReads, maxRetrievedChars, unrestricted)` joins the
static and dynamic layers; `buildInitialUserTurn` joins the request specification with the context snapshot. The table below mirrors the named layer exports of that module — and, for layer 3, the
`WeavePlanOperationKind` union in `electron/vault-contract.ts` — which remain authoritative.

| Layer                | Export                                                                                                                  | Contribution                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Task contract      | `TASK_CONTRACT_LAYER`                                                                                                   | Weaver's role: propose a reviewable, non-destructive plan, never execute; cards versus boundary markers                                                                           |
| 2 Safety policy      | `SAFETY_POLICY_LAYER`                                                                                                   | Absolute constraints: proposal only, Crashpad never mutated, vault-relative paths, exact focused UID, permission-limited operations, minimal deletes, raw JSON only               |
| 3 Operation schema   | `OPERATION_SCHEMA_LAYER` / `GUIDED_INSERT_OPERATION_SCHEMA_LAYER`                                                       | Ten operation kinds with payload shapes, or the three guided-insert kinds; invariants (`targetPath` equals `toPath` for renames and moves, boundary rules) and canonical examples |
| 4 Output format      | `OUTPUT_FORMAT_LAYER`                                                                                                   | The exact plan JSON: kind, permissions or strength, summary, operations, warnings, referencedCards                                                                                |
| 5 Tool loop protocol | `buildToolLoopLayer`                                                                                                    | ReAct envelope, tool catalogue, read-only rules, numeric tool/read/character budgets, finalisation guidance; a separate no-limits variant for unrestricted budgets                |
| 6 Model overlay      | `buildModelOverlayLayer`                                                                                                | Provider-family instructions from the profile, omitted when empty                                                                                                                 |
| 7 Request spec       | `buildRequestSpecification`                                                                                             | Kind, focused UID, operation cap, permissions or strength description, intent, Crashpad path as source-only, active note, trimmed selection                                       |
| 8 Context snapshot   | `buildContextLayer`                                                                                                     | Focused card, retrieval budget, ranked candidates with scores and reasons, directory summaries, retrieval warnings                                                                |
| 9 Observation        | `buildObservationMessage`                                                                                               | Per tool result: status, structured result or error, remaining calls, or an explicit finalise instruction                                                                         |
| 10 Repair messages   | `buildSyntacticRepairMessage`, `buildSemanticRepairMessage`, `buildSchemaRepairMessage`, `buildExhaustionRepairMessage` | One targeted correction per failure mode                                                                                                                                          |

The static layers are the shared contract; the dynamic layers are the only place request-specific facts enter the prompt, and the budget numbers printed there come from the same
`WeaveEffectiveBudget` the runtime enforces. The guided-insert variant of layer 3 keeps the model from seeing kinds validation would reject.

## Validation

**Request validation.** `validateWeavePlanRequest(request, settings)` requires a root path and a known kind, normalises the card UID, and clamps the operation cap: `resolveDefaultMaxOperations`
supplies the per-kind default (guided insert 8; light 6, standard 10, go-ham 16; each overridable by settings), the request value is truncated and floored at 1, and the result is capped at
`MAX_ALLOWED_OPERATIONS` (20) or `UNRESTRICTED_MAX_OPERATIONS` (100) with restrictions disabled. `activeNotePath` is normalised as a note path and `activeCrashpadPath` as a vault path, and both
`activeCrashpadId` and `activeCrashpadPath` are required. Guided insert needs two boolean permissions; intelligent weave needs a known strength. `normalizeVaultRelativePath(rootPath, targetPath, {
noteOnly, directoryOnly })` is the shared path gate: it resolves against the root, rejects empty, escaping, or absolute results, converts to posix, and enforces the `.md` / non-`.md` rule; every
`targetPath`, `fromPath`, and `toPath` passes through it.

**Result validation.** `validateWeavePlanResult(result, request, settings)` checks the envelope (model present, provider `stub` or `openrouter`, non-negative latency), then `validatePlan`: the
plan `kind` must match the request, the summary must be non-empty, there must be at least one and no more than `request.maxOperations ?? resolveDefaultMaxOperations(...)` operations, `warnings`
and `referencedCards` are de-duplicated, `referencedCards` must include the focused UID, and the plan must echo the request's permissions or strength exactly. `validateOperation` rejects unknown
kinds and kinds the request may not emit, and requires a non-empty rationale, target path, and payload. Payload rules with product meaning: `insert-boundary-pair` requires `cardUid` equal to the
focused card, a valid placement, `headingText` for heading placements, `selectedText` for `after-selection`, and — via `assertBoundaryBlockIncludesCard` — the exact `%%CW_CARD_START uid:<uid>%%`
and `%%CW_CARD_END uid:<uid>%%` markers; `create-note` requires the focused `cardUid` and, via `assertCreateNoteHasSubstantiveContent`, a trimmed length of at least 20 characters (leading and
trailing whitespace is trimmed, internal whitespace counts; markers inside the content are optional and no longer injected); rename and move kinds require `targetPath` to equal `payload.toPath`
with valid source and destination paths of the right flavour; delete and create-directory payloads need a non-empty reason or purpose.

**What happens on invalid model output.** Nothing reaches the vault. Inside the loop a failure throws in `makeValidateNode`, which routes it to schema repair with the validator's message when a
repair and time remain, or terminates with `schema-error`. `generateWeavePlan` then calls `validateWeavePlanResult` again over whatever the provider returned, so a result that bypassed the graph
is held to the same contract. That throw becomes an IPC rejection, and `handleGenerateWeavePlan` strips Electron's `Error invoking remote method` wrapper before showing the message.

## Observability

**Request logging.** `weaveRequestLogger.ts` writes one JSONL file per weave. `createWeaveRequestSessionLogger` builds a `WeaveRequestSessionLogger` (UUID session id, file `<sanitised ISO
start>-<sessionId>.jsonl`) and writes `session-start` with the request subset (kind, root path, card UID, intent, preferred model, active note, Crashpad id and path). Each `log(event, payload)`
appends `{ ts, sessionId, event, payload }`, and `sanitizePayload` truncates strings above 10 000 characters recursively. The directory is the configured Weaver request-log directory when set,
otherwise `<vault>/.crashweaver/weaver-request-logs`, resolved in `generateWeavePlan` and mirrored by `resolveSessionLogsDirectory` for history reads. The events are the string literals passed to
`logger.log` at the call sites that emit them: the session lifecycle and node events in `weaveGraph.ts` and `weaveGraphNodes.ts`, the profile event in `openRouterClient.ts`, and the
`openrouter-*` transport events in `weaveHttpClient.ts`, alongside the logger's own `session-start`. Those call sites are authoritative, so this document does not mirror the list. Redaction
happens at the transport boundary: `redactSensitiveLoggingData` in `weaveHttpClient.ts` replaces transport message bodies with `[REDACTED: <n> chars, hash:<digest>]` and truncates long response
strings, and full payloads are written only with `CRASHWEAVER_WEAVER_DEBUG_LOG_FULL=1` (each entry then carrying `safeLoggingMode: false`). That redaction covers the transport and prompt
payloads; plan payloads and tool arguments are logged verbatim by default — the `plan-final` event persists the whole plan (including `edit-note-content` `targetText` and `insert-boundary-pair`
`boundaryBlock`), and the tool-execution events persist tool arguments.

**Trace compaction.** `weaveTraceCompactor.ts` exports `compactTraceItem` and `WeaveTraceAccumulator`: observations over 400 characters become a truncated summary plus a non-cryptographic
`resultHash`, raw tool results are kept only under a 2000-character cap when explicitly requested, and the accumulator enforces a 1500-character per-item budget with stats. The module has its own
tests but is not called by the planning loop — the graph does its own inline 800-character truncation in `makeExecuteToolNode` — so read it as available plumbing, not an active stage.

**Session history.** `weaverSessionHistory.ts` reads the JSONL back. `listWeaverSessions` scans `*.jsonl`, skips files without `session-start`, builds each `WeaverSessionSummary` from
`session-start` plus the last `graph-complete`, and sorts newest first. `getWeaverSession` returns a `WeaverSessionDetail` with the summary, full request, `budget-resolved` payload, the plan (from
`plan-final`, falling back to `node-validate-success`), and `steps` built by `buildSteps` from the node events. `deleteWeaverSession` unlinks one file; `clearWeaverSessions` unlinks all and
returns the count. `weaveService.ts` wraps these as `listSessions`, `getSession`, `deleteSession`, and `clearSessions` after resolving the log directory, and `electron/main.ts` maps them to the
`weave:list-sessions`, `weave:get-session`, `weave:delete-session`, and `weave:clear-sessions` channels. `App.tsx` fetches the list on vault open and after each completed plan; the history view
can re-run a past session by restoring its request parameters into the composer.

## The approval gate

**The approval gate** is where the user accepts or rejects the plan; nothing is written to the vault before it.

**How the plan reaches the renderer.** `generateWeavePlan` resolves to a `WeavePlanResult` over IPC and `handleGenerateWeavePlan` stores it in `weavePlanResult` (`WeaverContext.tsx`).
`WeaverProposalPanel` renders the summary, operation count, provider and model, the plan `warnings`, the returned `trace` as a collapsed read-only progress feed, one `WeaverOperationItem` per
operation, the apply bar, and — after an apply — the apply-result banner.

**Per-operation diff previews.** `WeaverOperationItem` looks up `WEAVE_OPERATION_META` for the label and icon and renders accept / reject controls when an apply callback was supplied, an "Applied"
badge for operations that already succeeded, and an expandable body. Expanding renders `WeaverDiffPreview`, which switches on the kind to one of ten previews. `insert-boundary-pair` previews the
exact lines to be inserted, using the same "markers already present" check as schema validation to avoid double-wrapping. `edit-note-content` computes an LCS line diff between `payload.targetText`
and `payload.replacementMarkdown` — the plan's strings, not the live note. Path-changing kinds render a `from → to` arrow with the reason; destructive kinds render warnings.

**The unified diff modal.** Clicking an operation's summary opens `WeaverUnifiedDiffModal`. For `insert-boundary-pair` it reads the target note through `window.crashWeaver.readNote`, computes
the post-insert content with `buildNewContent` using its own, independently derived placement rules, and renders a full-file unified diff via `computeFullFileDiff`; if the note cannot be read it
degrades to an insertion-only hunk with a warning. Those rules do not mirror the apply handler's: for `after-heading` the modal inserts at the end of the heading's whole section
(`findSectionEnd`), not immediately under the heading; it matches headings by normalised title equality or substring rather than an anchored regex, resolves `after-selection` by character
offset via `indexOf` rather than by matching line arrays, and silently appends to the end where apply reports a warning. `edit-note-content` renders a full-file diff of target and replacement;
`create-note` renders the prospective file; path changes and deletions get focused views. The modal is a preview only — it writes nothing. Line diffing uses the `diff` package's `diffLines`,
selected by `USE_LIB_DIFF`; a hand-written LCS implementation remains behind that flag. Because the inline preview and the modal use independent diff implementations, a preview is indicative of
the effect, never a guarantee.

**Selection and the destructive confirmation.** Selection lives in three index sets; accept and reject are mutually exclusive per index and both are undoable. **Apply accepted** sends only the
accepted indices and is disabled while the set is empty; **Apply all (except rejected)** sends everything not rejected. Since the array is filtered before sending, the panel records the original
plan indices in `pendingApplyOriginalIndicesRef` and maps per-operation result indices back afterwards. Before applying, `handleApplyWeaveOperations` partitions the selection with
`isDestructiveOperation` from `WeaverConfirmDialog.tsx` — `delete-note`, `delete-directory`, `rename-note`, `rename-directory`, `move-note`, `move-directory`. If any are present and no
confirmation is pending, the operations are stashed and `pendingDestructiveOps` opens `WeaverConfirmDialog`, which lists each destructive operation with kind label and target path, states that
changes cannot be undone automatically, and keeps its confirm button disabled until the acknowledgement checkbox is ticked. Confirming reruns the apply path with the stashed operations; cancelling
discards them. Non-destructive operations need no dialog.

**Why nothing is written before acceptance.** Three code facts enforce the gate. The planning path is read-only: the tool registry has no write tool, and the snapshot builder only reads
(`readCardDocument`, `readVaultIndex`, `readNote`). The only writer for a **weave operation** is `applyWeaveOperations`, and the only application caller is the `weave:apply-plan` handler. And the
renderer invokes `applyWeavePlan` only from `handleApplyWeaveOperations`, which runs from the apply buttons or the destructive-confirmation callback. The nuance is that planning is not entirely
write-free on disk: the session logger appends its JSONL and the embedding service maintains `.crashweaver/embeddings.json`. Both are CrashWeaver metadata, so the rule holds for the vault content
a plan proposes to change.

## Apply

**The single public entry point.** `weaveApplyService.ts` exports exactly one function: `applyWeaveOperations(resolvedRoot, cardStorePath, operations, options)`, where `options` is
`WeaveApplyOptions` — `dryRun` (default `false`) and `stopOnError` (default `true`). The `weave:apply-plan` handler resolves the card store with `getVaultCardStore` and calls the service with `{
dryRun: false, stopOnError: true }`, so production always writes and always stops on the first failure.

**The ten operation kinds.** `applyWeaveOperations` dispatches on `operation.kind`; the table mirrors the `WeavePlanOperationKind` union in `electron/vault-contract.ts`, which is authoritative:

| Kind                   | Handler                   | High-level behaviour                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insert-boundary-pair` | `applyInsertBoundaryPair` | Reads the note, uses `payload.boundaryBlock` as-is (synthesising bare markers only when empty), computes an insert index from the placement, splices the block in, checks boundary integrity, writes atomically, syncs to the card store                                  |
| `edit-note-content`    | `applyEditNoteContent`    | Requires `targetText` to be present (with a CRLF-normalised retry), replaces every occurrence with `replacementMarkdown`, checks boundary integrity, writes, syncs                                                                                                        |
| `create-note`          | `applyCreateNote`         | Refuses an existing path, builds `# title` + blank line + content, creates parents, writes, syncs, and writes a default card JSON plus reference when the focused card is missing                                                                                         |
| `rename-note`          | `applyRenameNote`         | Requires source present and destination free, creates the destination parent, parses boundary UIDs before the move, renames, then rewrites `referenced_in` paths on the cards whose UIDs appeared as boundaries in the renamed note and that still reference the old path |
| `move-note`            | `applyMoveNote`           | Delegates to the rename implementation with the move reason                                                                                                                                                                                                               |
| `delete-note`          | `applyDeleteNote`         | Parses the note, removes this note's reference from every referenced card, warns about orphaned cards whose JSON is preserved, removes the note file                                                                                                                      |
| `create-directory`     | `applyCreateDirectory`    | Creates the directory recursively                                                                                                                                                                                                                                         |
| `rename-directory`     | `applyRenameDirectory`    | Requires the source directory present and the destination free, creates the destination parent, renames                                                                                                                                                                   |
| `move-directory`       | `applyMoveDirectory`      | Delegates to the directory rename implementation                                                                                                                                                                                                                          |
| `delete-directory`     | `applyDeleteDirectory`    | Requires the directory, refuses the vault root, warns when non-empty, removes recursively                                                                                                                                                                                 |

Two consequences are worth stating because the plan diff does not show them. A note rename or move rewrites card references but not the boundary markers' surrounding prose or notes linking to the
moved note by path. A directory rename or move performs no reference rewriting at all — only the note handlers update references. Whether directory-level reference repair belongs in apply is not
answerable from the code.

**Guards.**

| Guard              | Symbol                                                                 | Enforces                                                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault boundary     | `assertWithinVault`                                                    | Resolves root and target through symlinks and rejects targets whose real path leaves the root; for not-yet-existing paths it walks up to the nearest existing ancestor first, so a create cannot escape through a symlink. Returns the naive resolved path for the file operation. |
| Note existence     | `assertNoteExists`                                                     | Existing-note operations require a file, else "Note not found"                                                                                                                                                                                                                     |
| Target text        | inline in `applyEditNoteContent`                                       | Replacement happens only when `targetText` is found, with a CRLF-normalised retry, so a note edited since planning fails rather than being clobbered                                                                                                                               |
| Boundary integrity | `verifyBoundaryIntegrity`                                              | Runs `parseCrashCardsFromNote` over the prospective content and fails on any `error`-severity diagnostic, so an edit cannot leave unbalanced `%%CW_CARD_START/END%%` pairs                                                                                                         |
| Target free        | inline in `applyCreateNote`, `applyRenameNote`, `applyRenameDirectory` | Refuses to create or rename onto an existing path                                                                                                                                                                                                                                  |
| Vault root         | inline in `applyDeleteDirectory`                                       | Refuses to delete the resolved vault root                                                                                                                                                                                                                                          |

Boundary integrity runs after the prospective content is assembled but before `writeTextAtomically`, so a failing check means no write at all.

**`stopOnError` and reporting.** The loop walks operations in order and appends every outcome — success, returned failure, or thrown error — to `results` as a `WeaveApplyOperationResult` with
`operationIndex`, `kind`, `targetPath`, `ok`, and optional `error`, `warning`, `affectedPaths`; warnings are also collected into the aggregate array. With `stopOnError` true (the default, and what
production passes) the first failure stops the loop and every remaining operation is reported with `Skipped due to previous failure.`, so the user sees the whole plan accounted for. With
`stopOnError: false` later operations can still succeed. The returned `WeaveApplyResult` carries `results`, `appliedCount`, `failedCount`, `allOk` (`failedCount === 0`), and `warnings`. The panel
badges applied operations and shows a success or partial banner listing each failure's kind, path, and error; on full success `App.tsx` re-indexes the vault and refreshes the card, crashpad, and
internal-directory catalogues.

**What dry run does and does not validate.** Every handler, directly or through the move-to-rename delegation, checks `dryRun` immediately after `assertWithinVault` and returns
`{ ok: true, affectedPaths: [...] }` before doing anything else. That early return precedes the note-existence check, the `targetText` search, boundary-integrity verification, heading and
selection lookup, the destination-free checks, and the directory existence and
vault-root checks. Dry run therefore validates one thing only: that each target path resolves inside the vault. It reports `ok: true` for an operation whose note does not exist, whose `targetText`
is absent, whose boundary block is malformed, or whose destination is already occupied, and equally for `delete-directory` targeting the vault root, because the root guard sits after the early
return. `tests/electron/weaveApplyService.test.ts` pins that contract: a dry run writes nothing for every operation kind; it reports success for an operation the real run refuses on one of those skipped checks (a missing note, absent `targetText`, a malformed boundary block, an occupied destination, a missing directory source); it skips the vault-root guard and the non-empty-directory warning; and it still rejects a target path that escapes the vault, because containment is checked before the early return. Each case is paired with the same operation run for real, whose error proves the operation genuinely requires the validation the dry run skipped.

Dry run's contract is containment-only. It is not a pre-flight validator, and the option's doc
comment says so; turning it into full validation belongs with the apply-service work tracked as a
known gap in [the roadmap](../roadmap.md).

Production never uses dry run: `weave:apply-plan` passes `dryRun: false`, so the real checks always run before a write.

## Pipeline diagram

```
renderer                    main process                   vault (read-only)     model
────────                    ────────────                   ─────────────────     ─────
WeaverProposalPanel (composer + intent)
   │ handleGenerateWeavePlan
   ▼
generateWeavePlan ──IPC──▶ 'weave:generate-plan'
                             ▼
                           weaveService.generateWeavePlan
                             ├─ validateWeavePlanRequest      (weavePlanSchema)
                             ├─ assertVaultRoot
                             └─ buildWeaveContextSnapshot ───▶ card store, index,
                                  │ weaverEmbeddingService ────▶ candidate notes,
                                  │                              embeddings.json
                                  ▼
                           activeProvider.generatePlan
                             ├─ resolveModel + resolveFullModelProfile
                             ├─ createWeaveContextToolRuntime  (read-only tools)
                             ├─ createWeaveRequestSessionLogger ─▶ request-logs/*.jsonl
                             └─ runWeaveGraph ────────────────────────────────▶ OpenRouter
                                  callModel ⇄ executeTool          ▲
                                  → repair (syntactic | semantic | │
                                            schema | exhaustion)   │
                                  → finalize → validate ───────────┘
                                  ▼
                           WeavePlanResult + validateWeavePlanResult
   ◀──IPC result──────────────────────────────────────────────────────────────
   ▼
approval gate
  WeaverOperationItem (accept / reject / expand)
  WeaverDiffPreview | WeaverUnifiedDiffModal | WeaverConfirmDialog
   │ handleApplyWeaveOperations
   ▼
applyWeavePlan ──IPC──▶ 'weave:apply-plan' ──▶ applyWeaveOperations
                                                 ├─ assertWithinVault
                                                 ├─ assertNoteExists + target checks
                                                 ├─ verifyBoundaryIntegrity
                                                 ├─ writeTextAtomically ──▶ vault notes
                                                 └─ syncNoteToCardStore ──▶ card store
                                                 ▼
                                               WeaveApplyResult
   ◀──IPC result──────────────────────────────────────────────────────────────
   ▼
apply-result banner + vault re-index
```

## Stage map

| Stage                                    | Module                                                                           | Key export                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Entry and orchestration                  | `electron/weaver/weaveService.ts`                                                | `generateWeavePlan`, `initializeWeaveProvider`                                                                       |
| Entry IPC                                | `electron/main.ts`, `electron/preload.ts`                                        | `ipcMain.handle('weave:generate-plan')`, `generateWeavePlan` bridge                                                  |
| Context retrieval                        | `electron/weaver/weaveContextService.ts`                                         | `buildWeaveContextSnapshot`                                                                                          |
| Read-only tools                          | `electron/weaver/weaveContextService.ts`                                         | `WeaveContextToolRuntime`, `createWeaveContextToolRuntime`                                                           |
| Embeddings and cache                     | `electron/weaver/weaverEmbeddingService.ts`                                      | `buildQueryEmbedding`, `getOrComputeNoteEmbedding`, `buildSimilarityMap`                                             |
| Model policy and budgets                 | `electron/weaver/weaveModelProfiles.ts`                                          | `resolveModel`, `resolveFullModelProfile`, `BUDGET_VALIDATION_BOUNDS`                                                |
| Provider (production)                    | `electron/weaver/openRouterClient.ts`                                            | `OpenRouterWeaveProvider`                                                                                            |
| Provider (offline)                       | `electron/weaver/stubWeaveProvider.ts`                                           | `StubWeaveProvider`                                                                                                  |
| Transport                                | `electron/weaver/weaveHttpClient.ts`                                             | `OpenRouterHttpClient`                                                                                               |
| Planning loop                            | `electron/weaver/weaveGraph.ts`                                                  | `runWeaveGraph`, `resolveWeaveEffectiveBudget`                                                                       |
| Planning nodes                           | `electron/weaver/weaveGraphNodes.ts`                                             | `makeCallModelNode`, `makeExecuteToolNode`, `makeRepairNode`, `makeFinalizeNode`, `makeValidateNode`, `makeFailNode` |
| Loop state and events                    | `electron/weaver/weaveGraphState.ts`                                             | `WeaveAgentState`, `WeaveProgressEvent`, `MAX_TOTAL_STEPS`                                                           |
| Prompts                                  | `electron/weaver/weavePlanPrompts.ts`                                            | `buildSystemPrompt`, `buildInitialUserTurn`                                                                          |
| Validation                               | `electron/weaver/weavePlanSchema.ts`                                             | `validateWeavePlanRequest`, `validateWeavePlanResult`, `normalizeVaultRelativePath`                                  |
| Request logging                          | `electron/weaver/weaveRequestLogger.ts`                                          | `createWeaveRequestSessionLogger`                                                                                    |
| Trace compaction                         | `electron/weaver/weaveTraceCompactor.ts`                                         | `compactTraceItem`, `WeaveTraceAccumulator`                                                                          |
| Session history                          | `electron/weaver/weaverSessionHistory.ts`                                        | `listWeaverSessions`, `getWeaverSession`, `deleteWeaverSession`, `clearWeaverSessions`                               |
| Approval gate (panel)                    | `src/components/WeaverProposalPanel.tsx`                                         | `WeaverProposalPanel`                                                                                                |
| Approval gate (items, previews)          | `src/components/WeaverOperationItem.tsx`, `src/components/WeaverDiffPreview.tsx` | `WeaverOperationItem`, `WEAVE_OPERATION_META`, `WeaverDiffPreview`                                                   |
| Approval gate (unified diff)             | `src/components/WeaverUnifiedDiffModal.tsx`                                      | `WeaverUnifiedDiffModal`                                                                                             |
| Approval gate (destructive confirmation) | `src/components/WeaverConfirmDialog.tsx`                                         | `WeaverConfirmDialog`, `isDestructiveOperation`                                                                      |
| Apply                                    | `electron/weaver/weaveApplyService.ts`                                           | `applyWeaveOperations`                                                                                               |
| Shared contract                          | `electron/vault-contract.ts`                                                     | `WeavePlanRequest`, `WeavePlan`, `WeavePlanOperation`, `WeavePlanResult`, `WeaveApplyResult`, `WeaveApplyOptions`    |

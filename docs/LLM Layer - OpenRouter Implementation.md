# LLM Layer - OpenRouter Implementation

Canonical product and architecture source:
- docs/00-Single-Source-of-Truth.md

This document defines how to implement the CrashWeaver LLM layer using OpenRouter while preserving Stage 5 and Stage 6 boundaries.

## 1. Goals And Scope

Primary goals:
- Add a production-grade agentic Weaver pipeline using OpenRouter.
- Support guided insert and intelligent Weaver planning starting from a single focused crashpad card.
- Give the agent read-only access to compact vault summaries, directory structure, and targeted markdown note reads needed for planning.
- Keep Stage 5 non-destructive: proposals only, no immediate note or card file writes.
- Keep Stage 6 as the first stage that tracks and applies the generated diffs.
- Keep provider plumbing extensible so local Ollama or direct cloud providers can be added without changing renderer workflows.

In scope:
- OpenRouter client integration in Electron main process, including a controlled read-only tool loop for vault exploration.
- IPC and preload APIs for agentic plan generation and execution status streaming.
- Condensed AST or structural summaries passed into system prompts to stay under context limits.
- Request and response contracts for deterministic proposal objects, guided insert permissions, and intelligent restructuring boundaries.
- Safety, validation, observability, and cost controls.

Out of scope:
- Final diff accept or reject application path (Stage 6).
- Spaced repetition scheduling logic (Stage 7).

## 2. Why OpenRouter For CrashWeaver

OpenRouter is suitable for this project because:
- One key and one billing surface can access many cloud models.
- It supports explicit user model selection without changing renderer workflows.
- It allows incremental quality and cost tuning without changing renderer workflows.

OpenRouter is not a full architecture by itself. The app should still own:
- Prompt contracts
- Proposal schema validation
- Safety guards
- Approval gate behavior

## 3. Architecture Placement

The integration should follow current CrashWeaver layer boundaries.

Main process:
- Hosts OpenRouter client and Weaver orchestration.
- Validates outputs and returns typed plans.
- Never auto-applies filesystem changes in Stage 5.

Preload:
- Exposes narrow Weaver API methods through contextBridge.
- No API key exposure.

Renderer:
- Collects model choice, insertion intent, single-card focus, guided permissions or intelligent strength, and current note context.
- Displays proposal output.
- Displays status and errors from main process.

## 4. File And Service Layout

Implemented under `electron/weaver/`:

**Core orchestration:**
- `weaveService.ts` — public API for plan generation, provider lifecycle, API key management, settings
- `weaveGraph.ts` — procedural ReAct loop with transition-table state machine (no LangChain/LangGraph)
- `weaveGraphNodes.ts` — node factories: callModel, executeTool, repair, finalize, validate, fail
- `weaveGraphState.ts` — typed state model, `WeaveMessage` type, step/route enums, budget constants

**LLM transport:**
- `weaveHttpClient.ts` — `WeaveHttpClient` interface, `OpenRouterHttpClient` (Electron net.fetch + AbortController)
- `openRouterClient.ts` — `OpenRouterWeaveProvider` (model resolution, profile, context → graph execution)
- `stubWeaveProvider.ts` — deterministic stub for offline/testing

**Prompts & schema:**
- `weavePlanPrompts.ts` — 10-layer composable prompt architecture (task contract, safety, operations, tool loop, repair)
- `weavePlanSchema.ts` — request and result validation, path normalisation, boundary checks

**Context & tools:**
- `weaveContextService.ts` — context snapshot builder, candidate note scoring, read-only tool runtime (6 tools via registry)
- `weaveModelProfiles.ts` — single source of truth for model resolution (UI tiers → OpenRouter IDs), structured output config, repair strategy, execution budgets
- `weaveCostPolicy.ts` — **deprecated** re-export stub; all logic lives in `weaveModelProfiles.ts`

**Observability:**
- `weaveRequestLogger.ts` — per-session JSONL request logs
- `weaveTraceCompactor.ts` — ReAct trace compaction for bounded memory

Contracts:
- `electron/vault-contract.ts` — Weaver request/response types, operation kinds, error categories
- `electron/preload.ts` — narrow Weaver IPC bridge
- `electron/main.ts` — Weaver IPC handler registration

## 5. Configuration And Secrets

Required configuration:
- `OPENROUTER_API_KEY`

Recommended optional configuration:
- `OPENROUTER_BASE_URL` default `https://openrouter.ai/api/v1`
- `OPENROUTER_APP_NAME` default `CrashWeaver`
- `OPENROUTER_APP_URL` default project repository URL
- `WEAVER_TIMEOUT_MS` default 60000

Secret handling rules:
- Read API keys in main process only.
- Do not expose API keys to renderer or preload return payloads.
- Do not write raw keys to vault files or project settings committed to git.
- For persistent user key storage, prefer OS credential storage in a later hardening pass.

## 6. Provider-Agnostic Interface (Keep This Even With OpenRouter)

Define a neutral interface so OpenRouter is an implementation, not a global dependency.

Example TypeScript shape:

```ts
export interface WeaveModelProvider {
  generatePlan(input: WeavePlanInput): Promise<WeavePlanResult>;
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}
```

OpenRouter implementation:
- `OpenRouterWeaveProvider implements WeaveModelProvider`

Future implementations:
- `OllamaWeaveProvider`
- `AnthropicWeaveProvider`
- `OpenAIWeaveProvider`

Router service:
- `WeaveProviderRouter` selects provider and model from policy.

## 7. Weaver Contracts

Use strict request and response contracts in `vault-contract.ts`.

Suggested request contract:

```ts
export type WeaveKind = 'guided-insert' | 'intelligent';
export type WeaveStrength = 'light' | 'standard' | 'go-ham';

export interface GuidedInsertPermissions {
  editContent: boolean;
  createNote: boolean;
}

export interface WeavePlanRequest {
  rootPath: string;
  kind: WeaveKind;
  preferredModel?: string;
  intent: string;
  cardUid: string;
  activeCrashpadId?: string;
  activeCrashpadPath?: string;
  activeNotePath?: string;
  selectedText?: string;
  permissions?: GuidedInsertPermissions;
  strength?: WeaveStrength;
  maxOperations?: number;
}
```

Suggested response contract for Stage 5:
```ts
export interface WeavePlanOperation {
  kind:
    | 'insert-boundary-pair'
    | 'edit-note-content'
    | 'create-note'
    | 'rename-note'
    | 'move-note'
    | 'delete-note'
    | 'create-directory'
    | 'rename-directory'
    | 'move-directory'
    | 'delete-directory';
  targetPath?: string;
  payload: Record<string, unknown>;
  rationale: string;
}

export interface WeavePlan {
  kind: WeaveKind;
  permissions?: GuidedInsertPermissions;
  strength?: WeaveStrength;
  summary: string;
  operations: WeavePlanOperation[];
  warnings: string[];
  referencedCards: string[];
}

export interface WeavePlanResult {
  plan: WeavePlan;
  model: string;
  provider: 'openrouter';
  trace?: WeaveReActStep[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
}

export type WeaveReActStepKind =
  | 'thought'
  | 'action'
  | 'observation'
  | 'validation'
  | 'repair'
  | 'error';

export interface WeaveReActStep {
  kind: WeaveReActStepKind;
  message: string;
  details?: Record<string, unknown>;
  ts?: string;
}

export interface WeaverSettings {
  preferredModel?: string;
  disableBudgetRestrictions?: boolean;
  budgetMaxTokens?: number;
  budgetTimeoutMs?: number;
  budgetIterationLimit?: number;
}
```

Stage 5 rule:
- Operations are proposals only. They do not mutate files.

## 8. OpenRouter API Call Pattern

Use HTTPS from main process.

Endpoint:
- `POST {OPENROUTER_BASE_URL}/chat/completions`

Required headers:
- `Authorization: Bearer <OPENROUTER_API_KEY>`
- `Content-Type: application/json`

Recommended headers:
- `HTTP-Referer: <OPENROUTER_APP_URL>`
- `X-Title: <OPENROUTER_APP_NAME>`

### ReAct Graph & Adaptive Orchestration Loop (Stage 5 Hardening)
The planning process runs inside a procedural, stateful execution loop supporting model-tailored settings and adaptive error self-repair — **no LangChain or LangGraph dependency**.

Instead of a single brittle run, orchestration utilizes:
1. **Layered Prompts** (`weavePlanPrompts.ts`): Separation of Core Task Contract, Safety & Boundary Policies, Model-Specific Overlays, and request context summaries rather than monolithic prompts.
2. **Model Profile resolution** (`weaveModelProfiles.ts`): Models like GPT-4o and Claude have customized prompting overlays, temperatures, structured JSON requirements, and repair strategies initialized at runtime.
3. **Transition-table state machine** (`weaveGraph.ts`): A pure function `resolveNextStep()` maps each graph step + route to the next step, replacing fragile string-based dispatch with exhaustiveness-checked transitions.
4. **Syntactic JSON Repair**: When parser/extraction fails on minor syntactic errors, the engine performs auto-repair by feeding back error context to request a corrected JSON format instead of throwing immediately.
5. **Semantic Schema Repair**: If a generated plan violates the strict `WeavePlanResult` schema, the loop returns structural error details to the model to correct operations on-the-fly.
6. **Hard step cap** (`MAX_TOTAL_STEPS = 24`): Prevents infinite oscillation between repair and model-call.
7. **Retrieval Limit Graceful Fallback**: If tool calls reach the maximum iteration limit, the system appends a final warning requiring the model to finalize from partial evidence.
8. **Proper HTTP cancellation**: `AbortController` replaces `Promise.race` for timeout handling, ensuring the underlying fetch is actually cancelled.

Trace visibility:
- Each major step can be emitted as a typed ReAct trace item and returned with the final plan result.
- Renderer panels can show these steps as expandable rows for debugging and confidence review.

Important:
- Never trust the agent's final payload blindly.
- Parse then validate tool parameters and output against the local schema.
- Reject and return actionable errors when schema validation or permission boundary checks fail.

## 9. Prompt Strategy

The prompt builder (`weavePlanPrompts.ts`) composes a 10-layer architecture:

- **Layer 1 (Task Contract)**: Core Weaver identity, planner scope, and non-destructive Stage 5 target specifications.
- **Layer 2 (Mandatory Safety & Boundary Policies)**: Rigid rules including no crashpad mutations, matching focused card UID boundary rules, non-traversal relative target paths, permission adherence, substantive note creation prose, explicit delete justification, and strict JSON-only format constraints.
- **Layer 3 (Operation Schema)**: Full documentation of all 10 operation kinds with canonical examples.
- **Layer 4 (Output Format Schema)**: Exact expected JSON shape for the final plan response.
- **Layer 5 (Tool Loop Protocol)**: Dynamic — max tool call count, note-read budget, available tools, and tool constraints.
- **Layer 6 (Model-Specific Resolution Overlay)**: Dynamic — injected instructions per resolved model (JSON mode, markdown fences, thinking tags).
- **Layer 7 (Request Specification Context)**: Dynamic — current kind, permissions, strength, user intent, crashpad metadata, active note, truncated selected text.
- **Layer 8 (Context Snapshot)**: Dynamic — pre-loaded vault context: card summary, ranked candidate notes with scores, directory summaries, retrieval budget.
- **Layer 9 (Observation)**: Dynamic — tool result digests with remaining budget tracking.
- **Layer 10 (Repair Messages)**: Dynamic — targeted correction prompts for syntactic, semantic, schema, and exhaustion errors.

Context minimization:
- Send only relevant notes and snippets instead of full vault contents.
- Truncate long note excerpts with explicit markers.
- Include path lists and metadata before full text when possible.

## 10. IPC And Preload Surface

Add IPC channels in main process:
- `weave:generate-plan`
- `weave:health-check`
- `weave:update-settings`

Optional for streaming status:
- `weave:generate-plan-stream-start`
- `weave:generate-plan-stream-cancel`
- event channel `weave:status`

Preload additions should mirror existing style:
- `generateWeavePlan(request)`
- `checkWeaveProvider()`
- `updateWeaverSettings(partialSettings)`

Renderer should consume typed responses only.

## 11. Error Handling Model

Normalize errors into stable categories:
- `config-error`: missing API key or invalid config
- `auth-error`: invalid key or forbidden model
- `rate-limit`: provider throttling
- `provider-timeout`: request timeout
- `provider-error`: upstream non-auth failure
- `schema-error`: model returned invalid JSON
- `safety-error`: plan violates Stage 5 constraints

User-facing rules:
- Return clear, actionable messages.
- Do not leak internal stack traces to UI.
- Preserve enough detail in logs for debugging.

## 12. Safety And Guardrails

Must-have Stage 5 guardrails:
- Hard deny any write operation execution path from Weaver output.
- Validate every operation kind and required fields.
- Reject operations not permitted by guided insert permissions or intelligent mode scope.
- Reject path traversal or out-of-vault targets in proposed paths.
- Reject malformed boundary operations.
- Reject plans with unknown operation types.
- Cap total operations to prevent runaway proposals.

Data governance:
- Add user-facing notice that cloud mode sends selected context outside local machine.
- Allow users to disable cloud Weaver per vault.

## 13. Model Selection Policy

Model resolution and profile configuration is centralized in `weaveModelProfiles.ts` (canonical) with a deprecated re-export stub in `weaveCostPolicy.ts`.

- `resolveModel()` maps UI-tier shortcuts (`cw-fast`, `cw-balanced`, `cw-deep`) to full OpenRouter model IDs, with a safe fallback to `openai/gpt-4o`.
- `resolveFullModelProfile()` combines model-specific config (structured output mode, repair strategy, system prompt overlay) with per-request execution budgets (max tokens, timeout, temperature, iteration limit).
- Strength controls prompt autonomy and request budgets, not model routing.
- Per-request budget overrides are validated and clamped to safe bounds (`BUDGET_VALIDATION_BOUNDS`).
- An explicit "disable budget restrictions" toggle lifts all caps while preserving Stage 5 non-destructive safety validation.

## 14. Observability And Cost Control

Log per request:
- provider, model, request kind, permissions or strength
- latency
- token usage if returned
- estimated cost band
- success or failure category

Add guardrails:
- monthly or weekly budget cap
- request concurrency cap
- circuit breaker for repeated provider failures
- retry with backoff for retryable failures only
- when budget restrictions are disabled, continue enforcing non-destructive Stage 5 safety validation and output schema constraints

Never log:
- API keys
- full vault content by default

## 15. Testing Strategy

Unit tests:
- Prompt builder includes Stage 5 non-destructive rules.
- Schema validator rejects malformed plans.
- Safety validator rejects out-of-vault paths and unknown operations.
- Model selection honors explicit user choice with a safe fallback.

Integration tests:
- Mock OpenRouter responses for success, invalid JSON, timeout, and auth failure.
- Verify `weave:generate-plan` returns typed errors and never writes files.

Manual validation checklist:
- API key missing scenario returns configuration guidance.
- Guided insert default produces a schema-valid insertion-only proposal.
- Guided insert with `edit-content` and `create-note` permissions changes proposal scope appropriately.
- Intelligent strengths produce meaningfully different plan breadth.
- Repeated generate or dismiss actions do not mutate notes or card JSON.

## 16. Suggested Phased Delivery

Phase A:
- Add contracts, OpenRouter client, non-streaming plan generation.
- Validate schema and safety constraints.

Phase B:
- Add provider health check and richer error categories.
- Add request logging and usage telemetry.

Phase C:
- Add optional streaming status.
- Add preferred model selection and provider-backed model listing in settings.

Phase D:
- Prepare Stage 6 handoff by ensuring proposals are diff-renderable and deterministic.

## 17. Minimal Implementation Checklist

1. Add Weaver request and response types to `electron/vault-contract.ts`.
2. Implement OpenRouter client and weave service in main process.
3. Register `weave:generate-plan` IPC handler in `electron/main.ts`.
4. Expose preload bridge methods in `electron/preload.ts`.
5. Extend renderer typings in `src/vite-env.d.ts`.
6. Add settings surface for OpenRouter key and preferred model selection.
7. Add schema and safety validation before returning plans.
8. Add tests for validation, errors, and non-destructive guarantees.

## 18. Example Non-Destructive System Instruction

Use this style, adapted to your final schema:

```text
You are Weaver for CrashWeaver.
You are generating a Stage 5 proposal only.
Never perform filesystem actions and never imply that changes are already applied.
Return only valid JSON matching the provided schema.
You may inspect compact vault summaries and read specific markdown notes, but only to plan.
All boundary insertions must use paired comments with the same UID:
%%CW_CARD_START uid:<UID>%% and %%CW_CARD_END uid:<UID>%%.
Do not place full card payload in note comments.
If context is insufficient, return warnings and minimal safe operations.
```

## 19. Stage Alignment Summary

Stage 5:
- OpenRouter-backed Weaver plan generation
- Non-destructive staged proposals

Stage 6:
- Accept or reject diff UX
- Apply path for accepted operations only

Stage 7:
- Review scheduling and familiarity workflows

Keep all details in this document subordinate to `docs/00-Single-Source-of-Truth.md`.
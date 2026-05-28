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

## 4. Proposed File And Service Layout

Suggested additions under electron:
- `electron/weaver/openRouterClient.ts`
- `electron/weaver/weaveService.ts`
- `electron/weaver/weavePromptBuilder.ts`
- `electron/weaver/weavePlanSchema.ts`
- `electron/weaver/weaveValidation.ts`
- `electron/weaver/weaveCostPolicy.ts`

Suggested contract extensions:
- `electron/vault-contract.ts`: add Weaver request and response types.
- `electron/preload.ts`: expose new Weaver IPC methods.
- `electron/main.ts`: register Weaver IPC handlers.

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
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
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
The planning process runs inside a sophisticated, stateful execution loop supporting model-tailored settings and adaptive error self-repair.

Instead of a single brittle run, orchestration utilizes:
1. **Layered Prompts**: Separation of Core Task Contract, Safety & Boundary Policies, Model-Specific Overlays, and request context summaries rather than monolithic prompts.
2. **Model Profile resolution**: Models like GPT-4o and Claude have customized prompting overlays, temperatures, and structured JSON requirements initialized at the runtime start.
3. **Syntactic JSON Repair**: When parser/extraction fails on minor syntactic errors, the engine performs auto-repair by feeding back error context to request a corrected JSON format instead of throwing immediately.
4. **Semantic Schema Repair**: If a generated plan violates our strict [WeavePlanResult](electron/vault-contract.ts) rules, the loop returns structural error details to the model to correct properties of operations on-the-fly.
5. **Retrieval Limit Graceful Fallback**: If tool calls reach the maximum iteration limit, the system appends a final warning requiring the model to finalize from partial evidence, ensuring a high-quality best-guess proposal is returned rather than a loop exhaustion error.

Important:
- Never trust the agent's final payload blindly.
- Parse then validate tool parameters and output against the local schema.
- Reject and return actionable errors when schema validation or permission boundary checks fail.

## 9. Prompt Strategy

Prompt builder should compose:
- **Layer 1 (Task Contract)**: Core Weaver identity, planner scope, and non-destructive Stage 5 target specifications.
- **Layer 2 (Mandatory Safety & Boundary Policies)**: Rigid rules including no crashpad mutations, matching focused card UID boundary rules, non-traversal relative target paths, permission adherence, substantive note creation prose, explicit delete justification, and strict JSON-only format constraints.
- **Layer 3 (Model-Specific Resolution Overlay)**: Injected instructions optimizing output syntax configuration (JSON Mode, XML/markdown fences, schema strictness) per resolved model.
- **Layer 4 (Request Specification Context)**: Current kind-specific permissions, intelligent strength descriptor details, user intent, crashpad metadata, active note, and truncated selected text.

Context minimization:
- Send only relevant notes and snippets instead of full vault contents.
- Truncate long note excerpts with explicit markers.
- Include path lists and metadata before full text when possible.

## 10. IPC And Preload Surface

Add IPC channels in main process:
- `weave:generate-plan`
- `weave:health-check`

Optional for streaming status:
- `weave:generate-plan-stream-start`
- `weave:generate-plan-stream-cancel`
- event channel `weave:status`

Preload additions should mirror existing style:
- `generateWeavePlan(request)`
- `checkWeaveProvider()`

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

Recommended starter policy:
- Let the user explicitly select the model used for a Weaver request.
- Keep one safe default model when no explicit selection exists.
- Use strength to control prompt autonomy and request budgets, not model routing.

Policy should be data-driven:
- Store the preferred model selection in settings, not hardcoded in renderer.
- Support live model listing from the provider.
- Add per-request max token and timeout caps.

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
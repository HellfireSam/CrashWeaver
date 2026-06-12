/**
 * weaveGraphNodes.ts
 *
 * Node factories for the Weaver agent loop.
 *
 * Each factory returns a node function (state) => Partial<state>.
 * Dependencies (HTTP client, tool runtime, logger) are injected via closure.
 * All message types are native — no LangChain dependency.
 *
 * Nodes:
 *   callModel    — calls the LLM, parses response, sets pendingRoute
 *   executeTool  — executes a read-only vault tool, appends observation
 *   repair       — appends the appropriate repair message for the pending route
 *   finalize     — wraps the pending plan in a WeavePlanResult
 *   validate     — runs weavePlanSchema validation; routes to repair or success
 *   fail         — logs and seals the error state (terminal)
 */

import type { WeaveAgentState, WeaveAgentRoute, WeaveMessage } from './weaveGraphState';
import { MIN_REMAINING_TIME_MS, assistantMsg, userMsg } from './weaveGraphState';
import type { WeaveProgressCallback } from './weaveGraphState';
import type { WeaveContextToolRuntime } from './weaveContextService';
import type { WeaveRequestSessionLogger } from './weaveRequestLogger';
import type { WeaveHttpClient } from './weaveHttpClient';
import {
  buildObservationMessage,
  buildSyntacticRepairMessage,
  buildSemanticRepairMessage,
  buildSchemaRepairMessage,
  buildExhaustionRepairMessage,
} from './weavePlanPrompts';
import { validateWeavePlanResult } from './weavePlanSchema';
import type { WeavePlanResult, WeaveErrorCategory } from '../vault-contract';
import type { WeaveToolResult } from './weaveContextService';

// ── Internal helpers ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Attempts to extract a JSON object from raw model output.
 * Handles: bare JSON, markdown-fenced JSON, and JSON embedded in prose.
 */
function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip markdown code fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // fall through
      }
    }

    // Extract outermost {...}
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through
      }
    }

    throw new Error('Could not find valid JSON in the model response.');
  }
}

type ParsedAction =
  | { type: 'tool'; thought?: string; toolName: string; arguments: Record<string, unknown> }
  | { type: 'final'; thought?: string; plan: unknown };

/**
 * Parses a model response object into a strongly-typed action.
 * Returns null if the shape is unrecognised (triggers semantic repair).
 */
function parseActionFromJson(value: unknown): ParsedAction | null {
  if (!isRecord(value)) return null;

  const thought = typeof value.thought === 'string' && value.thought.trim() ? value.thought.trim() : undefined;

  if (value.type === 'tool' && typeof value.toolName === 'string') {
    return {
      type: 'tool',
      thought,
      toolName: value.toolName,
      arguments: isRecord(value.arguments) ? value.arguments : {},
    };
  }

  if (value.type === 'final' && 'plan' in value) {
    return { type: 'final', thought, plan: value.plan };
  }

  return null;
}

/**
 * WeaveMessage is already in the role/content format expected by OpenRouter,
 * so conversion is an identity pass-through.  Kept as an explicit function
 * so the contract is clear at the call site.
 */
function messagesToOpenRouterFormat(
  messages: WeaveMessage[],
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return messages;
}

function makeWeaveError(message: string, category: WeaveErrorCategory): Error {
  return Object.assign(new Error(message), { errorCategory: category });
}

function getTraceDiagnostics(
  toolResult: WeaveToolResult,
): NonNullable<WeavePlanResult['trace']>[number]['diagnostics'] {
  return toolResult.ok ? undefined : toolResult.diagnostics;
}

// ── callModel node ────────────────────────────────────────────────────────────

/**
 * Calls the LLM with the current message history, parses the response,
 * and sets pendingRoute to direct the conditional edge.
 *
 * Routes:
 *   execute-tool     — parsed a tool request and budget is available
 *   finalize         — parsed a final plan action
 *   repair-syntactic — response was not valid JSON but has braces
 *   repair-semantic  — response was valid JSON but wrong action shape
 *   repair-exhaustion— wanted a tool but tool budget is exhausted
 *   fail             — unrecoverable error (timeout, network, no budget left)
 */
export function makeCallModelNode(
  httpClient: WeaveHttpClient,
  logger?: WeaveRequestSessionLogger,
  onProgress?: WeaveProgressCallback,
): (state: WeaveAgentState) => Promise<Partial<WeaveAgentState>> {
  return async function callModelNode(state: WeaveAgentState): Promise<Partial<WeaveAgentState>> {
    const {
      request,
      modelProfile,
      resolvedModel,
      messages,
      toolCallCount,
      repairAttemptCount,
      startTimeMs,
    } = state;

    if (!request || !modelProfile) {
      return {
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: 'Weaver internal error: missing request or model profile.',
        errorCategory: 'config-error' as WeaveErrorCategory,
      };
    }

    const elapsedMs = Date.now() - startTimeMs;
    const remainingMs = modelProfile.timeoutMs - elapsedMs;

    if (remainingMs <= 0) {
      return {
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage:
          'Weaver request timed out. Try a smaller guided insert or a lighter intelligent strength.',
        errorCategory: 'provider-timeout' as WeaveErrorCategory,
      };
    }

    // ── Call the LLM ──────────────────────────────────────────────────────────

    const turnNumber = toolCallCount + repairAttemptCount + 1;
    onProgress?.({ phase: 'call-model-start', turn: turnNumber });

    let rawContent: string;
    let resolvedModelName: string;
    let rawUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    try {
      const response = await httpClient.chatCompletion(
        {
          model: resolvedModel,
          messages: messagesToOpenRouterFormat(messages),
          maxTokens: modelProfile.maxTokens,
          temperature: modelProfile.temperature,
          responseFormatParams: modelProfile.responseFormatParams,
        },
        remainingMs,
        logger,
      );
      rawContent = response.content;
      resolvedModelName = response.resolvedModel;
      rawUsage = response.usage;
    } catch (error) {
      const typedError = error as { message: string; errorCategory?: WeaveErrorCategory };
      return {
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: typedError.message,
        errorCategory: typedError.errorCategory ?? ('provider-error' as WeaveErrorCategory),
      };
    }

    const newUsage: WeavePlanResult['usage'] = rawUsage
      ? {
          promptTokens: rawUsage.prompt_tokens,
          completionTokens: rawUsage.completion_tokens,
          totalTokens: rawUsage.total_tokens,
        }
      : undefined;

    const updates: Partial<WeaveAgentState> = {
      lastRawContent: rawContent,
      resolvedModel: resolvedModelName,
      accumulatedUsage: newUsage,
    };

    // ── Parse JSON ────────────────────────────────────────────────────────────

    let parsed: unknown;
    let parseError = false;

    try {
      parsed = extractJsonFromText(rawContent);
    } catch {
      parseError = true;
    }

    const maxRepairs = modelProfile.repairStrategy === 'conservative' ? 1 : 2;
    const repairsRemaining = repairAttemptCount < maxRepairs;
    const timeOk = modelProfile.timeoutMs - (Date.now() - startTimeMs) > MIN_REMAINING_TIME_MS;

    if (parseError) {
      if (logger) {
        void logger.log('node-call-model', {
          toolCallCount,
          repairAttemptCount,
          model: resolvedModelName,
          rawContentLength: rawContent.length,
          parseError: true,
        });
      }
      onProgress?.({ phase: 'call-model-end', turn: turnNumber, parsedAs: 'unparseable' });
      const hasBraces = rawContent.includes('{') && rawContent.includes('}');
      if (hasBraces && repairsRemaining && timeOk) {
        return {
          ...updates,
          pendingRoute: 'repair-syntactic' as WeaveAgentRoute,
          messages: [assistantMsg(rawContent)],
          trace: [{
            thought: "The model response failed to parse as valid JSON directly.",
            action: `Raw output length: ${rawContent.length} chars`,
            observation: "Syntactic repair triggered: Directing model to fix JSON formatting."
          }]
        };
      }
      return {
        ...updates,
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: 'Weaver model did not return valid JSON. Try again.',
        errorCategory: 'schema-error' as WeaveErrorCategory,
      };
    }

    // ── Classify action ───────────────────────────────────────────────────────

    const action = parseActionFromJson(parsed);

    if (logger) {
      void logger.log('node-call-model', {
        toolCallCount,
        repairAttemptCount,
        model: resolvedModelName,
        rawContentLength: rawContent.length,
        thought: action?.thought || null,
        actionType: action?.type || null,
      });
    }

    if (!action) {
      onProgress?.({ phase: 'call-model-end', turn: turnNumber, parsedAs: 'invalid-shape' });
      if (repairsRemaining && timeOk) {
        return {
          ...updates,
          pendingRoute: 'repair-semantic' as WeaveAgentRoute,
          messages: [assistantMsg(rawContent)],
          trace: [{
            thought: "Parsed JSON does not match the expected Action envelope structure.",
            action: `Raw output: ${rawContent.length > 500 ? rawContent.substring(0, 500) + '...' : rawContent}`,
            observation: "Semantic repair triggered: Directing model to output a valid action structure."
          }]
        };
      }
      return {
        ...updates,
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: 'Weaver model returned an invalid planning action. Try again.',
        errorCategory: 'schema-error' as WeaveErrorCategory,
      };
    }

    const finalizedUpdates = {
      ...updates,
      pendingThought: action.thought || null,
    };

    onProgress?.({
      phase: 'call-model-end',
      turn: turnNumber,
      parsedAs: action.type,
      thought: action.thought || undefined,
    });

    if (action.type === 'tool') {
      if (toolCallCount >= modelProfile.iterationLimit) {
        // Tool budget exhausted — push the model to finalize instead.
        if (repairsRemaining && timeOk) {
          return {
            ...finalizedUpdates,
            pendingRoute: 'repair-exhaustion' as WeaveAgentRoute,
            messages: [assistantMsg(rawContent)],
            pendingThought: null,
            trace: [{
              thought: action.thought || undefined,
              action: `Call Tool: "${action.toolName}"`,
              observation: `Budget of ${modelProfile.iterationLimit} tool calls exhausted. Directing model to output final plan.`
            }]
          };
        }
        return {
          ...finalizedUpdates,
          pendingRoute: 'fail' as WeaveAgentRoute,
          errorMessage:
            'Weaver exhausted its read-only retrieval loop before returning a plan.',
          errorCategory: 'provider-error' as WeaveErrorCategory,
        };
      }

      return {
        ...finalizedUpdates,
        pendingRoute: 'execute-tool' as WeaveAgentRoute,
        pendingToolName: action.toolName,
        pendingToolArgs: action.arguments,
        messages: [assistantMsg(rawContent)],
      };
    }

    // Final action
    return {
      ...finalizedUpdates,
      pendingRoute: 'finalize' as WeaveAgentRoute,
      pendingPlanData: action.plan,
      messages: [assistantMsg(rawContent)],
    };
  };
}

// ── executeTool node ──────────────────────────────────────────────────────────

/**
 * Executes the pending read-only tool and appends the result as a
 * distilled observation message. Always returns to callModel next.
 */
export function makeExecuteToolNode(
  toolRuntime: WeaveContextToolRuntime,
  logger?: WeaveRequestSessionLogger,
  onProgress?: WeaveProgressCallback,
): (state: WeaveAgentState) => Promise<Partial<WeaveAgentState>> {
  return async function executeToolNode(state: WeaveAgentState): Promise<Partial<WeaveAgentState>> {
    const { pendingToolName, pendingToolArgs, toolCallCount, modelProfile, pendingThought } = state;

    if (!pendingToolName) {
      return {
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: 'Weaver internal error: missing tool name in execute-tool node.',
        errorCategory: 'config-error' as WeaveErrorCategory,
      };
    }

    const turnNumber = toolCallCount + 1;
    onProgress?.({ phase: 'execute-tool-start', toolName: pendingToolName, turn: turnNumber });

    const toolResult = await toolRuntime.execute(pendingToolName, pendingToolArgs ?? {});
    const newToolCount = toolCallCount + 1;
    const callsRemaining = Math.max(0, (modelProfile?.iterationLimit ?? 0) - newToolCount);

    onProgress?.({
      phase: 'execute-tool-end',
      toolName: pendingToolName,
      ok: (toolResult as { ok?: boolean }).ok !== false,
      callsRemaining,
    });

    const observationMsg = buildObservationMessage(pendingToolName, toolResult, callsRemaining);

    if (logger) {
      void logger.log('node-execute-tool', {
        toolName: pendingToolName,
        arguments: pendingToolArgs,
        toolResultOk: (toolResult as { ok?: boolean }).ok !== false,
        toolCallCount: newToolCount,
        callsRemaining,
      });
    }

    const thought = pendingThought || undefined;
    const action = `Tool Call: "${pendingToolName}" with arguments:\n${JSON.stringify(pendingToolArgs, null, 2)}`;
    let observation = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
    const diagnostics = getTraceDiagnostics(toolResult);
    
    // Compact large observations to prevent unbounded trace growth
    const MAX_OBSERVATION_LEN = 800;
    if (observation.length > MAX_OBSERVATION_LEN) {
      observation = observation.slice(0, MAX_OBSERVATION_LEN) + `\n[... truncated ${observation.length - MAX_OBSERVATION_LEN} characters]`;
    }

    return {
      messages: [userMsg(observationMsg)],
      toolCallCount: newToolCount,
      pendingRoute: null,
      pendingToolName: null,
      pendingToolArgs: null,
      pendingThought: null,
      trace: [{ thought, action, observation, diagnostics }],
    };
  };
}

// ── repair node ───────────────────────────────────────────────────────────────

/**
 * Appends the appropriate repair instruction based on the current pendingRoute.
 * Always returns to callModel next for another attempt.
 */
export function makeRepairNode(
  logger?: WeaveRequestSessionLogger,
  onProgress?: WeaveProgressCallback,
): (state: WeaveAgentState) => Partial<WeaveAgentState> {
  return function repairNode(state: WeaveAgentState): Partial<WeaveAgentState> {
    const { pendingRoute, repairAttemptCount, errorMessage } = state;

    let repairMessage: string;

    switch (pendingRoute) {
      case 'repair-syntactic':
        repairMessage = buildSyntacticRepairMessage();
        break;
      case 'repair-semantic':
        repairMessage = buildSemanticRepairMessage();
        break;
      case 'repair-schema':
        repairMessage = buildSchemaRepairMessage(errorMessage ?? 'Unknown schema error.');
        break;
      case 'repair-exhaustion':
        repairMessage = buildExhaustionRepairMessage();
        break;
      default:
        repairMessage = buildSyntacticRepairMessage();
    }

    if (logger) {
      void logger.log('node-repair', {
        repairType: pendingRoute,
        repairAttempt: repairAttemptCount + 1,
      });
    }

    onProgress?.({ phase: 'repair', repairType: pendingRoute ?? 'unknown', repairAttempt: repairAttemptCount + 1 });

    return {
      messages: [userMsg(repairMessage)],
      repairAttemptCount: repairAttemptCount + 1,
      pendingRoute: null,
      errorMessage: null,
    };
  };
}

// ── finalize node ─────────────────────────────────────────────────────────────

/**
 * Wraps the pending plan data in a WeavePlanResult shell.
 * The plan is not yet schema-validated — that happens in the validate node.
 */
export function makeFinalizeNode(
  logger?: WeaveRequestSessionLogger,
  onProgress?: WeaveProgressCallback,
): (state: WeaveAgentState) => Partial<WeaveAgentState> {
  return function finalizeNode(state: WeaveAgentState): Partial<WeaveAgentState> {
    onProgress?.({ phase: 'finalize-start' });
    const { pendingPlanData, resolvedModel, accumulatedUsage, startTimeMs, request } = state;

    if (!request) {
      return {
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: 'Weaver internal error: missing request in finalize node.',
        errorCategory: 'config-error' as WeaveErrorCategory,
      };
    }

    const result: WeavePlanResult = {
      plan: pendingPlanData as WeavePlanResult['plan'],
      model: resolvedModel || 'unknown',
      provider: 'openrouter',
      usage: accumulatedUsage,
      latencyMs: Date.now() - startTimeMs,
    };

    if (logger) {
      const planKind =
        isRecord(pendingPlanData)
          ? String((pendingPlanData as Record<string, unknown>).kind ?? 'unknown')
          : 'unknown';
      void logger.log('node-finalize', {
        planKind,
        operationCount: Array.isArray(
          (pendingPlanData as Record<string, unknown> | null)?.operations,
        )
          ? ((pendingPlanData as Record<string, unknown>).operations as unknown[]).length
          : 0,
        latencyMs: result.latencyMs,
      });
    }

    return {
      result,
      pendingPlanData: null,
      pendingRoute: null,
    };
  };
}

// ── validate node ─────────────────────────────────────────────────────────────

/**
 * Runs weavePlanSchema validation against the finalized result.
 * On success: sets pendingRoute to null (graph terminates).
 * On failure: routes to repair-schema (if budget permits) or fail.
 */
export function makeValidateNode(
  logger?: WeaveRequestSessionLogger,
  onProgress?: WeaveProgressCallback,
): (state: WeaveAgentState) => Partial<WeaveAgentState> {
  return function validateNode(state: WeaveAgentState): Partial<WeaveAgentState> {
    onProgress?.({ phase: 'validate-start' });
    const { result, request, repairAttemptCount, modelProfile, startTimeMs } = state;

    if (!result || !request) {
      return {
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: 'Weaver internal error: missing result or request in validate node.',
        errorCategory: 'config-error' as WeaveErrorCategory,
      };
    }

    try {
      const validated = validateWeavePlanResult(result, request);

      if (logger) {
        void logger.log('node-validate-success', {
          operations: validated.plan.operations.length,
          warnings: validated.plan.warnings,
          latencyMs: Date.now() - startTimeMs,
          usage: validated.usage,
        });
      }

      onProgress?.({ phase: 'validate-end', ok: true });

      const thought = state.pendingThought || undefined;
      const action = `Proposed Weaver Plan with ${validated.plan.operations.length} operations.`;
      const observation = `Plan successfully validated and ready to apply.`;

      const updatedResult = {
        ...validated,
        trace: (state.trace || []).concat([{ thought, action, observation }])
      };

      return {
        result: updatedResult,
        pendingRoute: null,
        errorMessage: null,
        pendingThought: null,
      };
    } catch (validationError) {
      const errorMsg =
        validationError instanceof Error ? validationError.message : String(validationError);
      onProgress?.({ phase: 'validate-end', ok: false });
      const maxRepairs = (modelProfile?.repairStrategy === 'conservative' ? 1 : 2);
      const repairsRemaining = repairAttemptCount < maxRepairs;
      const timeOk =
        (modelProfile?.timeoutMs ?? 0) - (Date.now() - startTimeMs) > MIN_REMAINING_TIME_MS;

      if (logger) {
        void logger.log('node-validate-failed', {
          errorMessage: errorMsg,
          repairAttemptCount,
          repairsRemaining,
        });
      }

      if (repairsRemaining && timeOk) {
        const thought = state.pendingThought || undefined;
        const action = `Proposed Weaver Plan.`;
        const observation = `Validation failed: ${errorMsg}. Switched to schema repair mode.`;
        return {
          pendingRoute: 'repair-schema' as WeaveAgentRoute,
          errorMessage: errorMsg,
          result: null,
          pendingThought: null,
          trace: [{ thought, action, observation }]
        };
      }

      return {
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: `Plan failed schema validation: ${errorMsg}`,
        errorCategory: 'schema-error' as WeaveErrorCategory,
        result: null,
      };
    }
  };
}

// ── fail node ─────────────────────────────────────────────────────────────────

/**
 * Terminal error node. Logs the failure and ensures error state is sealed.
 * The graph runner will read errorMessage/errorCategory from the final state
 * and throw a typed error to the caller.
 */
export function makeFailNode(
  logger?: WeaveRequestSessionLogger,
  onProgress?: WeaveProgressCallback,
): (state: WeaveAgentState) => Promise<Partial<WeaveAgentState>> {
  return async function failNode(state: WeaveAgentState): Promise<Partial<WeaveAgentState>> {
    const { errorMessage, errorCategory, startTimeMs } = state;

    onProgress?.({
      phase: 'graph-fail',
      error: errorMessage ?? 'Unknown error',
      errorCategory: errorCategory ?? 'provider-error',
    });

    if (logger) {
      void logger.log('node-fail', {
        errorMessage,
        errorCategory,
        latencyMs: Date.now() - startTimeMs,
      });
    }

    return {
      errorMessage: errorMessage ?? 'Weaver encountered an unexpected error.',
      errorCategory: errorCategory ?? ('provider-error' as WeaveErrorCategory),
    };
  };
}

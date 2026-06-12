/**
 * weaveGraph.ts
 *
 * Fully type-safe, robust sequential ReAct loop for the Weaver planner.
 * Uses a pure procedural state machine with a transition table — no LangChain,
 * no LangGraph, zero runtime overhead from external agent frameworks.
 */

import type { WeaveAgentState, WeaveAgentRoute, WeaveGraphStep } from './weaveGraphState';
import {
  MAX_TOTAL_STEPS,
  systemMsg,
  userMsg,
} from './weaveGraphState';
import type { WeaveProgressCallback } from './weaveGraphState';
import {
  makeCallModelNode,
  makeExecuteToolNode,
  makeRepairNode,
  makeFinalizeNode,
  makeValidateNode,
  makeFailNode,
} from './weaveGraphNodes';
import { buildSystemPrompt, buildInitialUserTurn } from './weavePlanPrompts';
import type { WeaveContextToolRuntime } from './weaveContextService';
import type { WeaveRequestSessionLogger } from './weaveRequestLogger';
import type { WeaveHttpClient } from './weaveHttpClient';
import type { WeavePlanRequest, WeavePlanResult, WeaveErrorCategory } from '../vault-contract';
import type { WeaveContextSnapshot } from './weaveContextService';
import type { WeaveFullModelProfile } from './weaveModelProfiles';

export interface WeaveEffectiveBudget {
  promptToolCalls: number;
  runtimeNoteReads: number;
  maxRetrievedChars: number;
}

export function resolveWeaveEffectiveBudget(
  modelProfile: WeaveFullModelProfile,
  contextSnapshot: WeaveContextSnapshot,
): WeaveEffectiveBudget {
  const runtimeNoteReads = contextSnapshot.retrievalBudget.maxNoteReads;
  const promptToolCalls = Math.min(modelProfile.iterationLimit, Math.max(1, runtimeNoteReads));

  return {
    promptToolCalls,
    runtimeNoteReads,
    maxRetrievedChars: contextSnapshot.retrievalBudget.maxRetrievedChars,
  };
}

function sumOptional(a?: number, b?: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Merges two usage snapshots by summing each token field independently.
 *
 * Semantics:
 *  - If BOTH are undefined/missing, returns undefined (no usage data).
 *  - If only ONE is present, the other's fields are treated as 0 — so the
 *    returned object contains the values of the one that exists.
 *  - If BOTH are present, each token count is summed.
 *
 * This is intentionally non-commutative with undefined: when
 * `updates.accumulatedUsage` is explicitly set to `undefined` in a node
 * update, `updateState()` skips the merge entirely and preserves the old
 * value.  That is the intended behaviour — nodes that don't produce usage
 * data should never accidentally zero out accumulated counts.
 */
function mergeUsage(
  existing: WeavePlanResult['usage'],
  incoming: WeavePlanResult['usage'],
): WeavePlanResult['usage'] {
  if (!existing && !incoming) return undefined;
  return {
    promptTokens: sumOptional(existing?.promptTokens, incoming?.promptTokens),
    completionTokens: sumOptional(existing?.completionTokens, incoming?.completionTokens),
    totalTokens: sumOptional(existing?.totalTokens, incoming?.totalTokens),
  };
}

function updateState(state: WeaveAgentState, updates: Partial<WeaveAgentState>): WeaveAgentState {
  const nextMessages = updates.messages
    ? state.messages.concat(updates.messages)
    : state.messages;

  const nextTrace = updates.trace
    ? state.trace.concat(updates.trace)
    : state.trace;

  const nextUsage = updates.accumulatedUsage !== undefined
    ? mergeUsage(state.accumulatedUsage, updates.accumulatedUsage)
    : state.accumulatedUsage;

  return {
    ...state,
    ...updates,
    messages: nextMessages,
    accumulatedUsage: nextUsage,
    trace: nextTrace,
  };
}

function makeWeaveError(message: string, category: WeaveErrorCategory): Error {
  return Object.assign(new Error(message), { errorCategory: category });
}

// ── Transition table ──────────────────────────────────────────────────────────

/**
 * Pure function that resolves the next graph step from the current step
 * and the route set by the previous node.  Every transition is explicit,
 * exhaustiveness-checked, and easy to test in isolation.
 */
function resolveNextStep(current: WeaveGraphStep, state: WeaveAgentState): WeaveGraphStep {
  switch (current) {
    case 'callModel': {
      const route = state.pendingRoute;
      if (route === 'execute-tool') return 'executeTool';
      if (route === 'finalize') return 'finalize';
      if (
        route === 'repair-syntactic' ||
        route === 'repair-semantic' ||
        route === 'repair-exhaustion'
      ) {
        return 'repair';
      }
      return 'fail';
    }
    case 'executeTool':
      return 'callModel';
    case 'repair':
      return 'callModel';
    case 'finalize':
      return 'validate';
    case 'validate': {
      // Success: result is set, no route, no error
      if (state.result !== null && state.pendingRoute === null && state.errorMessage === null) {
        return 'done';
      }
      if (state.pendingRoute === 'repair-schema') return 'repair';
      return 'fail';
    }
    case 'fail':
      return 'done';
    default:
      return 'done';
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

/**
 * Runs the Weaver agent ReAct loop end-to-end.
 *
 * Builds initial messages from the model profile and context snapshot,
 * runs the sequential state machine with a hard step cap, and returns
 * the validated WeavePlanResult or throws a typed error.
 */
export async function runWeaveGraph(
  request: WeavePlanRequest,
  contextSnapshot: WeaveContextSnapshot,
  modelProfile: WeaveFullModelProfile,
  resolvedModel: string,
  httpClient: WeaveHttpClient,
  toolRuntime: WeaveContextToolRuntime,
  logger?: WeaveRequestSessionLogger,
  onProgress?: WeaveProgressCallback,
): Promise<WeavePlanResult> {
  const effectiveBudget = resolveWeaveEffectiveBudget(modelProfile, contextSnapshot);

  const initialMessages = [
    systemMsg(
      buildSystemPrompt(
        modelProfile,
        request.kind,
        effectiveBudget.promptToolCalls,
        effectiveBudget.runtimeNoteReads,
        effectiveBudget.maxRetrievedChars,
      ),
    ),
    userMsg(
      buildInitialUserTurn(request, contextSnapshot, effectiveBudget),
    ),
  ];

  if (logger) {
    await logger.log('graph-start', {
      model: resolvedModel,
      structuredOutputMode: modelProfile.structuredOutputMode,
      repairStrategy: modelProfile.repairStrategy,
      iterationLimit: modelProfile.iterationLimit,
      effectiveBudget,
      maxTokens: modelProfile.maxTokens,
      timeoutMs: modelProfile.timeoutMs,
      temperature: modelProfile.temperature,
    });
  }

  onProgress?.({ phase: 'graph-start', model: resolvedModel, toolBudget: effectiveBudget.promptToolCalls });

  // Instantiate the node handlers injected with dependencies
  const callModel = makeCallModelNode(httpClient, logger, onProgress);
  const executeTool = makeExecuteToolNode(toolRuntime, logger, onProgress);
  const repair = makeRepairNode(logger, onProgress);
  const finalize = makeFinalizeNode(logger, onProgress);
  const validate = makeValidateNode(logger, onProgress);
  const fail = makeFailNode(logger, onProgress);

  // Initialize the typed sequential state
  let state: WeaveAgentState = {
    request,
    contextSnapshot,
    modelProfile,
    resolvedModel,
    startTimeMs: Date.now(),
    messages: initialMessages,
    toolCallCount: 0,
    repairAttemptCount: 0,
    pendingRoute: null,
    pendingToolName: null,
    pendingThought: null,
    pendingToolArgs: null,
    pendingPlanData: null,
    lastRawContent: '',
    accumulatedUsage: undefined,
    result: null,
    errorMessage: null,
    errorCategory: null,
    trace: [],
  };

  let step: WeaveGraphStep = 'callModel';
  let stepCount = 0;

  while (step !== 'done') {
    stepCount += 1;

    // Hard cap — prevents infinite oscillation between repair & callModel
    if (stepCount > MAX_TOTAL_STEPS) {
      state = updateState(state, {
        pendingRoute: 'fail' as WeaveAgentRoute,
        errorMessage: `Weaver exceeded the maximum ${MAX_TOTAL_STEPS} loop steps.`,
        errorCategory: 'provider-error' as WeaveErrorCategory,
      });
      step = 'fail';
    }

    switch (step) {
      case 'callModel': {
        const updates = await callModel(state);
        state = updateState(state, updates);
        break;
      }
      case 'executeTool': {
        const updates = await executeTool(state);
        state = updateState(state, updates);
        break;
      }
      case 'repair': {
        const updates = repair(state);
        state = updateState(state, updates);
        break;
      }
      case 'finalize': {
        const updates = finalize(state);
        state = updateState(state, updates);
        break;
      }
      case 'validate': {
        const updates = validate(state);
        state = updateState(state, updates);
        break;
      }
      case 'fail': {
        const updates = await fail(state);
        state = updateState(state, updates);
        break;
      }
    }

    step = resolveNextStep(step, state);
  }

  if (state.result !== null) {
    if (logger) {
      await logger.log('graph-complete', {
        success: true,
        operations: state.result.plan.operations.length,
        usage: state.result.usage,
        latencyMs: state.result.latencyMs,
        toolCallCount: state.toolCallCount,
        repairAttemptCount: state.repairAttemptCount,
        totalSteps: stepCount,
      });
    }
    onProgress?.({ phase: 'graph-complete', operations: state.result.plan.operations.length, latencyMs: state.result.latencyMs });
    return state.result;
  }

  const errorMessage = state.errorMessage ?? 'Weaver encountered an unexpected error.';
  const errorCategory = state.errorCategory ?? ('provider-error' as WeaveErrorCategory);

  if (logger) {
    await logger.log('graph-complete', {
      success: false,
      errorMessage,
      errorCategory,
      toolCallCount: state.toolCallCount,
      repairAttemptCount: state.repairAttemptCount,
      totalSteps: stepCount,
    });
  }

  throw makeWeaveError(errorMessage, errorCategory);
}

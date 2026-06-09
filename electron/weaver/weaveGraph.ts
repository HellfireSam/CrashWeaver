/**
 * weaveGraph.ts
 *
 * Fully type-safe, robust sequential ReAct loop for the Weaver planner.
 * Uses a pure procedural state machine instead of LangGraph to achieve
 * high reliability, complete control over history, and zero runtime overhead.
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { WeaveAgentState, WeaveAgentRoute } from './weaveGraphState';
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
import type { WeaveHttpClient } from './openRouterClient';
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

/**
 * Runs the Weaver agent ReAct loop end-to-end.
 *
 * Builds initial messages from the model profile and context snapshot,
 * runs the sequential state machine, and returns the validated WeavePlanResult
 * or throws a typed error.
 */
export async function runWeaveGraph(
  request: WeavePlanRequest,
  contextSnapshot: WeaveContextSnapshot,
  modelProfile: WeaveFullModelProfile,
  resolvedModel: string,
  httpClient: WeaveHttpClient,
  toolRuntime: WeaveContextToolRuntime,
  logger?: WeaveRequestSessionLogger,
): Promise<WeavePlanResult> {
  const effectiveBudget = resolveWeaveEffectiveBudget(modelProfile, contextSnapshot);

  const systemMsg = new SystemMessage(
    buildSystemPrompt(
      modelProfile,
      effectiveBudget.promptToolCalls,
      effectiveBudget.runtimeNoteReads,
      effectiveBudget.maxRetrievedChars,
    ),
  );
  const userMsg = new HumanMessage(
    buildInitialUserTurn(request, contextSnapshot, effectiveBudget),
  );

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

  // Instantiate the node handlers injected with dependencies
  const callModel = makeCallModelNode(httpClient, logger);
  const executeTool = makeExecuteToolNode(toolRuntime, logger);
  const repair = makeRepairNode(logger);
  const finalize = makeFinalizeNode(logger);
  const validate = makeValidateNode(logger);
  const fail = makeFailNode(logger);

  // Initialize the typed sequential state
  let state: WeaveAgentState = {
    request,
    contextSnapshot,
    modelProfile,
    resolvedModel,
    startTimeMs: Date.now(),
    messages: [systemMsg, userMsg],
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

  let currentStep = 'callModel';

  while (true) {
    if (currentStep === 'callModel') {
      const updates = await callModel(state);
      state = updateState(state, updates);

      const route = state.pendingRoute;
      if (route === 'execute-tool') {
        currentStep = 'executeTool';
      } else if (route === 'finalize') {
        currentStep = 'finalize';
      } else if (
        route === 'repair-syntactic' ||
        route === 'repair-semantic' ||
        route === 'repair-exhaustion'
      ) {
        currentStep = 'repair';
      } else {
        currentStep = 'fail';
      }
    } else if (currentStep === 'executeTool') {
      const updates = await executeTool(state);
      state = updateState(state, updates);
      currentStep = 'callModel';
    } else if (currentStep === 'repair') {
      const updates = repair(state);
      state = updateState(state, updates);
      currentStep = 'callModel';
    } else if (currentStep === 'finalize') {
      const updates = finalize(state);
      state = updateState(state, updates);
      currentStep = 'validate';
    } else if (currentStep === 'validate') {
      const updates = validate(state);
      state = updateState(state, updates);

      if (state.result !== null && state.pendingRoute === null && state.errorMessage === null) {
        break;
      } else if (state.pendingRoute === 'repair-schema') {
        currentStep = 'repair';
      } else {
        currentStep = 'fail';
      }
    } else if (currentStep === 'fail') {
      const updates = await fail(state);
      state = updateState(state, updates);
      break;
    } else {
      break;
    }
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
      });
    }
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
    });
  }

  throw makeWeaveError(errorMessage, errorCategory);
}

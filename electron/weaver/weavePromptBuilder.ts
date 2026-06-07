/**
 * weavePromptBuilder.ts  — COMPAT SHIM LAYER
 *
 * The original monolithic prompt builder has been superseded by the composable
 * layers in weavePlanPrompts.ts and the model profile registry in weaveModelProfiles.ts.
 *
 * These exports are kept for backward-compatibility with existing tests and any
 * callers that have not yet migrated. They delegate to the new modules.
 */

import type { WeavePlanRequest } from '../vault-contract';
import type { WeaveContextSnapshot } from './weaveContextService';
import { resolveFullModelProfile } from './weaveModelProfiles';
import {
  buildSystemPrompt,
  buildRequestSpecification,
  buildInitialUserTurn,
  buildObservationMessage,
} from './weavePlanPrompts';

/** Minimal dummy request used only to resolve execution budgets in compat shims. */
function dummyRequest(): WeavePlanRequest {
  return {
    kind: 'guided-insert',
    cardUid: 'compat-shim',
    permissions: { editContent: false, createNote: false },
    vaultPath: '',
    crashpadPath: '',
  } as unknown as WeavePlanRequest;
}

/** @deprecated Use buildSystemPrompt() from weavePlanPrompts.ts directly. */
export function buildSystemInstruction(modelId?: string): string {
  const profile = resolveFullModelProfile(modelId ?? 'openai/gpt-4o', dummyRequest());
  return buildSystemPrompt(profile, 4);
}

/** @deprecated Use buildRequestSpecification() from weavePlanPrompts.ts directly. */
export function buildUserMessage(request: WeavePlanRequest): string {
  return buildRequestSpecification(request);
}

/** @deprecated Use buildSystemPrompt() from weavePlanPrompts.ts directly. */
export function buildToolLoopSystemInstruction(maxToolCalls: number, modelId?: string): string {
  const profile = resolveFullModelProfile(modelId ?? 'openai/gpt-4o', dummyRequest());
  return buildSystemPrompt(profile, maxToolCalls);
}

/** @deprecated Use buildInitialUserTurn() from weavePlanPrompts.ts directly. */
export function buildToolLoopUserMessage(
  request: WeavePlanRequest,
  snapshot: WeaveContextSnapshot,
  maxToolCalls: number,
): string {
  return buildInitialUserTurn(request, snapshot, maxToolCalls);
}

/** @deprecated Use buildObservationMessage() from weavePlanPrompts.ts directly. */
export function buildToolLoopResultMessage(toolName: string, result: unknown): string {
  return buildObservationMessage(toolName, result, 0);
}

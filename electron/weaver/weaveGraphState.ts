/**
 * weaveGraphState.ts
 *
 * Typed state model for the procedural Weaver agent loop.
 *
 * The runtime loop in weaveGraph.ts is fully manual/procedural, so this file
 * now exposes a plain TypeScript interface instead of LangGraph annotations.
 */

import type { BaseMessage } from '@langchain/core/messages';
import type {
  WeavePlanRequest,
  WeavePlanResult,
  WeaveErrorCategory,
  WeaveReActStep,
} from '../vault-contract';
import type { WeaveContextSnapshot } from './weaveContextService';
import type { WeaveFullModelProfile } from './weaveModelProfiles';

// ── Route identifiers ─────────────────────────────────────────────────────────

export type WeaveAgentRoute =
  | 'execute-tool'
  | 'finalize'
  | 'repair-syntactic'
  | 'repair-semantic'
  | 'repair-schema'
  | 'repair-exhaustion'
  | 'fail';

export interface WeaveAgentState {
  // Inputs
  request: WeavePlanRequest;
  contextSnapshot: WeaveContextSnapshot;
  modelProfile: WeaveFullModelProfile;
  resolvedModel: string;
  startTimeMs: number;

  // Conversation state
  messages: BaseMessage[];

  // Execution counters
  toolCallCount: number;
  repairAttemptCount: number;

  // Inter-node communication
  pendingRoute: WeaveAgentRoute | null;
  pendingToolName: string | null;
  pendingThought: string | null;
  pendingToolArgs: Record<string, unknown> | null;
  pendingPlanData: unknown;
  lastRawContent: string;

  // Metrics and terminal outputs
  accumulatedUsage: WeavePlanResult['usage'] | undefined;
  result: WeavePlanResult | null;
  trace: WeaveReActStep[];
  errorMessage: string | null;
  errorCategory: WeaveErrorCategory | null;
}

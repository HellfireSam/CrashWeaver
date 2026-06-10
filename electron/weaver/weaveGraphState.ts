/**
 * weaveGraphState.ts
 *
 * Typed state model for the procedural Weaver agent loop.
 *
 * Uses lightweight native types — no LangChain dependency.
 * The runtime loop in weaveGraph.ts is a pure procedural state machine.
 */

import type {
  WeavePlanRequest,
  WeavePlanResult,
  WeaveErrorCategory,
  WeaveReActStep,
} from '../vault-contract';
import type { WeaveContextSnapshot } from './weaveContextService';
import type { WeaveFullModelProfile } from './weaveModelProfiles';

// ── Lightweight message type (replaces LangChain BaseMessage) ─────────────────

export interface WeaveMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ── Graph step identifiers ────────────────────────────────────────────────────

export type WeaveGraphStep = 'callModel' | 'executeTool' | 'repair' | 'finalize' | 'validate' | 'fail' | 'done';

// ── Route identifiers ─────────────────────────────────────────────────────────

export type WeaveAgentRoute =
  | 'execute-tool'
  | 'finalize'
  | 'repair-syntactic'
  | 'repair-semantic'
  | 'repair-schema'
  | 'repair-exhaustion'
  | 'fail';

// ── Budget guard constants ────────────────────────────────────────────────────

/** Minimum wall-clock ms the loop must keep available for a finalisation attempt. */
export const MIN_REMAINING_TIME_MS = 10_000;

/** Hard cap on total loop iterations (tool calls + repair attempts) to prevent infinite oscillation. */
export const MAX_TOTAL_STEPS = 24;

// ── Agent state ───────────────────────────────────────────────────────────────

export interface WeaveAgentState {
  // ── Inputs (immutable after initialisation) ─────────────────────────────────
  request: WeavePlanRequest;
  contextSnapshot: WeaveContextSnapshot;
  modelProfile: WeaveFullModelProfile;
  resolvedModel: string;
  startTimeMs: number;

  // ── Conversation ────────────────────────────────────────────────────────────
  messages: WeaveMessage[];

  // ── Execution counters ──────────────────────────────────────────────────────
  toolCallCount: number;
  repairAttemptCount: number;

  // ── Inter-node communication (cleared after each transition) ────────────────
  pendingRoute: WeaveAgentRoute | null;
  pendingToolName: string | null;
  pendingThought: string | null;
  pendingToolArgs: Record<string, unknown> | null;
  pendingPlanData: unknown;
  lastRawContent: string;

  // ── Accumulated metrics ─────────────────────────────────────────────────────
  accumulatedUsage: WeavePlanResult['usage'] | undefined;
  trace: WeaveReActStep[];

  // ── Terminal outputs ────────────────────────────────────────────────────────
  result: WeavePlanResult | null;
  errorMessage: string | null;
  errorCategory: WeaveErrorCategory | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a system message. */
export function systemMsg(content: string): WeaveMessage {
  return { role: 'system', content };
}

/** Create a user message. */
export function userMsg(content: string): WeaveMessage {
  return { role: 'user', content };
}

/** Create an assistant (AI) message. */
export function assistantMsg(content: string): WeaveMessage {
  return { role: 'assistant', content };
}

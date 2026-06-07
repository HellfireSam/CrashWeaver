/**
 * weaveModelProfiles.ts
 *
 * Extended model profile registry for the Weaver agent loop.
 * Combines model-specific behaviour (structured output mode, prompt overlays,
 * repair strategy) with per-request execution budgets (tokens, timeout,
 * temperature, iteration limit).
 *
 * This is the canonical source for model-driven execution policy.
 * weaveCostPolicy.ts retains resolveModel() and backward-compat helpers.
 */

import type { WeavePlanRequest, WeaveStrength, WeaverSettings } from '../vault-contract';

// ── Types ────────────────────────────────────────────────────────────────────

export type WeaveStructuredOutputMode = 'json_mode' | 'fences_and_braces';

export type WeaveRepairStrategy = 'aggressive' | 'conservative';

export interface WeaveFullModelProfile {
  /** How to request/extract structured JSON from this model family. */
  structuredOutputMode: WeaveStructuredOutputMode;
  /** Model-specific instructions appended to the system prompt. */
  systemPromptOverlay: string;
  /** How aggressively to attempt JSON/schema repair turns. */
  repairStrategy: WeaveRepairStrategy;
  /** Max completion tokens for this request. */
  maxTokens: number;
  /** Per-request wall-clock timeout in milliseconds. */
  timeoutMs: number;
  /** Sampling temperature. */
  temperature: number;
  /** Max allowed read-only tool calls before forcing finalization. */
  iterationLimit: number;
  /**
   * Extra params merged into the HTTP request body for structured output.
   * e.g. { response_format: { type: 'json_object' } } for OpenAI json_mode.
   */
  responseFormatParams?: Record<string, unknown>;
}

// ── Model pattern matching ────────────────────────────────────────────────────

function isOpenAiGpt(id: string): boolean {
  return /gpt-4o|gpt-4-o|gpt-3\.5/i.test(id);
}

function isOpenAiReasoning(id: string): boolean {
  return /openai\/o[134]/i.test(id);
}

function isClaude(id: string): boolean {
  return /claude|anthropic/i.test(id);
}

// ── Model-specific profile helpers ────────────────────────────────────────────

function resolveStructuredOutputMode(modelId: string): WeaveStructuredOutputMode {
  if (isOpenAiGpt(modelId) || isOpenAiReasoning(modelId)) {
    return 'json_mode';
  }
  return 'fences_and_braces';
}

function resolveSystemPromptOverlay(modelId: string): string {
  if (isOpenAiGpt(modelId) || isOpenAiReasoning(modelId)) {
    return (
      'You must respond with valid JSON only. ' +
      'Every response is a raw JSON object — no prose, no markdown fences, no trailing text.'
    );
  }
  if (isClaude(modelId)) {
    return (
      'You are in structured JSON-only mode. ' +
      'Every response must be a single JSON object matching the required schema. ' +
      'You may use <thinking>...</thinking> for private reasoning before outputting JSON. ' +
      'Your final output must be a bare JSON object with no surrounding prose or markdown.'
    );
  }
  return 'Respond with only a raw JSON object. No prose, no markdown code fences, no surrounding text.';
}

function resolveRepairStrategy(modelId: string): WeaveRepairStrategy {
  // Claude tends to over-generate; conservative strategy limits repair turns.
  return isClaude(modelId) ? 'conservative' : 'aggressive';
}

function resolveResponseFormatParams(mode: WeaveStructuredOutputMode): Record<string, unknown> | undefined {
  if (mode === 'json_mode') {
    // Enables OpenAI JSON mode — model is guaranteed to emit valid JSON.
    return { response_format: { type: 'json_object' } };
  }
  return undefined;
}

// ── Execution budget tables ───────────────────────────────────────────────────

const GUIDED_INSERT_BASE = {
  maxTokens: 1400,
  timeoutMs: 30_000,
  temperature: 0.1,
  iterationLimit: 3,
} as const;

const GUIDED_INSERT_EXPANDED = {
  maxTokens: 2200,
  timeoutMs: 45_000,
  temperature: 0.2,
  iterationLimit: 4,
} as const;

const INTELLIGENT_BUDGETS: Record<
  WeaveStrength,
  { maxTokens: number; timeoutMs: number; temperature: number; iterationLimit: number }
> = {
  light: { maxTokens: 1500, timeoutMs: 30_000, temperature: 0.18, iterationLimit: 2 },
  standard: { maxTokens: 3000, timeoutMs: 60_000, temperature: 0.3, iterationLimit: 4 },
  'go-ham': { maxTokens: 6000, timeoutMs: 120_000, temperature: 0.5, iterationLimit: 6 },
};

function resolveBudget(request: WeavePlanRequest, settings?: WeaverSettings | null) {
  if (settings?.disableBudgetRestrictions) {
    return {
      maxTokens: 100000,
      timeoutMs: 600000,
      temperature: request.kind === 'guided-insert' ? 0.15 : (request.strength === 'go-ham' ? 0.5 : request.strength === 'standard' ? 0.3 : 0.18),
      iterationLimit: 100,
    };
  }

  if (request.kind === 'guided-insert') {
    const expanded = request.permissions.editContent || request.permissions.createNote;
    if (expanded) {
      return {
        maxTokens: settings?.guidedInsertExpandedMaxTokens ?? GUIDED_INSERT_EXPANDED.maxTokens,
        timeoutMs: settings?.guidedInsertExpandedTimeoutMs ?? GUIDED_INSERT_EXPANDED.timeoutMs,
        temperature: GUIDED_INSERT_EXPANDED.temperature,
        iterationLimit: GUIDED_INSERT_EXPANDED.iterationLimit,
      };
    } else {
      return {
        maxTokens: settings?.guidedInsertBaseMaxTokens ?? GUIDED_INSERT_BASE.maxTokens,
        timeoutMs: settings?.guidedInsertBaseTimeoutMs ?? GUIDED_INSERT_BASE.timeoutMs,
        temperature: GUIDED_INSERT_BASE.temperature,
        iterationLimit: GUIDED_INSERT_BASE.iterationLimit,
      };
    }
  }

  const s = request.strength;
  const defaults = INTELLIGENT_BUDGETS[s];

  let maxTokens = defaults.maxTokens;
  let timeoutMs = defaults.timeoutMs;
  let iterationLimit = defaults.iterationLimit;

  if (s === 'light') {
    maxTokens = settings?.intelligentLightMaxTokens ?? defaults.maxTokens;
    timeoutMs = settings?.intelligentLightTimeoutMs ?? defaults.timeoutMs;
    iterationLimit = settings?.intelligentLightIterationLimit ?? defaults.iterationLimit;
  } else if (s === 'standard') {
    maxTokens = settings?.intelligentStandardMaxTokens ?? defaults.maxTokens;
    timeoutMs = settings?.intelligentStandardTimeoutMs ?? defaults.timeoutMs;
    iterationLimit = settings?.intelligentStandardIterationLimit ?? defaults.iterationLimit;
  } else if (s === 'go-ham') {
    maxTokens = settings?.intelligentGoHamMaxTokens ?? defaults.maxTokens;
    timeoutMs = settings?.intelligentGoHamTimeoutMs ?? defaults.timeoutMs;
    iterationLimit = settings?.intelligentGoHamIterationLimit ?? defaults.iterationLimit;
  }

  return {
    maxTokens,
    timeoutMs,
    temperature: defaults.temperature,
    iterationLimit,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolves the full model profile for a given model ID and request.
 * Combines model-specific config with the per-request execution budget.
 */
export function resolveFullModelProfile(
  modelId: string,
  request: WeavePlanRequest,
  settings?: WeaverSettings | null,
): WeaveFullModelProfile {
  const structuredOutputMode = resolveStructuredOutputMode(modelId);
  const budget = resolveBudget(request, settings);

  return {
    structuredOutputMode,
    systemPromptOverlay: resolveSystemPromptOverlay(modelId),
    repairStrategy: resolveRepairStrategy(modelId),
    responseFormatParams: resolveResponseFormatParams(structuredOutputMode),
    ...budget,
  };
}

/**
 * Resolves only the model-specific properties without a request budget.
 * Useful for prompt building when budget is not yet known.
 */
export function resolveModelOnlyProfile(
  modelId: string,
): Pick<WeaveFullModelProfile, 'structuredOutputMode' | 'systemPromptOverlay' | 'repairStrategy'> {
  const structuredOutputMode = resolveStructuredOutputMode(modelId);
  return {
    structuredOutputMode,
    systemPromptOverlay: resolveSystemPromptOverlay(modelId),
    repairStrategy: resolveRepairStrategy(modelId),
  };
}

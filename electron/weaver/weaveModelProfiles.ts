/**
 * weaveModelProfiles.ts
 *
 * Canonical model profile registry for the Weaver agent loop.
 * Combines model resolution (UI-tier shortcuts → OpenRouter IDs), model-specific
 * behaviour (structured output mode, prompt overlays, repair strategy), and
 * per-request execution budgets (tokens, timeout, temperature, iteration limit).
 *
 * This is the single source of truth for model-driven execution policy.
 */

import type { WeavePlanRequest, WeaveStrength, WeaverSettings } from '../vault-contract';

// ── Model resolution ──────────────────────────────────────────────────────────

/** Maps compact UI model shortcuts to actual OpenRouter model IDs. */
export const DEFAULT_MODEL_BY_UI_TIER: Record<string, string> = {
  'cw-fast': 'openai/gpt-4o-mini',
  'cw-balanced': 'openai/gpt-4o',
  'cw-deep': 'anthropic/claude-sonnet-4-5',
};

const DEFAULT_FALLBACK_MODEL = DEFAULT_MODEL_BY_UI_TIER['cw-balanced'];

function normalizeModelCandidate(candidate?: string | null) {
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

/**
 * Resolve the actual OpenRouter model ID from the explicit request model
 * or persisted preference. Falls back to a safe balanced default if neither is present.
 */
export function resolveModel(
  explicitModel?: string,
  preferredModel?: string | null,
): string {
  const resolvedModel = normalizeModelCandidate(explicitModel) ?? normalizeModelCandidate(preferredModel);

  if (!resolvedModel) {
    return DEFAULT_FALLBACK_MODEL;
  }

  if (resolvedModel.includes('/')) {
    return resolvedModel;
  }

  return DEFAULT_MODEL_BY_UI_TIER[resolvedModel] ?? resolvedModel;
}

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

// ── Budget Validation Bounds ──────────────────────────────────────────────────

/**
 * Hard limits for budget override settings to prevent system instability.
 * Enforced server-side to protect against UI or network manipulation.
 */
export const BUDGET_VALIDATION_BOUNDS = {
  // Token budgets
  minTokens: 100,
  maxTokens: 32_000,
  
  // Timeout budgets
  minTimeoutMs: 5_000,     // 5 seconds minimum
  maxTimeoutMs: 600_000,   // 10 minutes maximum
  
  // Iteration limits
  minIterations: 1,
  maxIterations: 20,
} as const;

/**
 * Validates and clamps a numeric budget value to safe bounds.
 */
export function validateAndClampBudgetValue(
  value: unknown,
  fieldName: string,
  bounds: { min: number; max: number },
): number {
  if (value === null || value === undefined) {
    return bounds.min; // Use minimum as default
  }

  const num = Number(value);

  if (!Number.isFinite(num)) {
    throw new Error(`${fieldName} must be a finite number, got ${String(value)}`);
  }

  if (num < bounds.min || num > bounds.max) {
    console.warn(
      `CrashWeaver: ${fieldName} clamped from ${num} to [${bounds.min}, ${bounds.max}]`,
    );
    return Math.max(bounds.min, Math.min(bounds.max, num));
  }

  return num;
}

// ── Model pattern matching ────────────────────────────────────────────────────

/**
 * Extracts the provider prefix from an OpenRouter model ID.
 * e.g. "openai/gpt-4o" → "openai", "anthropic/claude-sonnet-4-5" → "anthropic"
 * Falls back to the full ID if no slash is present.
 */
function extractProviderPrefix(modelId: string): string {
  const slashIndex = modelId.indexOf('/');
  return slashIndex >= 0 ? modelId.slice(0, slashIndex).toLowerCase() : modelId.toLowerCase();
}

/**
 * Provider families known to support native JSON mode via `response_format`.
 * These providers guarantee valid JSON in their output.
 */
const JSON_MODE_PROVIDERS = new Set([
  'openai',
  'google',
  'deepseek',
  'x-ai',
]);

/**
 * Provider families for Anthropic/Claude models.
 * These require a different prompt overlay and use conservative repair.
 */
const CLAUDE_PROVIDERS = new Set([
  'anthropic',
]);

// ── Model-specific profile helpers ────────────────────────────────────────────

function resolveStructuredOutputMode(modelId: string): WeaveStructuredOutputMode {
  const provider = extractProviderPrefix(modelId);
  if (JSON_MODE_PROVIDERS.has(provider)) {
    return 'json_mode';
  }
  return 'fences_and_braces';
}

function resolveSystemPromptOverlay(modelId: string): string {
  const provider = extractProviderPrefix(modelId);

  if (CLAUDE_PROVIDERS.has(provider)) {
    return (
      'You are in structured JSON-only mode. ' +
      'Every response must be a single JSON object matching the required schema. ' +
      'You may use <thinking>...</thinking> for private reasoning before outputting JSON. ' +
      'Your final output must be a bare JSON object with no surrounding prose or markdown.'
    );
  }

  if (JSON_MODE_PROVIDERS.has(provider)) {
    return (
      'You must respond with valid JSON only. ' +
      'Every response is a raw JSON object — no prose, no markdown fences, no trailing text.'
    );
  }

  // Unknown provider: conservative fallback
  return 'Respond with only a raw JSON object. No prose, no markdown code fences, no surrounding text.';
}

function resolveRepairStrategy(modelId: string): WeaveRepairStrategy {
  // Claude models tend to over-generate; conservative strategy limits repair turns.
  const provider = extractProviderPrefix(modelId);
  return CLAUDE_PROVIDERS.has(provider) ? 'conservative' : 'aggressive';
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
      maxTokens: BUDGET_VALIDATION_BOUNDS.maxTokens,
      timeoutMs: BUDGET_VALIDATION_BOUNDS.maxTimeoutMs,
      temperature: request.kind === 'guided-insert' ? 0.15 : (request.strength === 'go-ham' ? 0.5 : request.strength === 'standard' ? 0.3 : 0.18),
      // When unrestricted, allow up to 200 tool calls (still has a safety cap)
      iterationLimit: 200,
    };
  }

  if (request.kind === 'guided-insert') {
    const expanded = request.permissions.editContent || request.permissions.createNote;
    if (expanded) {
      const maxTokens = validateAndClampBudgetValue(
        settings?.guidedInsertExpandedMaxTokens ?? GUIDED_INSERT_EXPANDED.maxTokens,
        'guidedInsertExpandedMaxTokens',
        { min: BUDGET_VALIDATION_BOUNDS.minTokens, max: BUDGET_VALIDATION_BOUNDS.maxTokens },
      );
      const timeoutMs = validateAndClampBudgetValue(
        settings?.guidedInsertExpandedTimeoutMs ?? GUIDED_INSERT_EXPANDED.timeoutMs,
        'guidedInsertExpandedTimeoutMs',
        { min: BUDGET_VALIDATION_BOUNDS.minTimeoutMs, max: BUDGET_VALIDATION_BOUNDS.maxTimeoutMs },
      );
      return {
        maxTokens,
        timeoutMs,
        temperature: GUIDED_INSERT_EXPANDED.temperature,
        iterationLimit: GUIDED_INSERT_EXPANDED.iterationLimit,
      };
    } else {
      const maxTokens = validateAndClampBudgetValue(
        settings?.guidedInsertBaseMaxTokens ?? GUIDED_INSERT_BASE.maxTokens,
        'guidedInsertBaseMaxTokens',
        { min: BUDGET_VALIDATION_BOUNDS.minTokens, max: BUDGET_VALIDATION_BOUNDS.maxTokens },
      );
      const timeoutMs = validateAndClampBudgetValue(
        settings?.guidedInsertBaseTimeoutMs ?? GUIDED_INSERT_BASE.timeoutMs,
        'guidedInsertBaseTimeoutMs',
        { min: BUDGET_VALIDATION_BOUNDS.minTimeoutMs, max: BUDGET_VALIDATION_BOUNDS.maxTimeoutMs },
      );
      return {
        maxTokens,
        timeoutMs,
        temperature: GUIDED_INSERT_BASE.temperature,
        iterationLimit: GUIDED_INSERT_BASE.iterationLimit,
      };
    }
  }

  const s = request.strength;
  const defaults = INTELLIGENT_BUDGETS[s];

  const maxTokens = validateAndClampBudgetValue(
    s === 'light'
      ? settings?.intelligentLightMaxTokens ?? defaults.maxTokens
      : s === 'standard'
        ? settings?.intelligentStandardMaxTokens ?? defaults.maxTokens
        : settings?.intelligentGoHamMaxTokens ?? defaults.maxTokens,
    `intelligent${s}MaxTokens`,
    { min: BUDGET_VALIDATION_BOUNDS.minTokens, max: BUDGET_VALIDATION_BOUNDS.maxTokens },
  );

  const timeoutMs = validateAndClampBudgetValue(
    s === 'light'
      ? settings?.intelligentLightTimeoutMs ?? defaults.timeoutMs
      : s === 'standard'
        ? settings?.intelligentStandardTimeoutMs ?? defaults.timeoutMs
        : settings?.intelligentGoHamTimeoutMs ?? defaults.timeoutMs,
    `intelligent${s}TimeoutMs`,
    { min: BUDGET_VALIDATION_BOUNDS.minTimeoutMs, max: BUDGET_VALIDATION_BOUNDS.maxTimeoutMs },
  );

  const iterationLimit = validateAndClampBudgetValue(
    s === 'light'
      ? settings?.intelligentLightIterationLimit ?? defaults.iterationLimit
      : s === 'standard'
        ? settings?.intelligentStandardIterationLimit ?? defaults.iterationLimit
        : settings?.intelligentGoHamIterationLimit ?? defaults.iterationLimit,
    `intelligent${s}IterationLimit`,
    { min: BUDGET_VALIDATION_BOUNDS.minIterations, max: BUDGET_VALIDATION_BOUNDS.maxIterations },
  );

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

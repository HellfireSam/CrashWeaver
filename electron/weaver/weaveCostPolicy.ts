import type { WeavePlanRequest, WeaveStrength } from '../vault-contract';

/**
 * Maps compact UI model shortcuts to actual OpenRouter model IDs.
 */
export const DEFAULT_MODEL_BY_UI_TIER: Record<string, string> = {
  'cw-fast': 'openai/gpt-4o-mini',
  'cw-balanced': 'openai/gpt-4o',
  'cw-deep': 'anthropic/claude-sonnet-4-5',
};

const DEFAULT_FALLBACK_MODEL = DEFAULT_MODEL_BY_UI_TIER['cw-balanced'];
const GUIDED_INSERT_BASE_MAX_TOKENS = 1400;
const GUIDED_INSERT_EXPANDED_MAX_TOKENS = 2200;
const GUIDED_INSERT_BASE_TIMEOUT_MS = 30_000;
const GUIDED_INSERT_EXPANDED_TIMEOUT_MS = 45_000;

export type WeaveStructuredOutputMode = 'json_schema' | 'json_mode' | 'fences_and_braces';

export interface WeaveModelProfile {
  maxTokens: number;
  timeoutMs: number;
  temperature: number;
  iterationLimit: number;
  structuredOutputMode: WeaveStructuredOutputMode;
  systemPromptOverlay?: string;
}

/**
 * Token budget per intelligent strength level.
 */
export const INTELLIGENT_MAX_TOKENS_BY_STRENGTH: Record<WeaveStrength, number> = {
  light: 1500,
  standard: 3000,
  'go-ham': 6000,
};

/**
 * Per-request timeout per intelligent strength level.
 */
export const INTELLIGENT_TIMEOUT_MS_BY_STRENGTH: Record<WeaveStrength, number> = {
  light: 30_000,
  standard: 60_000,
  'go-ham': 120_000,
};

export const INTELLIGENT_ITERATION_LIMIT_BY_STRENGTH: Record<WeaveStrength, number> = {
  light: 2,
  standard: 4,
  'go-ham': 6,
};

function normalizeModelCandidate(candidate?: string | null) {
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

/**
 * Resolve the actual OpenRouter model ID from the explicit request model or persisted preference.
 * Falls back to a safe balanced default if neither is present.
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

/**
 * Resolves model-specific structured output and prompt instruction tweaks.
 */
export function getModelProfile(modelId: string): {
  structuredOutputMode: WeaveStructuredOutputMode;
  systemPromptOverlay?: string;
} {
  const lowerId = modelId.toLowerCase();
  
  if (lowerId.includes('gpt-4o') || lowerId.includes('gpt-4-o') || lowerId.includes('openai/o1') || lowerId.includes('openai/o3')) {
    return {
      structuredOutputMode: 'json_schema',
      systemPromptOverlay: 'Optimize response generation for OpenAI structured outputs with strict compliance with properties.',
    };
  }
  
  if (lowerId.includes('claude') || lowerId.includes('anthropic')) {
    return {
      structuredOutputMode: 'fences_and_braces',
      systemPromptOverlay: 'Optimize formatting for Claude. Use a clear step-by-step thinking process in thoughts if needed, and encapsulate final JSON in standard markdown JSON blocks.',
    };
  }

  return {
    structuredOutputMode: 'json_mode',
    systemPromptOverlay: 'Ensure the output is robustly structured and completely parseable as raw JSON.',
  };
}

export function getRequestExecutionBudget(request: WeavePlanRequest): WeaveModelProfile {
  const modelId = resolveModel(request.preferredModel, undefined);
  const profileDetails = getModelProfile(modelId);

  if (request.kind === 'guided-insert') {
    const needsExpandedBudget = request.permissions.editContent || request.permissions.createNote;

    return {
      maxTokens: needsExpandedBudget ? GUIDED_INSERT_EXPANDED_MAX_TOKENS : GUIDED_INSERT_BASE_MAX_TOKENS,
      timeoutMs: needsExpandedBudget ? GUIDED_INSERT_EXPANDED_TIMEOUT_MS : GUIDED_INSERT_BASE_TIMEOUT_MS,
      temperature: needsExpandedBudget ? 0.2 : 0.1,
      iterationLimit: 1,
      structuredOutputMode: profileDetails.structuredOutputMode,
      systemPromptOverlay: profileDetails.systemPromptOverlay,
    };
  }

  return {
    maxTokens: INTELLIGENT_MAX_TOKENS_BY_STRENGTH[request.strength],
    timeoutMs: INTELLIGENT_TIMEOUT_MS_BY_STRENGTH[request.strength],
    temperature: request.strength === 'go-ham' ? 0.5 : request.strength === 'standard' ? 0.3 : 0.18,
    iterationLimit: INTELLIGENT_ITERATION_LIMIT_BY_STRENGTH[request.strength],
    structuredOutputMode: profileDetails.structuredOutputMode,
    systemPromptOverlay: profileDetails.systemPromptOverlay,
  };
}

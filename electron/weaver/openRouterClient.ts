/**
 * openRouterClient.ts
 *
 * OpenRouter provider implementation for the Weaver agent loop.
 *
 * Public surface (unchanged from Stage 5):
 *   - WeaveHttpClient interface      — lightweight HTTP contract used by graph nodes
 *   - OpenRouterHttpClient class     — implements WeaveHttpClient via Electron net.fetch
 *   - OpenRouterWeaveProvider class  — implements WeaveModelProvider, delegates to runWeaveGraph
 *
 * The imperative while-loop, manual JSON extraction, and inline repair logic
 * from the previous implementation have been retired. Orchestration now lives
 * entirely in the LangGraph-based weaveGraph.ts.
 */

import { net } from 'electron';
import { createHash } from 'crypto';
import type {
  WeavePlanRequest,
  WeavePlanResult,
  WeaveErrorCategory,
  WeaveModelInfo,
  WeaveModelProvider,
  WeaveProviderHealth,
} from '../vault-contract';
import { getWeaverSettings } from '../settingsService';
import { resolveModel } from './weaveCostPolicy';
import { resolveFullModelProfile } from './weaveModelProfiles';
import { createWeaveRequestSessionLogger, type WeaveRequestSessionLogger } from './weaveRequestLogger';
import {
  buildWeaveContextSnapshot,
  createWeaveContextToolRuntime,
  type WeaveContextSnapshot,
} from './weaveContextService';
import { resolveWeaveEffectiveBudget, runWeaveGraph } from './weaveGraph';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ── HTTP Client interface ─────────────────────────────────────────────────────

export interface WeaveHttpClientRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  temperature: number;
  /** Extra params merged into the HTTP request body (e.g. response_format). */
  responseFormatParams?: Record<string, unknown>;
}

export interface WeaveHttpClientResponse {
  content: string;
  resolvedModel: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface WeaveHttpClient {
  chatCompletion(
    request: WeaveHttpClientRequest,
    timeoutMs: number,
    logger?: WeaveRequestSessionLogger,
  ): Promise<WeaveHttpClientResponse>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type OpenRouterFetch = typeof net.fetch;

interface OpenRouterDependencies {
  fetchImpl?: OpenRouterFetch;
  now?: () => number;
}

interface OpenRouterPlanOptions {
  requestLogDirectory?: string;
}

/**
 * Redacts sensitive content from request/response payloads for safe logging.
 * Hashes large text content and truncates responses to prevent logging vault excerpts.
 */
function redactSensitiveLoggingData(data: unknown, maxLength = 300): unknown {
  if (typeof data === 'string') {
    if (data.length > maxLength) {
      const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
      return `[TRUNCATED: ${data.length} chars, hash:${hash}]`;
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveLoggingData(item, maxLength));
  }

  if (data !== null && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};

    // Special handling for request messages — hash content but keep role
    if ('messages' in obj && Array.isArray(obj.messages)) {
      redacted.messages = (obj.messages as Array<unknown>).map(msg => {
        if (msg && typeof msg === 'object' && 'role' in msg && 'content' in msg) {
          const msgObj = msg as { role?: string; content?: unknown };
          const content = typeof msgObj.content === 'string' ? msgObj.content : String(msgObj.content);
          const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
          return {
            role: msgObj.role,
            content: `[REDACTED: ${content.length} chars, hash:${hash}]`,
          };
        }
        return msg;
      });
    }

    // For other fields, recurse but keep structure
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'messages') continue; // already handled
      redacted[key] = redactSensitiveLoggingData(value, maxLength);
    }

    return redacted;
  }

  return data;
}

function categorizeHttpError(status: number): { category: WeaveErrorCategory; message: string } {
  if (status === 401 || status === 403) {
    return {
      category: 'auth-error',
      message: 'Invalid or expired OpenRouter API key. Update your key in Settings → Weaver.',
    };
  }
  if (status === 429) {
    return {
      category: 'rate-limit',
      message: 'OpenRouter rate limit reached. Wait a moment and try again.',
    };
  }
  if (status >= 500) {
    return {
      category: 'provider-error',
      message: `OpenRouter returned a server error (${status}). Try again shortly.`,
    };
  }
  return {
    category: 'provider-error',
    message: `Unexpected response from OpenRouter (${status}).`,
  };
}

function makeWeaveError(message: string, category: WeaveErrorCategory): Error {
  return Object.assign(new Error(message), { errorCategory: category });
}

// ── OpenRouter HTTP client ────────────────────────────────────────────────────

interface OpenRouterChatResponse {
  model?: string;
  choices: Array<{
    message: { role: string; content: string | null };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Thin HTTP wrapper around OpenRouter's chat completions endpoint.
 * Uses Electron's net.fetch so traffic routes through the app's network stack.
 */
export class OpenRouterHttpClient implements WeaveHttpClient {
  constructor(
    private readonly apiKey: string,
    private readonly appUrl: string,
    private readonly fetchImpl: OpenRouterFetch,
  ) {}

  async chatCompletion(
    request: WeaveHttpClientRequest,
    timeoutMs: number,
    logger?: WeaveRequestSessionLogger,
  ): Promise<WeaveHttpClientResponse> {
    const allowFullLogging = process.env.CRASHWEAVER_WEAVER_DEBUG_LOG_FULL === '1';

    const requestBody = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      ...request.responseFormatParams,
    };

    if (logger) {
      await logger.log('openrouter-request', {
        endpoint: '/chat/completions',
        model: requestBody.model,
        maxTokens: requestBody.max_tokens,
        temperature: requestBody.temperature,
        messageCount: requestBody.messages.length,
        messages: allowFullLogging
          ? requestBody.messages
          : redactSensitiveLoggingData(requestBody.messages),
        safeLoggingMode: !allowFullLogging,
      });
    }

    let response: Response;

    try {
      response = await Promise.race<Response>([
        this.fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': this.appUrl,
            'X-Title': 'CrashWeaver',
          },
          body: Buffer.from(JSON.stringify(requestBody), 'utf-8'),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('provider-timeout')), timeoutMs),
        ),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === 'provider-timeout') {
        throw makeWeaveError(
          'Weaver request timed out. Try a smaller guided insert or a lighter intelligent strength.',
          'provider-timeout',
        );
      }
      const detail = error instanceof Error ? error.message : String(error);
      console.error('CrashWeaver Weaver: net.fetch error —', detail);
      throw makeWeaveError(
        `Could not reach OpenRouter. Check your network connection. (${detail})`,
        'provider-error',
      );
    }

    const responseText = await response.text();

    if (logger) {
      await logger.log('openrouter-response', {
        endpoint: '/chat/completions',
        ok: response.ok,
        status: response.status,
        responseLength: responseText.length,
        responseBody: allowFullLogging
          ? responseText
          : redactSensitiveLoggingData(responseText, 500),
        safeLoggingMode: !allowFullLogging,
      });
    }

    if (!response.ok) {
      const { message, category } = categorizeHttpError(response.status);
      console.error(`CrashWeaver Weaver: OpenRouter error ${response.status}`, responseText.slice(0, 500));
      throw makeWeaveError(message, category);
    }

    let parsed: OpenRouterChatResponse;
    try {
      parsed = JSON.parse(responseText) as OpenRouterChatResponse;
    } catch {
      throw makeWeaveError('OpenRouter returned an unparseable response.', 'provider-error');
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (!content) {
      throw makeWeaveError('OpenRouter returned an empty response.', 'provider-error');
    }

    return {
      content,
      resolvedModel: parsed.model ?? request.model,
      usage: parsed.usage,
    };
  }
}

// ── OpenRouter Weave Provider ─────────────────────────────────────────────────

/**
 * WeaveModelProvider backed by OpenRouter.
 * generatePlan() delegates orchestration to the LangGraph-based runWeaveGraph().
 */
export class OpenRouterWeaveProvider implements WeaveModelProvider {
  private readonly preferredModel: string | null;
  private readonly appUrl: string;
  private readonly fetchImpl: OpenRouterFetch;
  private readonly now: () => number;

  constructor(
    private readonly apiKey: string,
    preferredModel?: string | null,
    appUrl?: string,
    dependencies?: OpenRouterDependencies,
  ) {
    this.preferredModel = preferredModel ?? null;
    this.appUrl = appUrl ?? 'https://github.com/crashweaver/app';
    this.fetchImpl = dependencies?.fetchImpl ?? net.fetch.bind(net);
    this.now = dependencies?.now ?? Date.now;
  }

  async generatePlan(
    request: WeavePlanRequest,
    context?: WeaveContextSnapshot,
    options?: OpenRouterPlanOptions,
  ): Promise<WeavePlanResult> {
    const resolvedModelId = resolveModel(request.preferredModel, this.preferredModel);
    const settings = await getWeaverSettings();
    const modelProfile = resolveFullModelProfile(resolvedModelId, request, settings);
    const contextSnapshot = context ?? (await buildWeaveContextSnapshot(request));
    const toolRuntime = createWeaveContextToolRuntime(contextSnapshot);
    const effectiveBudget = resolveWeaveEffectiveBudget(modelProfile, contextSnapshot);

    let sessionLogger: WeaveRequestSessionLogger | undefined;

    if (options?.requestLogDirectory) {
      try {
        sessionLogger = await createWeaveRequestSessionLogger(
          request,
          options.requestLogDirectory,
          this.now,
        );
        await sessionLogger.log('budget-resolved', {
          model: resolvedModelId,
          maxTokens: modelProfile.maxTokens,
          temperature: modelProfile.temperature,
          timeoutMs: modelProfile.timeoutMs,
          iterationLimit: modelProfile.iterationLimit,
          structuredOutputMode: modelProfile.structuredOutputMode,
          repairStrategy: modelProfile.repairStrategy,
          effectiveBudget,
          contextSummary: {
            candidateNotes: contextSnapshot.candidateNotes.length,
            directorySummaries: contextSnapshot.directorySummaries.length,
            warnings: contextSnapshot.warnings,
          },
        });
      } catch (error) {
        console.warn('CrashWeaver Weaver: failed to initialize request logger.', error);
      }
    }

    const httpClient = new OpenRouterHttpClient(this.apiKey, this.appUrl, this.fetchImpl);

    return runWeaveGraph(
      request,
      contextSnapshot,
      modelProfile,
      resolvedModelId,
      httpClient,
      toolRuntime,
      sessionLogger,
    );
  }

  async healthCheck(): Promise<WeaveProviderHealth> {
    const model = resolveModel(undefined, this.preferredModel);

    try {
      const response = await Promise.race<Response>([
        this.fetchImpl(`${OPENROUTER_BASE_URL}/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10_000),
        ),
      ]);

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          provider: 'openrouter',
          configured: true,
          model,
          message: 'Invalid API key. Update your key in Settings → Weaver.',
          errorCategory: 'auth-error',
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          provider: 'openrouter',
          configured: true,
          model,
          message: `OpenRouter returned ${response.status}.`,
          errorCategory: 'provider-error',
        };
      }

      return {
        ok: true,
        provider: 'openrouter',
        configured: true,
        model,
        message: 'OpenRouter provider is active.',
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === 'timeout';
      return {
        ok: false,
        provider: 'openrouter',
        configured: true,
        model,
        message: isTimeout
          ? 'OpenRouter health check timed out.'
          : 'Could not reach OpenRouter. Check your network connection.',
        errorCategory: isTimeout ? 'provider-timeout' : 'provider-error',
      };
    }
  }

  async listModels(): Promise<WeaveModelInfo[]> {
    interface OpenRouterModelEntry {
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string };
    }

    function formatCostLabel(promptPriceStr?: string): string {
      const price = parseFloat(promptPriceStr ?? '0');
      if (!price || isNaN(price)) return 'Free';
      const perM = price * 1_000_000;
      if (perM < 1) return `$${perM.toFixed(3)}/M`;
      if (perM < 10) return `$${perM.toFixed(2)}/M`;
      return `$${perM.toFixed(0)}/M`;
    }

    try {
      const response = await Promise.race<Response>([
        this.fetchImpl(`${OPENROUTER_BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 15_000),
        ),
      ]);

      if (!response.ok) return [];

      const data = (await response.json()) as { data?: OpenRouterModelEntry[] };
      const entries = data?.data ?? [];

      return entries
        .filter(
          (m): m is OpenRouterModelEntry & { id: string } =>
            typeof m.id === 'string' && m.id.trim() !== '',
        )
        .map((m) => {
          const isFree =
            m.id.endsWith(':free') || parseFloat(m.pricing?.prompt ?? '0') === 0;
          return {
            id: m.id,
            name: m.name?.trim() || m.id,
            costLabel: isFree ? 'Free' : formatCostLabel(m.pricing?.prompt),
            isFree,
            contextLength: m.context_length,
          } satisfies WeaveModelInfo;
        })
        .sort((a, b) => {
          if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      return [];
    }
  }
}


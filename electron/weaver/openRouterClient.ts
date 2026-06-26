/**
 * openRouterClient.ts
 *
 * OpenRouter WeaveModelProvider — the production AI backend for the Weaver planner.
 *
 * HTTP transport lives in weaveHttpClient.ts.
 * Orchestration (model resolution → context → graph execution) is
 * assembled here so that the service layer (weaveService.ts) gets a
 * single call: provider.generatePlan(request, context, options).
 */

import { net } from 'electron';
import type {
  WeavePlanRequest,
  WeavePlanResult,
  WeaveModelInfo,
  WeaveProviderHealth,
} from '../vault-contract';
import type { WeaveProgressCallback } from './weaveGraphState';
import { getWeaverSettings } from '../settingsService';
import { resolveModel, resolveFullModelProfile } from './weaveModelProfiles';
import { OpenRouterHttpClient } from './weaveHttpClient';
import { createWeaveRequestSessionLogger, type WeaveRequestSessionLogger } from './weaveRequestLogger';
import {
  createWeaveContextToolRuntime,
  type WeaveContextSnapshot,
} from './weaveContextService';
import { resolveWeaveEffectiveBudget, runWeaveGraph } from './weaveGraph';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ── Model list cache ─────────────────────────────────────────────────────────

const MODEL_LIST_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface ModelListCacheEntry {
  models: WeaveModelInfo[];
  fetchedAt: number;
}

let modelListCache: ModelListCacheEntry | null = null;

function getCachedModelList(now: number): WeaveModelInfo[] | null {
  if (!modelListCache) return null;
  if (now - modelListCache.fetchedAt > MODEL_LIST_CACHE_TTL_MS) {
    modelListCache = null;
    return null;
  }
  return modelListCache.models;
}

function setCachedModelList(models: WeaveModelInfo[], now: number): void {
  modelListCache = { models, fetchedAt: now };
}

/** Clears the model list cache (useful after API key changes). */
export function clearModelListCache(): void {
  modelListCache = null;
}

// ── Provider ─────────────────────────────────────────────────────────────────

type OpenRouterFetch = typeof net.fetch;

interface OpenRouterDependencies {
  fetchImpl?: OpenRouterFetch;
  now?: () => number;
}

interface OpenRouterPlanOptions {
  requestLogDirectory?: string;
  onProgress?: WeaveProgressCallback;
}

// ── OpenRouter Weave Provider ─────────────────────────────────────────────────

/**
 * WeaveModelProvider backed by OpenRouter.
 * generatePlan() resolves the model, profile, and context, then delegates
 * the ReAct loop to runWeaveGraph().
 */
export class OpenRouterWeaveProvider {
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
    context: WeaveContextSnapshot,
    options?: OpenRouterPlanOptions,
  ): Promise<WeavePlanResult> {
    const resolvedModelId = resolveModel(request.preferredModel, this.preferredModel);
    const settings = await getWeaverSettings();
    const modelProfile = resolveFullModelProfile(resolvedModelId, request, settings);
    const toolRuntime = createWeaveContextToolRuntime(
      context,
      undefined,
      context._searchTokens && context._anchorPaths
        ? { tokens: context._searchTokens, anchorPaths: context._anchorPaths }
        : undefined,
    );
    const effectiveBudget = resolveWeaveEffectiveBudget(modelProfile, context);

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
            candidateNotes: context.candidateNotes.length,
            directorySummaries: context.directorySummaries.length,
            warnings: context.warnings,
          },
        });
      } catch (error) {
        console.warn('CrashWeaver Weaver: failed to initialize request logger.', error);
      }
    }

    const httpClient = new OpenRouterHttpClient(this.apiKey, this.appUrl, this.fetchImpl);

    return runWeaveGraph(
      request,
      context,
      modelProfile,
      resolvedModelId,
      httpClient,
      toolRuntime,
      sessionLogger,
      options?.onProgress,
      settings,
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
        let detail = '';
        try {
          const body = await response.text();
          const parsed = JSON.parse(body) as { error?: { message?: string } };
          if (parsed.error?.message) detail = ` — ${parsed.error.message}`;
        } catch { /* ignore parse failures */ }
        return {
          ok: false,
          provider: 'openrouter',
          configured: true,
          model,
          message: `Invalid API key${detail}. Update your key in Settings → Weaver.`,
          errorCategory: 'auth-error',
        };
      }

      if (response.status === 402) {
        let detail = '';
        try {
          const body = await response.text();
          const parsed = JSON.parse(body) as { error?: { message?: string } };
          if (parsed.error?.message) detail = ` — ${parsed.error.message}`;
        } catch { /* ignore parse failures */ }
        return {
          ok: false,
          provider: 'openrouter',
          configured: true,
          model,
          message: `OpenRouter requires credits${detail}. Add credits at openrouter.ai/credits or use a free model.`,
          errorCategory: 'provider-error',
        };
      }

      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.text();
          const parsed = JSON.parse(body) as { error?: { message?: string } };
          if (parsed.error?.message) detail = ` — ${parsed.error.message}`;
        } catch { /* ignore parse failures */ }
        return {
          ok: false,
          provider: 'openrouter',
          configured: true,
          model,
          message: `OpenRouter returned ${response.status}${detail}.`,
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
    const now = this.now();
    const cached = getCachedModelList(now);
    if (cached) return cached;

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

      const models = entries
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

      setCachedModelList(models, this.now());
      return models;
    } catch {
      // On failure, return cached models even if stale as a fallback
      return modelListCache?.models ?? [];
    }
  }
}


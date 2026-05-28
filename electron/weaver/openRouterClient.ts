import { net } from 'electron';
import type { WeavePlanRequest, WeavePlanResult, WeaveErrorCategory, WeaveModelInfo, WeaveModelProvider, WeaveProviderHealth } from '../vault-contract';
import { validateWeavePlanResult } from './weavePlanSchema';
import { buildToolLoopResultMessage, buildToolLoopSystemInstruction, buildToolLoopUserMessage } from './weavePromptBuilder';
import { getRequestExecutionBudget, resolveModel } from './weaveCostPolicy';
import { createWeaveRequestSessionLogger, type WeaveRequestSessionLogger } from './weaveRequestLogger';
import {
  buildWeaveContextSnapshot,
  createWeaveContextToolRuntime,
  type WeaveContextSnapshot,
} from './weaveContextService';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterChoice {
  message: {
    role: string;
    content: string | null;
  };
  finish_reason: string;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices: OpenRouterChoice[];
  usage?: OpenRouterUsage;
}

type OpenRouterFetch = typeof net.fetch;

interface OpenRouterDependencies {
  fetchImpl?: OpenRouterFetch;
  now?: () => number;
}

interface OpenRouterPlanOptions {
  requestLogDirectory?: string;
}

interface OpenRouterToolLoopRequest {
  type: 'tool';
  toolName: string;
  arguments?: Record<string, unknown>;
}

interface OpenRouterToolLoopFinal {
  type: 'final';
  plan: unknown;
}

type OpenRouterToolLoopAction = OpenRouterToolLoopRequest | OpenRouterToolLoopFinal;

interface OpenRouterChatCompletionResult {
  content: string;
  model: string;
  usage?: OpenRouterUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseToolLoopAction(value: unknown): OpenRouterToolLoopAction | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.type === 'tool' && typeof value.toolName === 'string') {
    return {
      type: 'tool',
      toolName: value.toolName,
      arguments: isRecord(value.arguments) ? value.arguments : {},
    };
  }

  if (value.type === 'final' && 'plan' in value) {
    return {
      type: 'final',
      plan: value.plan,
    };
  }

  if (typeof value.kind === 'string' && Array.isArray(value.operations)) {
    return {
      type: 'final',
      plan: value,
    };
  }

  return null;
}

function sumUsageValue(left?: number, right?: number) {
  if (left === undefined && right === undefined) {
    return undefined;
  }

  return (left ?? 0) + (right ?? 0);
}

function accumulateUsage(
  current: WeavePlanResult['usage'] | undefined,
  nextUsage?: OpenRouterUsage,
): WeavePlanResult['usage'] | undefined {
  if (!current && !nextUsage) {
    return undefined;
  }

  return {
    promptTokens: sumUsageValue(current?.promptTokens, nextUsage?.prompt_tokens),
    completionTokens: sumUsageValue(current?.completionTokens, nextUsage?.completion_tokens),
    totalTokens: sumUsageValue(current?.totalTokens, nextUsage?.total_tokens),
  };
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

function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try stripping markdown code fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim());
      } catch {
        // fall through
      }
    }

    // Try extracting outermost JSON object
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through
      }
    }

    throw new Error('Could not find valid JSON in the model response.');
  }
}

function makeWeaveError(message: string, category: WeaveErrorCategory): Error {
  return Object.assign(new Error(message), { errorCategory: category });
}

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

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, timeoutError: string) {
    return Promise.race<Response>([
      this.fetchImpl(url, init),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(timeoutError)), timeoutMs)),
    ]);
  }

  private async requestChatCompletion(
    model: string,
    messages: OpenRouterMessage[],
    maxTokens: number,
    temperature: number,
    timeoutMs: number,
    logger?: WeaveRequestSessionLogger,
  ): Promise<OpenRouterChatCompletionResult> {
    const requestBody = { model, messages, max_tokens: maxTokens, temperature };
    const requestBodyBuf = Buffer.from(
      JSON.stringify(requestBody),
      'utf-8',
    );

    if (logger) {
      await logger.log('openrouter-request', {
        endpoint: '/chat/completions',
        requestBody,
      });
    }

    let response: Response;

    try {
      response = await this.fetchWithTimeout(
        `${OPENROUTER_BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': this.appUrl,
            'X-Title': 'CrashWeaver',
          },
          body: requestBodyBuf,
        },
        timeoutMs,
        'provider-timeout',
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'provider-timeout') {
        throw makeWeaveError(
          'Weaver request timed out. Try a smaller guided insert or a lighter intelligent strength.',
          'provider-timeout',
        );
      }

      const detail = error instanceof Error ? error.message : String(error);
      console.error('CrashWeaver Weaver: net.fetch threw for chat/completions —', detail);
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
        responseText,
      });
    }

    if (!response.ok) {
      const { message, category } = categorizeHttpError(response.status);
      console.error(`CrashWeaver Weaver: OpenRouter error ${response.status}`, responseText.slice(0, 500));
      throw makeWeaveError(message, category);
    }

    let parsed: OpenRouterResponse;

    try {
      parsed = JSON.parse(responseText) as OpenRouterResponse;
    } catch {
      throw makeWeaveError('OpenRouter returned an unparseable response.', 'provider-error');
    }

    const content = parsed.choices?.[0]?.message?.content;

    if (!content) {
      throw makeWeaveError('OpenRouter returned an empty response.', 'provider-error');
    }

    return {
      content,
      model: parsed.model ?? model,
      usage: parsed.usage,
    };
  }

  async healthCheck(): Promise<WeaveProviderHealth> {
    const model = resolveModel(undefined, this.preferredModel);

    try {
      const response = await this.fetchWithTimeout(
        `${OPENROUTER_BASE_URL}/models`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
        10_000,
        'timeout',
      );

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

  async generatePlan(
    request: WeavePlanRequest,
    context?: WeaveContextSnapshot,
    options?: OpenRouterPlanOptions,
  ): Promise<WeavePlanResult> {
    const startTime = this.now();
    const model = resolveModel(request.preferredModel, this.preferredModel);
    const executionBudget = getRequestExecutionBudget(request);
    const timeoutMs = executionBudget.timeoutMs;
    const maxTokens = executionBudget.maxTokens;
    const temperature = executionBudget.temperature;
    const contextSnapshot = context ?? await buildWeaveContextSnapshot(request);
    const toolRuntime = createWeaveContextToolRuntime(contextSnapshot);
    let sessionLogger: WeaveRequestSessionLogger | undefined;

    if (options?.requestLogDirectory) {
      try {
        sessionLogger = await createWeaveRequestSessionLogger(request, options.requestLogDirectory, this.now);
        await sessionLogger.log('budget-resolved', {
          model,
          maxTokens,
          temperature,
          timeoutMs,
          iterationLimit: executionBudget.iterationLimit,
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

    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: buildToolLoopSystemInstruction(executionBudget.iterationLimit, model),
      },
      {
        role: 'user',
        content: buildToolLoopUserMessage(request, contextSnapshot, executionBudget.iterationLimit),
      },
    ];
    let accumulatedUsage: WeavePlanResult['usage'] | undefined;
    let resolvedModel = model;
    let toolCalls = 0;
    let repairAttempts = 0;
    const maxRepairs = 2;

    while (true) {
      const elapsedMs = this.now() - startTime;
      const remainingMs = timeoutMs - elapsedMs;

      if (remainingMs <= 0) {
        if (sessionLogger) {
          await sessionLogger.log('session-error', {
            category: 'provider-timeout',
            message: 'Weaver request timed out before completion.',
          });
        }

        throw makeWeaveError(
          'Weaver request timed out. Try a smaller guided insert or a lighter intelligent strength.',
          'provider-timeout',
        );
      }

      const completion = await this.requestChatCompletion(
        model,
        messages,
        maxTokens,
        temperature,
        remainingMs,
        sessionLogger,
      );
      resolvedModel = completion.model;
      accumulatedUsage = accumulateUsage(accumulatedUsage, completion.usage);

      let responseData: unknown;

      try {
        responseData = extractJsonFromText(completion.content);
      } catch (parseError) {
        console.error('CrashWeaver Weaver: failed to extract JSON from model response', completion.content.slice(0, 500));
        
        // SYNTACTIC REPAIR PATH: Try asking model to correct its JSON output once or twice
        // Only attempt repair if the response actually contains braces, indicating a minor format or syntax issue.
        const content = completion.content;
        const hasBraces = content.includes('{') && content.includes('}');

        if (hasBraces && repairAttempts < maxRepairs && remainingMs > 10_000) {
          repairAttempts++;
          if (sessionLogger) {
            await sessionLogger.log('syntactic-repair-attempt', {
              repairAttempt: repairAttempts,
              unparseableContent: completion.content,
            });
          }
          messages.push({ role: 'assistant', content: completion.content });
          messages.push({
            role: 'user',
            content: 'Your previous response could not be parsed as JSON. Please respond with ONLY a raw, fully parseable JSON object matching the required action or final plan schema. Do not enclosing structural thoughts in conversational markdown text.',
          });
          continue;
        }

        if (sessionLogger) {
          await sessionLogger.log('session-error', {
            category: 'schema-error',
            message: 'Model response could not be parsed as JSON after repair attempts.',
            modelContent: completion.content,
          });
        }
        throw makeWeaveError('Weaver model did not return valid JSON. Try again.', 'schema-error');
      }

      let action = parseToolLoopAction(responseData);

      if (!action) {
        // SEMANTIC REPAIR PATH: If parsed JSON but format doesn't match an action or final plan
        if (repairAttempts < maxRepairs && remainingMs > 10_000) {
          repairAttempts++;
          if (sessionLogger) {
            await sessionLogger.log('semantic-repair-attempt', {
              repairAttempt: repairAttempts,
              responseData,
            });
          }
          messages.push({ role: 'assistant', content: completion.content });
          messages.push({
            role: 'user',
            content: 'Your response was valid JSON but did not match the expected action envelope. You must output either { "type": "tool", "toolName": "...", "arguments": {...} } or { "type": "final", "plan": {...} }. Please correct and output your next action.',
          });
          continue;
        }

        console.error('CrashWeaver Weaver: invalid tool-loop action', completion.content.slice(0, 500));
        if (sessionLogger) {
          await sessionLogger.log('session-error', {
            category: 'schema-error',
            message: 'Model returned an invalid tool-loop action description.',
            modelContent: completion.content,
          });
        }
        throw makeWeaveError('Weaver model returned an invalid planning action. Try again.', 'schema-error');
      }

      if (sessionLogger) {
        await sessionLogger.log('model-action', {
          action,
        });
      }

      if (action.type === 'final') {
        const result: WeavePlanResult = {
          plan: action.plan as WeavePlanResult['plan'],
          model: resolvedModel,
          provider: 'openrouter',
          usage: accumulatedUsage,
          latencyMs: this.now() - startTime,
        };

        if (sessionLogger) {
          await sessionLogger.log('final-plan-accepted', {
            planKind: result.plan.kind,
            operations: result.plan.operations.length,
            referencedCards: result.plan.referencedCards,
            usage: result.usage,
            latencyMs: result.latencyMs,
          });
        }

        try {
          return validateWeavePlanResult(result, request);
        } catch (validationError) {
          // SCHEMA CORRECTOR PATH: Try to repair validation error once
          if (repairAttempts < maxRepairs && remainingMs > 10_000) {
            repairAttempts++;
            const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
            if (sessionLogger) {
              await sessionLogger.log('validation-repair-attempt', {
                repairAttempt: repairAttempts,
                errorMessage,
              });
            }
            messages.push({ role: 'assistant', content: completion.content });
            messages.push({
              role: 'user',
              content: `Your final plan failed schema validation in CrashWeaver: ${errorMessage}. Please repair the structure and try outputting the final plan object again.`,
            });
            continue;
          }
          throw validationError;
        }
      }

      if (toolCalls >= executionBudget.iterationLimit) {
        // RETRIEVAL LIMIT EXHAUSTION FALLBACK: Encourage a graceful exit turn instead of a hard crash
        if (repairAttempts < maxRepairs && remainingMs > 10_000) {
          repairAttempts++;
          if (sessionLogger) {
            await sessionLogger.log('retrieval-exhaustion-fallback', {
              toolCalls,
              limit: executionBudget.iterationLimit,
            });
          }
          messages.push({ role: 'assistant', content: completion.content });
          messages.push({
            role: 'user',
            content: 'CRITICAL: Retrieval limit reached. You can make no further tool calls. You must now immediately finalize and output your best guess Stage 5 proposal plan in type="final" using the evidence gathered so far.',
          });
          toolCalls++; // prevents infinite loop
          continue;
        }

        if (sessionLogger) {
          await sessionLogger.log('session-error', {
            category: 'provider-error',
            message: 'Weaver exhausted its read-only retrieval loop before finalizing.',
            toolCalls,
            iterationLimit: executionBudget.iterationLimit,
          });
        }

        throw makeWeaveError(
          'Weaver exhausted its read-only retrieval loop before returning a plan.',
          'provider-error',
        );
      }

      const toolResult = await toolRuntime.execute(action.toolName, action.arguments);

      if (sessionLogger) {
        await sessionLogger.log('tool-executed', {
          toolName: action.toolName,
          arguments: action.arguments,
          toolResult,
        });
      }

      messages.push({ role: 'assistant', content: completion.content });
      messages.push({ role: 'user', content: buildToolLoopResultMessage(action.toolName, toolResult) });
      toolCalls += 1;
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
      if (perM < 1) return `$${(perM).toFixed(3)}/M`;
      if (perM < 10) return `$${perM.toFixed(2)}/M`;
      return `$${perM.toFixed(0)}/M`;
    }

    try {
      const response = await this.fetchWithTimeout(
        `${OPENROUTER_BASE_URL}/models`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
        15_000,
        'timeout',
      );

      if (!response.ok) return [];

      const data = (await response.json()) as { data?: OpenRouterModelEntry[] };
      const entries = data?.data ?? [];

      return entries
        .filter((m): m is OpenRouterModelEntry & { id: string } => typeof m.id === 'string' && m.id.trim() !== '')
        .map((m) => {
          const isFree = m.id.endsWith(':free') || parseFloat(m.pricing?.prompt ?? '0') === 0;
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

/**
 * weaveHttpClient.ts
 *
 * Lightweight HTTP transport layer for OpenRouter chat completions.
 * Uses Electron's net.fetch so traffic routes through the app's network stack.
 *
 * Extracted from openRouterClient.ts to keep transport concerns separate
 * from the provider orchestration and business logic.
 */

import { net } from 'electron';
import { createHash } from 'crypto';
import type { WeaveErrorCategory } from '../vault-contract';
import type { WeaveRequestSessionLogger } from './weaveRequestLogger';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// ── Public types ──────────────────────────────────────────────────────────────

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

function makeWeaveError(message: string, category: WeaveErrorCategory): Error {
  return Object.assign(new Error(message), { errorCategory: category });
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

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'messages') continue;
      redacted[key] = redactSensitiveLoggingData(value, maxLength);
    }

    return redacted;
  }

  return data;
}

// ── Retry helpers ────────────────────────────────────────────────────────────

/**
 * Max retry attempts for transient HTTP errors (429 rate-limit, 5xx server).
 * 2 retries = 3 total attempts. Beyond this, the user-facing timeout budget
 * is better spent surfacing the error than retrying into a degraded backend.
 */
const DEFAULT_MAX_RETRIES = 2;

/**
 * Base delay for exponential-backoff retries, in ms.
 * 800ms is long enough to let rate-limit windows reset on most providers
 * but short enough that 2 retries won't exceed typical user patience (~5s).
 */
const RETRY_BASE_DELAY_MS = 800;

/**
 * Hard cap on exponential-backoff delay, in ms.
 * 8s prevents unbounded growth from the 2^attempt multiplier.
 * With base=800ms and max=8s: delays are ~0.6s, ~1.6s for attempts 0 and 1
 * (with full-jitter randomization).
 */
const RETRY_MAX_DELAY_MS = 8_000;

/**
 * Status codes eligible for a retry.
 * 429 (rate-limit) and 5xx (server error) are transient; auth errors and
 * client errors (4xx except 429) are not retryable.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Exponential backoff with full jitter.
 * delay = min(maxDelay, baseDelay * 2^attempt) * random(0, 1)
 */
function backoffDelayMs(attempt: number): number {
  const exponential = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
  return Math.floor(exponential * Math.random());
}

// ── OpenRouter HTTP client ───────────────────────────────────────────────────

export interface OpenRouterHttpClientOptions {
  /** Maximum number of retry attempts for transient errors (default 2). */
  maxRetries?: number;
}

/**
 * Thin HTTP wrapper around OpenRouter's chat completions endpoint.
 * Uses Electron's net.fetch and AbortController for proper cancellation.
 * Includes exponential-backoff retry for transient server errors (429, 5xx).
 */
export class OpenRouterHttpClient implements WeaveHttpClient {
  private readonly maxRetries: number;

  constructor(
    private readonly apiKey: string,
    private readonly appUrl: string,
    private readonly fetchImpl: OpenRouterFetch,
    options?: OpenRouterHttpClientOptions,
  ) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

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

    const startTimeMs = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const elapsedMs = Date.now() - startTimeMs;
      const remainingMs = Math.max(0, timeoutMs - elapsedMs);

      if (remainingMs <= 0) {
        throw makeWeaveError(
          'Weaver request timed out after retries. Try a smaller guided insert or a lighter intelligent strength.',
          'provider-timeout',
        );
      }

      try {
        const result = await this._sendRequest(requestBody, remainingMs, logger, allowFullLogging);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Do not retry auth errors, parse errors, empty responses, or timeouts
        const errorCategory = (lastError as { errorCategory?: WeaveErrorCategory }).errorCategory;
        const isRetryable =
          errorCategory === 'rate-limit' || errorCategory === 'provider-error';

        if (!isRetryable || attempt >= this.maxRetries) {
          throw lastError;
        }

        const delay = backoffDelayMs(attempt);
        console.warn(
          `CrashWeaver Weaver: attempt ${attempt + 1}/${this.maxRetries + 1} failed, ` +
            `retrying in ${delay}ms — ${lastError.message}`,
        );

        if (logger) {
          await logger.log('openrouter-retry', {
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delayMs: delay,
            error: lastError.message,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError ?? makeWeaveError('Unknown HTTP error.', 'provider-error');
  }

  /**
   * Performs a single HTTP request attempt (no retry).
   * Extracted so the retry loop can call it cleanly.
   */
  private async _sendRequest(
    requestBody: Record<string, unknown>,
    timeoutMs: number,
    logger: WeaveRequestSessionLogger | undefined,
    allowFullLogging: boolean,
  ): Promise<WeaveHttpClientResponse> {
    let response: Response;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      response = await this.fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.appUrl,
          'X-Title': 'CrashWeaver',
        },
        body: Buffer.from(JSON.stringify(requestBody), 'utf-8'),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);

      const isAbort =
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError');

      if (isAbort) {
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

    clearTimeout(timeoutId);

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
      resolvedModel: parsed.model ?? (requestBody.model as string),
      usage: parsed.usage,
    };
  }
}

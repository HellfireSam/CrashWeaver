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

// ── OpenRouter HTTP client ───────────────────────────────────────────────────

/**
 * Thin HTTP wrapper around OpenRouter's chat completions endpoint.
 * Uses Electron's net.fetch and AbortController for proper cancellation.
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

      // Handle timeout: either the AbortController fired, or an AbortError came from the fetch layer
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
      resolvedModel: parsed.model ?? request.model,
      usage: parsed.usage,
    };
  }
}

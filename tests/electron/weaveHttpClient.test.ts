import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const { OpenRouterHttpClient } = require('../../dist-electron/weaver/weaveHttpClient.js');

describe('weaveHttpClient', () => {
  type FakeFetchBehaviour = {
    type: string;
    responseContent?: string;
    status?: number;
  };

  function makeFakeFetch(behaviour: FakeFetchBehaviour) {
    return async function fakeFetch(url: string, options: { body: string; signal?: AbortSignal }) {
      if (behaviour.type === 'timeout') {
        // Simulate abort: never resolve, signal fires
        const signal = options.signal;

        if (signal) {
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted.');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
        return new Promise(() => {}); // never settles
      }

      if (behaviour.type === 'network-error') {
        throw new Error('ENOTFOUND');
      }

      if (behaviour.type === 'success') {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              model: 'openai/gpt-4o-mini',
              choices: [
                {
                  message: { role: 'assistant', content: behaviour.responseContent },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            });
          },
        };
      }

      if (behaviour.type === 'http-error') {
        return {
          ok: false,
          status: behaviour.status,
          async text() {
            return JSON.stringify({ error: { message: 'Server error' } });
          },
        };
      }

      throw new Error(`Unknown behaviour type: ${behaviour.type}`);
    };
  }

  // ── AbortController timeout ──────────────────────────────────────────────────

  it('OpenRouterHttpClient throws provider-timeout on AbortError (timeout)', async () => {
    const client = new OpenRouterHttpClient(
      'sk-test-key',
      'https://crashweaver.app',
      makeFakeFetch({ type: 'timeout' }),
    );

    await expect(
      client.chatCompletion(
        {
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 100,
          temperature: 0.2,
        },
        100, // very short timeout
      ),
    ).rejects.toMatchObject({
      errorCategory: 'provider-timeout',
      message: expect.stringContaining('timed out'),
    });
  });

  // ── Successful response ──────────────────────────────────────────────────────

  it('OpenRouterHttpClient returns parsed content on success', async () => {
    const client = new OpenRouterHttpClient(
      'sk-test-key',
      'https://crashweaver.app',
      makeFakeFetch({ type: 'success', responseContent: '{"type":"final","plan":{}}' }),
    );

    const result = await client.chatCompletion(
      {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
        temperature: 0.2,
      },
      5000,
    );

    expect(result.content).toBe('{"type":"final","plan":{}}');
    expect(result.resolvedModel).toBe('openai/gpt-4o-mini');
    expect(result.usage).toBeTruthy();
    expect(result.usage.prompt_tokens).toBe(10);
  });

  // ── Network error ────────────────────────────────────────────────────────────

  it('OpenRouterHttpClient throws provider-error on network failure', async () => {
    const client = new OpenRouterHttpClient(
      'sk-test-key',
      'https://crashweaver.app',
      makeFakeFetch({ type: 'network-error' }),
    );

    await expect(
      client.chatCompletion(
        {
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 100,
          temperature: 0.2,
        },
        5000,
      ),
    ).rejects.toMatchObject({
      errorCategory: 'provider-error',
      message: expect.stringContaining('Could not reach'),
    });
  });

  // ── HTTP error categorisation ────────────────────────────────────────────────

  it('OpenRouterHttpClient throws auth-error for 401 status', async () => {
    const client = new OpenRouterHttpClient(
      'sk-test-key',
      'https://crashweaver.app',
      makeFakeFetch({ type: 'http-error', status: 401 }),
    );

    await expect(
      client.chatCompletion(
        {
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 100,
          temperature: 0.2,
        },
        5000,
      ),
    ).rejects.toMatchObject({ errorCategory: 'auth-error' });
  });

  it('OpenRouterHttpClient throws rate-limit for 429 status', async () => {
    const client = new OpenRouterHttpClient(
      'sk-test-key',
      'https://crashweaver.app',
      makeFakeFetch({ type: 'http-error', status: 429 }),
    );

    await expect(
      client.chatCompletion(
        {
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 100,
          temperature: 0.2,
        },
        5000,
      ),
    ).rejects.toMatchObject({ errorCategory: 'rate-limit' });
  });

  it('OpenRouterHttpClient throws provider-error for 500 status', async () => {
    const client = new OpenRouterHttpClient(
      'sk-test-key',
      'https://crashweaver.app',
      makeFakeFetch({ type: 'http-error', status: 500 }),
    );

    await expect(
      client.chatCompletion(
        {
          model: 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 100,
          temperature: 0.2,
        },
        5000,
      ),
    ).rejects.toMatchObject({ errorCategory: 'provider-error' });
  });

  // ── responseFormatParams merging ─────────────────────────────────────────────

  it('OpenRouterHttpClient merges responseFormatParams into request body', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const client = new OpenRouterHttpClient(
      'sk-test-key',
      'https://crashweaver.app',
      async function fakeFetch(url: string, options: { body: string }) {
        capturedBody = JSON.parse(Buffer.from(options.body).toString('utf-8'));
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              model: 'test-model',
              choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
            });
          },
        };
      },
    );

    await client.chatCompletion(
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
        temperature: 0.2,
        responseFormatParams: { response_format: { type: 'json_object' } },
      },
      5000,
    );

    expect(capturedBody?.response_format).toEqual({ type: 'json_object' });
    expect(capturedBody?.model).toBe('test-model');
    expect(capturedBody?.max_tokens).toBe(100);
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { OpenRouterHttpClient } = require('../../dist-electron/weaver/weaveHttpClient.js');

function makeFakeFetch(behaviour) {
  return async function fakeFetch(url, options) {
    if (behaviour.type === 'timeout') {
      // Simulate abort: never resolve, signal fires
      if (options.signal) {
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
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
            choices: [{ message: { role: 'assistant', content: behaviour.responseContent }, finish_reason: 'stop' }],
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

test('OpenRouterHttpClient throws provider-timeout on AbortError (timeout)', async () => {
  const client = new OpenRouterHttpClient(
    'sk-test-key',
    'https://crashweaver.app',
    makeFakeFetch({ type: 'timeout' }),
  );

  await assert.rejects(
    client.chatCompletion(
      {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
        temperature: 0.2,
      },
      100, // very short timeout
    ),
    (err) => {
      return err.message.includes('timed out') && err.errorCategory === 'provider-timeout';
    },
  );
});

// ── Successful response ──────────────────────────────────────────────────────

test('OpenRouterHttpClient returns parsed content on success', async () => {
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

  assert.equal(result.content, '{"type":"final","plan":{}}');
  assert.equal(result.resolvedModel, 'openai/gpt-4o-mini');
  assert.ok(result.usage);
  assert.equal(result.usage.prompt_tokens, 10);
});

// ── Network error ────────────────────────────────────────────────────────────

test('OpenRouterHttpClient throws provider-error on network failure', async () => {
  const client = new OpenRouterHttpClient(
    'sk-test-key',
    'https://crashweaver.app',
    makeFakeFetch({ type: 'network-error' }),
  );

  await assert.rejects(
    client.chatCompletion(
      {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
        temperature: 0.2,
      },
      5000,
    ),
    (err) => {
      return err.errorCategory === 'provider-error' && err.message.includes('Could not reach');
    },
  );
});

// ── HTTP error categorisation ────────────────────────────────────────────────

test('OpenRouterHttpClient throws auth-error for 401 status', async () => {
  const client = new OpenRouterHttpClient(
    'sk-test-key',
    'https://crashweaver.app',
    makeFakeFetch({ type: 'http-error', status: 401 }),
  );

  await assert.rejects(
    client.chatCompletion(
      {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
        temperature: 0.2,
      },
      5000,
    ),
    (err) => {
      return err.errorCategory === 'auth-error';
    },
  );
});

test('OpenRouterHttpClient throws rate-limit for 429 status', async () => {
  const client = new OpenRouterHttpClient(
    'sk-test-key',
    'https://crashweaver.app',
    makeFakeFetch({ type: 'http-error', status: 429 }),
  );

  await assert.rejects(
    client.chatCompletion(
      {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
        temperature: 0.2,
      },
      5000,
    ),
    (err) => {
      return err.errorCategory === 'rate-limit';
    },
  );
});

test('OpenRouterHttpClient throws provider-error for 500 status', async () => {
  const client = new OpenRouterHttpClient(
    'sk-test-key',
    'https://crashweaver.app',
    makeFakeFetch({ type: 'http-error', status: 500 }),
  );

  await assert.rejects(
    client.chatCompletion(
      {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 100,
        temperature: 0.2,
      },
      5000,
    ),
    (err) => {
      return err.errorCategory === 'provider-error';
    },
  );
});

// ── responseFormatParams merging ─────────────────────────────────────────────

test('OpenRouterHttpClient merges responseFormatParams into request body', async () => {
  let capturedBody;
  const client = new OpenRouterHttpClient(
    'sk-test-key',
    'https://crashweaver.app',
    async function fakeFetch(url, options) {
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

  assert.deepEqual(capturedBody.response_format, { type: 'json_object' });
  assert.equal(capturedBody.model, 'test-model');
  assert.equal(capturedBody.max_tokens, 100);
});

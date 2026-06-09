const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeCallModelNode,
  makeExecuteToolNode,
  makeRepairNode,
} = require('../../dist-electron/weaver/weaveGraphNodes.js');

function makeMessage(role, content) {
  return {
    content,
    _getType() {
      return role;
    },
  };
}

function makeBaseState(overrides = {}) {
  return {
    request: { kind: 'guided-insert' },
    modelProfile: {
      maxTokens: 1000,
      temperature: 0.2,
      timeoutMs: 60_000,
      iterationLimit: 2,
      repairStrategy: 'aggressive',
      responseFormatParams: undefined,
    },
    resolvedModel: 'openai/gpt-4o-mini',
    messages: [makeMessage('system', 's'), makeMessage('user', 'u')],
    toolCallCount: 0,
    repairAttemptCount: 0,
    startTimeMs: Date.now(),
    ...overrides,
  };
}

function makeHttpClientWithContent(content) {
  return {
    async chatCompletion() {
      return {
        content,
        resolvedModel: 'openai/gpt-4o-mini',
      };
    },
  };
}

test('callModel routes to execute-tool when tool action is valid and budget remains', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent(
      JSON.stringify({
        type: 'tool',
        thought: 'Need context',
        toolName: 'list_candidate_notes',
        arguments: { limit: 3 },
      }),
    ),
  );

  const updates = await node(makeBaseState());

  assert.equal(updates.pendingRoute, 'execute-tool');
  assert.equal(updates.pendingToolName, 'list_candidate_notes');
  assert.deepEqual(updates.pendingToolArgs, { limit: 3 });
});

test('callModel routes to repair-exhaustion when tool action requested after budget exhaustion', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent(
      JSON.stringify({
        type: 'tool',
        thought: 'Need context',
        toolName: 'read_note_excerpt',
        arguments: { filePath: 'notes/a.md' },
      }),
    ),
  );

  const updates = await node(
    makeBaseState({
      toolCallCount: 2,
      modelProfile: {
        ...makeBaseState().modelProfile,
        iterationLimit: 2,
      },
    }),
  );

  assert.equal(updates.pendingRoute, 'repair-exhaustion');
});

test('callModel routes to finalize when final action is returned', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent(
      JSON.stringify({
        type: 'final',
        thought: 'Done',
        plan: { kind: 'guided-insert', operations: [] },
      }),
    ),
  );

  const updates = await node(makeBaseState());

  assert.equal(updates.pendingRoute, 'finalize');
  assert.deepEqual(updates.pendingPlanData, { kind: 'guided-insert', operations: [] });
});

test('callModel routes to repair-semantic for bare plan without action envelope', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent(
      JSON.stringify({
        kind: 'guided-insert',
        permissions: { editContent: false, createNote: false },
        summary: 'Bare plan object.',
        operations: [],
        warnings: [],
        referencedCards: ['CW-001'],
      }),
    ),
  );

  const updates = await node(makeBaseState());

  assert.equal(updates.pendingRoute, 'repair-semantic');
});

test('callModel routes to repair-semantic for syntactically-valid but wrong envelope', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent(
      JSON.stringify({ foo: 'bar' }),
    ),
  );

  const updates = await node(makeBaseState());

  assert.equal(updates.pendingRoute, 'repair-semantic');
});

test('callModel fails with provider-timeout category when request already timed out', async () => {
  const node = makeCallModelNode(makeHttpClientWithContent('{"type":"final","plan":{}}'));

  const updates = await node(
    makeBaseState({
      startTimeMs: Date.now() - 120_000,
      modelProfile: {
        ...makeBaseState().modelProfile,
        timeoutMs: 1_000,
      },
    }),
  );

  assert.equal(updates.pendingRoute, 'fail');
  assert.equal(updates.errorCategory, 'provider-timeout');
});

test('repair node increments repair attempt and clears route/error', async () => {
  const repair = makeRepairNode();

  const updates = repair({
    pendingRoute: 'repair-schema',
    repairAttemptCount: 1,
    errorMessage: 'Schema mismatch',
  });

  assert.equal(updates.repairAttemptCount, 2);
  assert.equal(updates.pendingRoute, null);
  assert.equal(updates.errorMessage, null);
});

test('executeTool truncates oversized observation in trace entries', async () => {
  const executeTool = makeExecuteToolNode({
    async execute() {
      return {
        ok: true,
        toolName: 'read_note_full',
        usage: { noteReads: 1, retrievedChars: 0, remainingNoteReads: 1, remainingChars: 100 },
        data: {
          content: 'x'.repeat(5000),
        },
      };
    },
  });

  const updates = await executeTool({
    pendingToolName: 'read_note_full',
    pendingToolArgs: { filePath: 'notes/a.md' },
    pendingThought: 'Inspect note',
    toolCallCount: 0,
    modelProfile: { iterationLimit: 2 },
  });

  assert.equal(updates.toolCallCount, 1);
  assert.equal(Array.isArray(updates.trace), true);
  assert.match(updates.trace[0].observation, /\[\.\.\. truncated/);
});

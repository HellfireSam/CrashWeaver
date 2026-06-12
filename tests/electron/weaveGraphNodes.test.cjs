const test = require('node:test');
const assert = require('node:assert/strict');

const {
  makeCallModelNode,
  makeExecuteToolNode,
  makeRepairNode,
  makeFinalizeNode,
  makeValidateNode,
  makeFailNode,
} = require('../../dist-electron/weaver/weaveGraphNodes.js');

function makeMessage(role, content) {
  return { role, content };
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

test('callModel extracts JSON from markdown-fenced content', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent(
      '```json\n{"type":"final","thought":"Done via fence","plan":{"kind":"guided-insert","operations":[]}}\n```',
    ),
  );

  const updates = await node(makeBaseState());

  assert.equal(updates.pendingRoute, 'finalize');
  assert.equal(updates.pendingThought, 'Done via fence');
});

test('callModel extracts JSON from prose-embedded content', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent(
      'Here is my plan: {"type":"final","thought":"Embedded in prose","plan":{"kind":"guided-insert","operations":[]}} and that is all.',
    ),
  );

  const updates = await node(makeBaseState());

  assert.equal(updates.pendingRoute, 'finalize');
  assert.equal(updates.pendingThought, 'Embedded in prose');
});

test('callModel routes to repair-syntactic for content with braces but invalid JSON', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent(
      'Almost JSON but not quite: {"type": final, plan: {}}',
    ),
  );

  const updates = await node(makeBaseState());

  assert.equal(updates.pendingRoute, 'repair-syntactic');
});

test('callModel fails for content without any braces at all', async () => {
  const node = makeCallModelNode(
    makeHttpClientWithContent('No JSON here, just prose.'),
  );

  const updates = await node(makeBaseState());

  assert.equal(updates.pendingRoute, 'fail');
  assert.equal(updates.errorCategory, 'schema-error');
});

test('repair node handles repair-schema with error message', () => {
  const repair = makeRepairNode();

  const updates = repair({
    pendingRoute: 'repair-schema',
    repairAttemptCount: 0,
    errorMessage: 'Invalid boundary markers',
  });

  assert.equal(updates.repairAttemptCount, 1);
  assert.match(updates.messages[0].content, /boundary|cardUid/i);
});

test('repair node handles repair-exhaustion route', () => {
  const repair = makeRepairNode();

  const updates = repair({
    pendingRoute: 'repair-exhaustion',
    repairAttemptCount: 2,
    errorMessage: null,
  });

  assert.equal(updates.repairAttemptCount, 3);
  assert.match(updates.messages[0].content, /budget exhausted|TOOL BUDGET/i);
});

// ── finalize node ─────────────────────────────────────────────────────────────

test('finalizeNode wraps pendingPlanData into a WeavePlanResult shell', () => {
  const finalize = makeFinalizeNode();
  const startTime = Date.now() - 5000;

  const planData = {
    kind: 'guided-insert',
    permissions: { editContent: false, createNote: false },
    summary: 'A test plan.',
    operations: [{ kind: 'insert-boundary-pair', targetPath: 'notes/x.md', payload: {}, rationale: 'Test' }],
    warnings: [],
    referencedCards: ['CW-001'],
  };

  const updates = finalize({
    pendingPlanData: planData,
    resolvedModel: 'openai/gpt-4o-mini',
    accumulatedUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    startTimeMs: startTime,
    request: { kind: 'guided-insert', cardUid: 'CW-001' },
  });

  assert.ok(updates.result);
  assert.equal(updates.result.model, 'openai/gpt-4o-mini');
  assert.equal(updates.result.provider, 'openrouter');
  assert.deepEqual(updates.result.plan, planData);
  assert.equal(updates.result.usage.promptTokens, 10);
  assert.ok(updates.result.latencyMs >= 0);
  assert.equal(updates.pendingPlanData, null);
  assert.equal(updates.pendingRoute, null);
});

test('finalizeNode fails when request is missing', () => {
  const finalize = makeFinalizeNode();

  const updates = finalize({
    pendingPlanData: {},
    resolvedModel: 'test-model',
    accumulatedUsage: undefined,
    startTimeMs: Date.now(),
    request: null,
  });

  assert.equal(updates.pendingRoute, 'fail');
  assert.equal(updates.errorCategory, 'config-error');
  assert.match(updates.errorMessage, /missing request/i);
});

// ── validate node ─────────────────────────────────────────────────────────────

test('validateNode returns validated result on schema-valid plan', () => {
  const validate = makeValidateNode();
  const startTime = Date.now() - 1000;

  const plan = {
    kind: 'guided-insert',
    permissions: { editContent: false, createNote: false },
    summary: 'Valid plan.',
    operations: [
      {
        kind: 'insert-boundary-pair',
        targetPath: 'notes/overview.md',
        payload: {
          cardUid: 'CW-001',
          placement: 'append-to-note',
          boundaryBlock: '%%CW_CARD_START uid:CW-001%%\nValid content.\n%%CW_CARD_END uid:CW-001%%',
        },
        rationale: 'Insert the card.',
      },
    ],
    warnings: [],
    referencedCards: ['CW-001'],
  };

  const updates = validate({
    result: {
      plan,
      model: 'openai/gpt-4o-mini',
      provider: 'openrouter',
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      latencyMs: 500,
    },
    request: {
      kind: 'guided-insert',
      rootPath: 'D:/vault',
      cardUid: 'CW-001',
      permissions: { editContent: false, createNote: false },
      maxOperations: 8,
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp-1.crashpad.json',
    },
    repairAttemptCount: 0,
    modelProfile: { repairStrategy: 'aggressive', timeoutMs: 60_000 },
    startTimeMs: startTime,
    pendingThought: 'Final check',
    trace: [],
  });

  assert.ok(updates.result);
  assert.equal(updates.pendingRoute, null);
  assert.equal(updates.errorMessage, null);
  assert.ok(updates.result.trace.length > 0);
  assert.match(updates.result.trace[0].observation, /successfully validated|ready to apply/i);
});

test('validateNode routes to repair-schema on invalid plan', () => {
  const validate = makeValidateNode();
  const startTime = Date.now();

  const updates = validate({
    result: {
      plan: {
        kind: 'guided-insert',
        permissions: { editContent: false, createNote: false },
        summary: 'Invalid — no operations.',
        operations: [],  // empty → schema validation fails
        warnings: [],
        referencedCards: ['CW-001'],
      },
      model: 'openai/gpt-4o-mini',
      provider: 'openrouter',
      latencyMs: 100,
    },
    request: {
      kind: 'guided-insert',
      rootPath: 'D:/vault',
      cardUid: 'CW-001',
      permissions: { editContent: false, createNote: false },
      maxOperations: 8,
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp-1.crashpad.json',
    },
    repairAttemptCount: 0,
    modelProfile: { repairStrategy: 'aggressive', timeoutMs: 60_000 },
    startTimeMs: startTime,
    pendingThought: null,
    trace: [],
  });

  assert.equal(updates.pendingRoute, 'repair-schema');
  assert.ok(updates.errorMessage);
  assert.equal(updates.result, null);
  assert.ok(updates.trace.length > 0);
  assert.match(updates.trace[0].observation, /validation failed/i);
});

test('validateNode fails when repair budget exhausted', () => {
  const validate = makeValidateNode();
  const startTime = Date.now();

  const updates = validate({
    result: {
      plan: {
        kind: 'guided-insert',
        permissions: { editContent: false, createNote: false },
        summary: 'Invalid.',
        operations: [],
        warnings: [],
        referencedCards: ['CW-001'],
      },
      model: 'test',
      provider: 'openrouter',
      latencyMs: 100,
    },
    request: {
      kind: 'guided-insert',
      rootPath: 'D:/vault',
      cardUid: 'CW-001',
      permissions: { editContent: false, createNote: false },
      maxOperations: 8,
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp-1.crashpad.json',
    },
    repairAttemptCount: 2,  // already at max for aggressive
    modelProfile: { repairStrategy: 'aggressive', timeoutMs: 60_000 },
    startTimeMs: startTime,
    pendingThought: null,
    trace: [],
  });

  assert.equal(updates.pendingRoute, 'fail');
  assert.equal(updates.errorCategory, 'schema-error');
  assert.equal(updates.result, null);
});

// ── fail node ─────────────────────────────────────────────────────────────────

test('failNode seals error state with defaults when no error set', async () => {
  const fail = makeFailNode();
  const startTime = Date.now() - 3000;

  const updates = await fail({
    errorMessage: null,
    errorCategory: null,
    startTimeMs: startTime,
  });

  assert.equal(updates.errorCategory, 'provider-error');
  assert.match(updates.errorMessage, /unexpected error/i);
});

test('failNode preserves explicit error category and message', async () => {
  const fail = makeFailNode();
  const startTime = Date.now() - 2000;

  const updates = await fail({
    errorMessage: 'Custom auth failure',
    errorCategory: 'auth-error',
    startTimeMs: startTime,
  });

  assert.equal(updates.errorCategory, 'auth-error');
  assert.equal(updates.errorMessage, 'Custom auth failure');
});

// ── Progress callback ────────────────────────────────────────────────────────

test('callModel invokes onProgress with parsedAs=tool when tool action returned', async () => {
  let lastEvent = null;
  const onProgress = (event) => { lastEvent = event; };

  const node = makeCallModelNode(
    makeHttpClientWithContent(
      JSON.stringify({
        type: 'tool',
        thought: 'Need context',
        toolName: 'list_candidate_notes',
        arguments: { limit: 3 },
      }),
    ),
    undefined,
    onProgress,
  );

  await node(makeBaseState());

  assert.ok(lastEvent, 'onProgress should have been called');
  assert.equal(lastEvent.phase, 'call-model-end');
  assert.equal(lastEvent.parsedAs, 'tool');
});

test('callModel invokes onProgress with parsedAs=final when final action returned', async () => {
  let lastEvent = null;
  const onProgress = (event) => { lastEvent = event; };

  const node = makeCallModelNode(
    makeHttpClientWithContent(
      JSON.stringify({
        type: 'final',
        thought: 'Done',
        plan: { kind: 'guided-insert', operations: [] },
      }),
    ),
    undefined,
    onProgress,
  );

  await node(makeBaseState());

  assert.equal(lastEvent.phase, 'call-model-end');
  assert.equal(lastEvent.parsedAs, 'final');
});

test('executeTool invokes onProgress with start and end events', async () => {
  const events = [];
  const onProgress = (event) => { events.push(event); };

  const executeTool = makeExecuteToolNode(
    {
      async execute() {
        return { ok: true, toolName: 'list_candidate_notes', usage: {}, data: {} };
      },
    },
    undefined,
    onProgress,
  );

  await executeTool({
    pendingToolName: 'list_candidate_notes',
    pendingToolArgs: {},
    pendingThought: null,
    toolCallCount: 0,
    modelProfile: { iterationLimit: 2 },
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].phase, 'execute-tool-start');
  assert.equal(events[0].toolName, 'list_candidate_notes');
  assert.equal(events[1].phase, 'execute-tool-end');
  assert.equal(events[1].ok, true);
});

test('repair node invokes onProgress with repair type', () => {
  let lastEvent = null;
  const onProgress = (event) => { lastEvent = event; };

  const repair = makeRepairNode(undefined, onProgress);

  repair({
    pendingRoute: 'repair-syntactic',
    repairAttemptCount: 0,
    errorMessage: null,
  });

  assert.equal(lastEvent.phase, 'repair');
  assert.equal(lastEvent.repairType, 'repair-syntactic');
  assert.equal(lastEvent.repairAttempt, 1);
});

test('finalize node invokes onProgress with finalize-start', () => {
  let lastEvent = null;
  const onProgress = (event) => { lastEvent = event; };

  const finalize = makeFinalizeNode(undefined, onProgress);
  const startTime = Date.now() - 1000;

  finalize({
    pendingPlanData: { kind: 'guided-insert', operations: [] },
    resolvedModel: 'test-model',
    accumulatedUsage: undefined,
    startTimeMs: startTime,
    request: { kind: 'guided-insert', cardUid: 'CW-001' },
  });

  assert.equal(lastEvent.phase, 'finalize-start');
});

test('fail node invokes onProgress with graph-fail', async () => {
  let lastEvent = null;
  const onProgress = (event) => { lastEvent = event; };

  const fail = makeFailNode(undefined, onProgress);

  await fail({
    errorMessage: 'Something broke',
    errorCategory: 'provider-error',
    startTimeMs: Date.now() - 2000,
  });

  assert.equal(lastEvent.phase, 'graph-fail');
  assert.equal(lastEvent.error, 'Something broke');
  assert.equal(lastEvent.errorCategory, 'provider-error');
});

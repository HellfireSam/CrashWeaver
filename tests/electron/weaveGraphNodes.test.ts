import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  makeCallModelNode,
  makeExecuteToolNode,
  makeRepairNode,
  makeFinalizeNode,
  makeValidateNode,
  makeFailNode,
} = require('../../dist-electron/weaver/weaveGraphNodes.js');

describe('weaveGraphNodes', () => {
  type WeaveProgressEvent = {
    phase: string;
    parsedAs?: string;
    toolName?: string;
    ok?: boolean;
    repairType?: string;
    repairAttempt?: number;
    error?: string;
    errorCategory?: string;
  };

  function makeMessage(role: string, content: string) {
    return { role, content };
  }

  function makeProgressCapture() {
    const captured: { event: WeaveProgressEvent | null } = { event: null };

    return {
      captured,
      onProgress: (event: WeaveProgressEvent) => {
        captured.event = event;
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

  function makeHttpClientWithContent(content: string) {
    return {
      async chatCompletion() {
        return {
          content,
          resolvedModel: 'openai/gpt-4o-mini',
        };
      },
    };
  }

  it('callModel routes to execute-tool when tool action is valid and budget remains', async () => {
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

    expect(updates.pendingRoute).toBe('execute-tool');
    expect(updates.pendingToolName).toBe('list_candidate_notes');
    expect(updates.pendingToolArgs).toEqual({ limit: 3 });
  });

  it('callModel routes to repair-exhaustion when tool action requested after budget exhaustion', async () => {
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

    expect(updates.pendingRoute).toBe('repair-exhaustion');
  });

  it('callModel routes to finalize when final action is returned', async () => {
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

    expect(updates.pendingRoute).toBe('finalize');
    expect(updates.pendingPlanData).toEqual({ kind: 'guided-insert', operations: [] });
  });

  it('callModel routes to repair-semantic for bare plan without action envelope', async () => {
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

    expect(updates.pendingRoute).toBe('repair-semantic');
  });

  it('callModel routes to repair-semantic for syntactically-valid but wrong envelope', async () => {
    const node = makeCallModelNode(makeHttpClientWithContent(JSON.stringify({ foo: 'bar' })));

    const updates = await node(makeBaseState());

    expect(updates.pendingRoute).toBe('repair-semantic');
  });

  it('callModel fails with provider-timeout category when request already timed out', async () => {
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

    expect(updates.pendingRoute).toBe('fail');
    expect(updates.errorCategory).toBe('provider-timeout');
  });

  it('repair node increments repair attempt and clears route/error', async () => {
    const repair = makeRepairNode();

    const updates = repair({
      pendingRoute: 'repair-schema',
      repairAttemptCount: 1,
      errorMessage: 'Schema mismatch',
    });

    expect(updates.repairAttemptCount).toBe(2);
    expect(updates.pendingRoute).toBe(null);
    expect(updates.errorMessage).toBe(null);
  });

  it('executeTool truncates oversized observation in trace entries', async () => {
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

    expect(updates.toolCallCount).toBe(1);
    expect(Array.isArray(updates.trace)).toBe(true);
    expect(updates.trace[0].observation).toMatch(/\[\.\.\. truncated/);
  });

  it('callModel extracts JSON from markdown-fenced content', async () => {
    const node = makeCallModelNode(
      makeHttpClientWithContent(
        '```json\n{"type":"final","thought":"Done via fence","plan":{"kind":"guided-insert","operations":[]}}\n```',
      ),
    );

    const updates = await node(makeBaseState());

    expect(updates.pendingRoute).toBe('finalize');
    expect(updates.pendingThought).toBe('Done via fence');
  });

  it('callModel extracts JSON from prose-embedded content', async () => {
    const node = makeCallModelNode(
      makeHttpClientWithContent(
        'Here is my plan: {"type":"final","thought":"Embedded in prose","plan":{"kind":"guided-insert","operations":[]}} and that is all.',
      ),
    );

    const updates = await node(makeBaseState());

    expect(updates.pendingRoute).toBe('finalize');
    expect(updates.pendingThought).toBe('Embedded in prose');
  });

  it('callModel routes to repair-syntactic for content with braces but invalid JSON', async () => {
    const node = makeCallModelNode(
      makeHttpClientWithContent('Almost JSON but not quite: {"type": final, plan: {}}'),
    );

    const updates = await node(makeBaseState());

    expect(updates.pendingRoute).toBe('repair-syntactic');
  });

  it('callModel fails for content without any braces at all', async () => {
    const node = makeCallModelNode(makeHttpClientWithContent('No JSON here, just prose.'));

    const updates = await node(makeBaseState());

    expect(updates.pendingRoute).toBe('fail');
    expect(updates.errorCategory).toBe('schema-error');
  });

  it('repair node handles repair-schema with error message', () => {
    const repair = makeRepairNode();

    const updates = repair({
      pendingRoute: 'repair-schema',
      repairAttemptCount: 0,
      errorMessage: 'Invalid boundary markers',
    });

    expect(updates.repairAttemptCount).toBe(1);
    expect(updates.messages[0].content).toMatch(/boundary|cardUid/i);
  });

  it('repair node handles repair-exhaustion route', () => {
    const repair = makeRepairNode();

    const updates = repair({
      pendingRoute: 'repair-exhaustion',
      repairAttemptCount: 2,
      errorMessage: null,
    });

    expect(updates.repairAttemptCount).toBe(3);
    expect(updates.messages[0].content).toMatch(/budget exhausted|TOOL BUDGET/i);
  });

  // ── finalize node ─────────────────────────────────────────────────────────────

  it('finalizeNode wraps pendingPlanData into a WeavePlanResult shell', () => {
    const finalize = makeFinalizeNode();
    const startTime = Date.now() - 5000;

    const planData = {
      kind: 'guided-insert',
      permissions: { editContent: false, createNote: false },
      summary: 'A test plan.',
      operations: [
        { kind: 'insert-boundary-pair', targetPath: 'notes/x.md', payload: {}, rationale: 'Test' },
      ],
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

    expect(updates.result).toBeTruthy();
    expect(updates.result.model).toBe('openai/gpt-4o-mini');
    expect(updates.result.provider).toBe('openrouter');
    expect(updates.result.plan).toEqual(planData);
    expect(updates.result.usage.promptTokens).toBe(10);
    expect(updates.result.latencyMs >= 0).toBeTruthy();
    expect(updates.pendingPlanData).toBe(null);
    expect(updates.pendingRoute).toBe(null);
  });

  it('finalizeNode fails when request is missing', () => {
    const finalize = makeFinalizeNode();

    const updates = finalize({
      pendingPlanData: {},
      resolvedModel: 'test-model',
      accumulatedUsage: undefined,
      startTimeMs: Date.now(),
      request: null,
    });

    expect(updates.pendingRoute).toBe('fail');
    expect(updates.errorCategory).toBe('config-error');
    expect(updates.errorMessage).toMatch(/missing request/i);
  });

  // ── validate node ─────────────────────────────────────────────────────────────

  it('validateNode returns validated result on schema-valid plan', () => {
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
            boundaryBlock:
              '%%CW_CARD_START uid:CW-001%%\nValid content.\n%%CW_CARD_END uid:CW-001%%',
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

    expect(updates.result).toBeTruthy();
    expect(updates.pendingRoute).toBe(null);
    expect(updates.errorMessage).toBe(null);
    expect(updates.result.trace.length > 0).toBeTruthy();
    expect(updates.result.trace[0].observation).toMatch(/successfully validated|ready to apply/i);
  });

  it('validateNode routes to repair-schema on invalid plan', () => {
    const validate = makeValidateNode();
    const startTime = Date.now();

    const updates = validate({
      result: {
        plan: {
          kind: 'guided-insert',
          permissions: { editContent: false, createNote: false },
          summary: 'Invalid — no operations.',
          operations: [], // empty → schema validation fails
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

    expect(updates.pendingRoute).toBe('repair-schema');
    expect(updates.errorMessage).toBeTruthy();
    expect(updates.result).toBe(null);
    expect(updates.trace.length > 0).toBeTruthy();
    expect(updates.trace[0].observation).toMatch(/validation failed/i);
  });

  it('validateNode fails when repair budget exhausted', () => {
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
      repairAttemptCount: 2, // already at max for aggressive
      modelProfile: { repairStrategy: 'aggressive', timeoutMs: 60_000 },
      startTimeMs: startTime,
      pendingThought: null,
      trace: [],
    });

    expect(updates.pendingRoute).toBe('fail');
    expect(updates.errorCategory).toBe('schema-error');
    expect(updates.result).toBe(null);
  });

  // ── fail node ─────────────────────────────────────────────────────────────────

  it('failNode seals error state with defaults when no error set', async () => {
    const fail = makeFailNode();
    const startTime = Date.now() - 3000;

    const updates = await fail({
      errorMessage: null,
      errorCategory: null,
      startTimeMs: startTime,
    });

    expect(updates.errorCategory).toBe('provider-error');
    expect(updates.errorMessage).toMatch(/unexpected error/i);
  });

  it('failNode preserves explicit error category and message', async () => {
    const fail = makeFailNode();
    const startTime = Date.now() - 2000;

    const updates = await fail({
      errorMessage: 'Custom auth failure',
      errorCategory: 'auth-error',
      startTimeMs: startTime,
    });

    expect(updates.errorCategory).toBe('auth-error');
    expect(updates.errorMessage).toBe('Custom auth failure');
  });

  // ── Progress callback ────────────────────────────────────────────────────────

  it('callModel invokes onProgress with parsedAs=tool when tool action returned', async () => {
    const { captured, onProgress } = makeProgressCapture();

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

    expect(captured.event, 'onProgress should have been called').toBeTruthy();
    expect(captured.event?.phase).toBe('call-model-end');
    expect(captured.event?.parsedAs).toBe('tool');
  });

  it('callModel invokes onProgress with parsedAs=final when final action returned', async () => {
    const { captured, onProgress } = makeProgressCapture();

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

    expect(captured.event?.phase).toBe('call-model-end');
    expect(captured.event?.parsedAs).toBe('final');
  });

  it('executeTool invokes onProgress with start and end events', async () => {
    const events: WeaveProgressEvent[] = [];
    const onProgress = (event: WeaveProgressEvent) => {
      events.push(event);
    };

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

    expect(events.length).toBe(2);
    expect(events[0].phase).toBe('execute-tool-start');
    expect(events[0].toolName).toBe('list_candidate_notes');
    expect(events[1].phase).toBe('execute-tool-end');
    expect(events[1].ok).toBe(true);
  });

  it('repair node invokes onProgress with repair type', () => {
    const { captured, onProgress } = makeProgressCapture();

    const repair = makeRepairNode(undefined, onProgress);

    repair({
      pendingRoute: 'repair-syntactic',
      repairAttemptCount: 0,
      errorMessage: null,
    });

    expect(captured.event?.phase).toBe('repair');
    expect(captured.event?.repairType).toBe('repair-syntactic');
    expect(captured.event?.repairAttempt).toBe(1);
  });

  it('finalize node invokes onProgress with finalize-start', () => {
    const { captured, onProgress } = makeProgressCapture();

    const finalize = makeFinalizeNode(undefined, onProgress);
    const startTime = Date.now() - 1000;

    finalize({
      pendingPlanData: { kind: 'guided-insert', operations: [] },
      resolvedModel: 'test-model',
      accumulatedUsage: undefined,
      startTimeMs: startTime,
      request: { kind: 'guided-insert', cardUid: 'CW-001' },
    });

    expect(captured.event?.phase).toBe('finalize-start');
  });

  it('fail node invokes onProgress with graph-fail', async () => {
    const { captured, onProgress } = makeProgressCapture();

    const fail = makeFailNode(undefined, onProgress);

    await fail({
      errorMessage: 'Something broke',
      errorCategory: 'provider-error',
      startTimeMs: Date.now() - 2000,
    });

    expect(captured.event?.phase).toBe('graph-fail');
    expect(captured.event?.error).toBe('Something broke');
    expect(captured.event?.errorCategory).toBe('provider-error');
  });
});

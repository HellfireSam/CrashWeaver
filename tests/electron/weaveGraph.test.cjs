const test = require('node:test');
const assert = require('node:assert/strict');

const { runWeaveGraph } = require('../../dist-electron/weaver/weaveGraph.js');

function makeContextSnapshot(rootPath) {
  return {
    rootPath,
    requestKind: 'guided-insert',
    intent: 'Insert focused card into the most relevant note.',
    activeNotePath: 'notes/overview.md',
    selectedText: undefined,
    card: {
      uid: 'CW-001',
      type: ['concept'],
      rawContentExcerpt: 'Focused card content',
      memoryTechnique: 'mnemonic',
      qaPairs: [],
      referencedIn: [],
    },
    candidateNotes: [
      {
        filePath: 'notes/overview.md',
        title: 'Overview',
        tags: ['concept'],
        updatedAt: '2026-01-01T00:00:00.000Z',
        directoryPath: 'notes',
        score: 99,
        reasons: ['Active note'],
      },
    ],
    directorySummaries: [
      {
        directoryPath: 'notes',
        noteCount: 1,
        candidateCount: 1,
        sampleNotes: ['notes/overview.md'],
        score: 99,
        reasons: ['Top candidate'],
      },
    ],
    retrievalBudget: {
      maxCandidateNotes: 8,
      maxDirectorySummaries: 6,
      maxNoteReads: 2,
      maxExcerptChars: 1200,
      maxFullNoteChars: 3200,
      maxRetrievedChars: 3600,
    },
    warnings: [],
  };
}

function makeRequest(rootPath) {
  return {
    rootPath,
    kind: 'guided-insert',
    preferredModel: 'openai/gpt-4o-mini',
    intent: 'Insert into overview note',
    cardUid: 'CW-001',
    permissions: {
      editContent: false,
      createNote: false,
    },
    activeNotePath: 'notes/overview.md',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
    maxOperations: 6,
  };
}

function makeModelProfile() {
  return {
    structuredOutputMode: 'fences_and_braces',
    systemPromptOverlay: '',
    repairStrategy: 'aggressive',
    maxTokens: 1400,
    timeoutMs: 60_000,
    temperature: 0.2,
    iterationLimit: 3,
    responseFormatParams: undefined,
  };
}

test('runWeaveGraph accumulates trace across semantic-repair, tool, and validate steps', async () => {
  const rootPath = 'D:/vault';
  const request = makeRequest(rootPath);
  const contextSnapshot = makeContextSnapshot(rootPath);
  const modelProfile = makeModelProfile();

  let callCount = 0;
  const httpClient = {
    async chatCompletion() {
      callCount += 1;

      if (callCount === 1) {
        // Valid JSON, wrong envelope => semantic repair trace item.
        return {
          content: JSON.stringify({ foo: 'bar' }),
          resolvedModel: 'openai/gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }

      if (callCount === 2) {
        // Tool action.
        return {
          content: JSON.stringify({
            type: 'tool',
            thought: 'Need candidate notes first',
            toolName: 'list_candidate_notes',
            arguments: { limit: 1 },
          }),
          resolvedModel: 'openai/gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }

      // Final plan action.
      return {
        content: JSON.stringify({
          type: 'final',
          thought: 'Enough context gathered',
          plan: {
            kind: 'guided-insert',
            permissions: { editContent: false, createNote: false },
            summary: 'Insert card boundary into the overview note.',
            operations: [
              {
                kind: 'insert-boundary-pair',
                targetPath: 'notes/overview.md',
                payload: {
                  cardUid: 'CW-001',
                  placement: 'append-to-note',
                  boundaryBlock: '%%CW_CARD_START uid:CW-001%%\nA concise concept summary.\n%%CW_CARD_END uid:CW-001%%',
                },
                rationale: 'Append the focused card to the overview note.',
              },
            ],
            warnings: [],
            referencedCards: ['CW-001'],
          },
        }),
        resolvedModel: 'openai/gpt-4o-mini',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };

  const toolRuntime = {
    async execute() {
      return {
        ok: true,
        toolName: 'list_candidate_notes',
        usage: { noteReads: 0, retrievedChars: 0, remainingNoteReads: 2, remainingChars: 3600 },
        data: { notes: [{ filePath: 'notes/overview.md' }] },
      };
    },
  };

  const result = await runWeaveGraph(
    request,
    contextSnapshot,
    modelProfile,
    'openai/gpt-4o-mini',
    httpClient,
    toolRuntime,
    undefined,
  );

  assert.ok(result.trace);
  // semantic-repair trace + execute-tool trace + final validate trace
  assert.ok(result.trace.length >= 3, `Expected at least 3 trace items, got ${result.trace.length}`);
  assert.match(result.trace[0].observation || '', /Semantic repair triggered/i);
});

test('runWeaveGraph records repair-exhaustion trace when model requests tools after budget limit', async () => {
  const rootPath = 'D:/vault';
  const request = makeRequest(rootPath);
  const contextSnapshot = makeContextSnapshot(rootPath);
  const modelProfile = {
    ...makeModelProfile(),
    iterationLimit: 1,
  };

  let callCount = 0;
  const httpClient = {
    async chatCompletion() {
      callCount += 1;

      if (callCount === 1) {
        return {
          content: JSON.stringify({
            type: 'tool',
            thought: 'Need candidate note list',
            toolName: 'list_candidate_notes',
            arguments: { limit: 1 },
          }),
          resolvedModel: 'openai/gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }

      if (callCount === 2) {
        // Exceeds iterationLimit=1 and should route through repair-exhaustion.
        return {
          content: JSON.stringify({
            type: 'tool',
            thought: 'Need full note content too',
            toolName: 'read_note_full',
            arguments: { filePath: 'notes/overview.md' },
          }),
          resolvedModel: 'openai/gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }

      return {
        content: JSON.stringify({
          type: 'final',
          thought: 'Budget exhausted, finalizing with available evidence',
          plan: {
            kind: 'guided-insert',
            permissions: { editContent: false, createNote: false },
            summary: 'Insert card boundary into overview note after budget exhaustion.',
            operations: [
              {
                kind: 'insert-boundary-pair',
                targetPath: 'notes/overview.md',
                payload: {
                  cardUid: 'CW-001',
                  placement: 'append-to-note',
                  boundaryBlock: '%%CW_CARD_START uid:CW-001%%\nExhaustion-safe proposal content.\n%%CW_CARD_END uid:CW-001%%',
                },
                rationale: 'Use gathered evidence to provide a conservative insertion plan.',
              },
            ],
            warnings: ['Tool budget exhausted before reading additional notes.'],
            referencedCards: ['CW-001'],
          },
        }),
        resolvedModel: 'openai/gpt-4o-mini',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };

  const toolRuntime = {
    async execute() {
      return {
        ok: true,
        toolName: 'list_candidate_notes',
        usage: { noteReads: 0, retrievedChars: 0, remainingNoteReads: 2, remainingChars: 3600 },
        data: { notes: [{ filePath: 'notes/overview.md' }] },
      };
    },
  };

  const result = await runWeaveGraph(
    request,
    contextSnapshot,
    modelProfile,
    'openai/gpt-4o-mini',
    httpClient,
    toolRuntime,
    undefined,
  );

  assert.ok(result.trace);
  const exhaustionEntry = result.trace.find((step) =>
    /budget of 1 tool calls exhausted/i.test(step.observation || ''),
  );
  assert.ok(exhaustionEntry, 'Expected trace to include repair-exhaustion observation.');
});

test('runWeaveGraph transitions through schema-repair and succeeds on corrected final plan', async () => {
  const rootPath = 'D:/vault';
  const request = makeRequest(rootPath);
  const contextSnapshot = makeContextSnapshot(rootPath);
  const modelProfile = makeModelProfile();

  let callCount = 0;
  const httpClient = {
    async chatCompletion() {
      callCount += 1;

      if (callCount === 1) {
        // Invalid plan: empty operations should fail schema validation.
        return {
          content: JSON.stringify({
            type: 'final',
            thought: 'Initial draft plan',
            plan: {
              kind: 'guided-insert',
              permissions: { editContent: false, createNote: false },
              summary: 'Draft plan with no operations.',
              operations: [],
              warnings: ['Insufficient context.'],
              referencedCards: ['CW-001'],
            },
          }),
          resolvedModel: 'openai/gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }

      // Corrected plan after schema repair message.
      return {
        content: JSON.stringify({
          type: 'final',
          thought: 'Corrected to satisfy schema requirements',
          plan: {
            kind: 'guided-insert',
            permissions: { editContent: false, createNote: false },
            summary: 'Insert card boundary into overview note.',
            operations: [
              {
                kind: 'insert-boundary-pair',
                targetPath: 'notes/overview.md',
                payload: {
                  cardUid: 'CW-001',
                  placement: 'append-to-note',
                  boundaryBlock: '%%CW_CARD_START uid:CW-001%%\nSchema-repaired plan content.\n%%CW_CARD_END uid:CW-001%%',
                },
                rationale: 'Add a valid insertion operation after schema repair.',
              },
            ],
            warnings: [],
            referencedCards: ['CW-001'],
          },
        }),
        resolvedModel: 'openai/gpt-4o-mini',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };

  const toolRuntime = {
    async execute() {
      throw new Error('Tool runtime should not be called in schema-repair path test.');
    },
  };

  const result = await runWeaveGraph(
    request,
    contextSnapshot,
    modelProfile,
    'openai/gpt-4o-mini',
    httpClient,
    toolRuntime,
    undefined,
  );

  assert.ok(result.trace);
  const schemaRepairEntry = result.trace.find((step) =>
    /validation failed:/i.test(step.observation || ''),
  );
  assert.ok(schemaRepairEntry, 'Expected trace to include schema-repair transition entry.');
  assert.equal(result.plan.operations.length, 1);
});

test('runWeaveGraph fails after semantic repair ceiling is exhausted', async () => {
  const rootPath = 'D:/vault';
  const request = makeRequest(rootPath);
  const contextSnapshot = makeContextSnapshot(rootPath);
  const modelProfile = {
    ...makeModelProfile(),
    repairStrategy: 'aggressive',
  };

  const httpClient = {
    async chatCompletion() {
      // Valid JSON but invalid envelope on every attempt, forcing semantic repair.
      return {
        content: JSON.stringify({ invalid: true }),
        resolvedModel: 'openai/gpt-4o-mini',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };

  const toolRuntime = {
    async execute() {
      throw new Error('Tool runtime should not be called in semantic repair ceiling test.');
    },
  };

  await assert.rejects(
    runWeaveGraph(
      request,
      contextSnapshot,
      modelProfile,
      'openai/gpt-4o-mini',
      httpClient,
      toolRuntime,
      undefined,
    ),
    /invalid planning action/i,
  );
});

test('runWeaveGraph preserves tool diagnostics on trace entries', async () => {
  const rootPath = 'D:/vault';
  const request = makeRequest(rootPath);
  const contextSnapshot = makeContextSnapshot(rootPath);
  const modelProfile = makeModelProfile();

  let callCount = 0;
  const httpClient = {
    async chatCompletion() {
      callCount += 1;

      if (callCount === 1) {
        return {
          content: JSON.stringify({
            type: 'tool',
            thought: 'Need excerpt before proposing insert',
            toolName: 'read_note_excerpt',
            arguments: { filePath: 'notes/overview.md' },
          }),
          resolvedModel: 'openai/gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      }

      return {
        content: JSON.stringify({
          type: 'final',
          thought: 'Proceeding with available context',
          plan: {
            kind: 'guided-insert',
            permissions: { editContent: false, createNote: false },
            summary: 'Insert card boundary into overview note despite retrieval cap.',
            operations: [
              {
                kind: 'insert-boundary-pair',
                targetPath: 'notes/overview.md',
                payload: {
                  cardUid: 'CW-001',
                  placement: 'append-to-note',
                  boundaryBlock: '%%CW_CARD_START uid:CW-001%%\nBudget-limited insertion content.\n%%CW_CARD_END uid:CW-001%%',
                },
                rationale: 'Finalize with conservative insertion when retrieval is capped.',
              },
            ],
            warnings: ['Retrieval character budget was exhausted.'],
            referencedCards: ['CW-001'],
          },
        }),
        resolvedModel: 'openai/gpt-4o-mini',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    },
  };

  const toolRuntime = {
    async execute() {
      return {
        ok: false,
        toolName: 'read_note_excerpt',
        usage: { noteReads: 1, retrievedChars: 1200, remainingNoteReads: 1, remainingChars: 0 },
        error: 'Maximum retrieved character budget reached.',
        diagnostics: {
          code: 'budget-chars-exhausted',
          recoverable: true,
        },
      };
    },
  };

  const result = await runWeaveGraph(
    request,
    contextSnapshot,
    modelProfile,
    'openai/gpt-4o-mini',
    httpClient,
    toolRuntime,
    undefined,
  );

  assert.ok(result.trace);
  const diagnosticTrace = result.trace.find((step) => step.diagnostics?.code === 'budget-chars-exhausted');
  assert.ok(diagnosticTrace, 'Expected trace to include structured tool diagnostics code.');
});

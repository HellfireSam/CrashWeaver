import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  buildSystemPrompt,
  buildRequestSpecification,
  buildContextLayer,
  buildInitialUserTurn,
  buildObservationMessage,
  buildSyntacticRepairMessage,
  buildSemanticRepairMessage,
  buildSchemaRepairMessage,
  buildExhaustionRepairMessage,
} = require('../../dist-electron/weaver/weavePlanPrompts.js');

describe('weavePlanPrompts', () => {
  const profile = {
    structuredOutputMode: 'fences_and_braces',
    systemPromptOverlay: '',
    repairStrategy: 'aggressive',
    maxTokens: 1500,
    timeoutMs: 30000,
    temperature: 0.2,
    iterationLimit: 2,
  };

  it('guided insert prompt forbids note edits and note creation when permissions are disabled', () => {
    const message = buildRequestSpecification({
      rootPath: 'D:/vault',
      kind: 'guided-insert',
      intent: 'Place the card in the graph notes.',
      cardUid: 'CW-001',
      permissions: {
        editContent: false,
        createNote: false,
      },
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
      activeNotePath: 'notes/graph.md',
      maxOperations: 4,
    });

    expect(message).toMatch(/Do not change surrounding note prose|Do not emit edit-note-content/i);
    expect(message).toMatch(/Do not create new notes|Do not emit create-note/i);
  });

  it('system instruction frames crashpad as source-only and create-note as substantive', () => {
    const instruction = buildSystemPrompt(profile, 2, 1);

    expect(instruction).toMatch(/Crashpad is source context only/i);
    expect(instruction).toMatch(
      /create-note.*must.*meaningful markdown prose|create-note payload must contain substantive markdown prose/i,
    );
  });

  it('intelligent prompt describes vault-wide note and directory restructuring', () => {
    const message = buildRequestSpecification({
      rootPath: 'D:/vault',
      kind: 'intelligent',
      strength: 'go-ham',
      intent: 'Restructure the graph theory cluster.',
      cardUid: 'CW-001',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
      activeNotePath: 'notes/graph.md',
      maxOperations: 8,
    });

    expect(message).toMatch(
      /note and directory create, edit, move, rename, and delete operations/i,
    );
    expect(message).toMatch(/GO HAM/i);
  });

  // ── Context layer ─────────────────────────────────────────────────────────────

  it('buildContextLayer includes focused card uid, type, and referenced notes', () => {
    const snapshot = {
      rootPath: 'D:/vault',
      requestKind: 'intelligent',
      intent: 'Restructure around graph theory',
      card: {
        uid: 'CW-001',
        type: ['concept', 'math'],
        rawContentExcerpt: 'A graph is a set of vertices connected by edges.',
        memoryTechnique: 'Nodes and edges',
        qaPairs: [],
        referencedIn: [{ notePath: 'notes/graph.md', startLine: 2, endLine: 5 }],
      },
      candidateNotes: [
        {
          filePath: 'notes/graph.md',
          title: 'Graph Theory',
          tags: ['math'],
          updatedAt: '2026-01-01T00:00:00Z',
          directoryPath: 'notes',
          score: 220,
          reasons: ['Card already references this note.'],
        },
      ],
      directorySummaries: [
        {
          directoryPath: 'notes',
          noteCount: 3,
          candidateCount: 1,
          sampleNotes: ['notes/graph.md'],
          score: 220,
          reasons: ['Contains existing card references.'],
        },
      ],
      retrievalBudget: {
        maxCandidateNotes: 10,
        maxDirectorySummaries: 8,
        maxNoteReads: 2,
        maxExcerptChars: 1400,
        maxFullNoteChars: 4200,
        maxRetrievedChars: 7000,
      },
      warnings: [],
    };

    const ctx = buildContextLayer(snapshot);

    expect(ctx).toMatch(/Focused Card: CW-001/);
    expect(ctx).toMatch(/Type: concept, math/);
    expect(ctx).toMatch(/Already referenced in: notes\/graph\.md/);
    expect(ctx).toMatch(/Candidate Notes/);
    expect(ctx).toMatch(/notes\/graph\.md/);
    expect(ctx).toMatch(/Score: 220/);
    expect(ctx).toMatch(/Why included: Card already references/);
    expect(ctx).toMatch(/Directory Summaries/);
  });

  it('buildContextLayer warns when no candidate notes are ranked', () => {
    const snapshot = {
      rootPath: 'D:/vault',
      requestKind: 'intelligent',
      intent: 'Test',
      card: {
        uid: 'CW-001',
        type: [],
        rawContentExcerpt: '',
        memoryTechnique: '',
        qaPairs: [],
        referencedIn: [],
      },
      candidateNotes: [],
      directorySummaries: [],
      retrievalBudget: {
        maxCandidateNotes: 10,
        maxDirectorySummaries: 8,
        maxNoteReads: 2,
        maxExcerptChars: 1400,
        maxFullNoteChars: 4200,
        maxRetrievedChars: 7000,
      },
      warnings: ['No candidate notes ranked above zero.'],
    };

    const ctx = buildContextLayer(snapshot);

    expect(ctx).toMatch(/No candidate notes pre-loaded/);
    expect(ctx).toMatch(/Retrieval Warnings/);
    expect(ctx).toMatch(/No candidate notes ranked above zero/);
  });

  // ── Initial user turn ─────────────────────────────────────────────────────────

  it('buildInitialUserTurn carries the request spec and context without repeating the budget', () => {
    const request = {
      rootPath: 'D:/vault',
      kind: 'guided-insert',
      intent: 'Insert into graph notes.',
      cardUid: 'CW-001',
      permissions: { editContent: false, createNote: false },
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/cp-1.crashpad.json',
      activeNotePath: 'notes/graph.md',
      maxOperations: 6,
    };

    const snapshot = {
      rootPath: 'D:/vault',
      requestKind: 'guided-insert',
      intent: 'Insert into graph notes.',
      card: {
        uid: 'CW-001',
        type: [],
        rawContentExcerpt: '',
        memoryTechnique: '',
        qaPairs: [],
        referencedIn: [],
      },
      candidateNotes: [],
      directorySummaries: [],
      retrievalBudget: {
        maxCandidateNotes: 8,
        maxDirectorySummaries: 6,
        maxNoteReads: 1,
        maxExcerptChars: 1200,
        maxFullNoteChars: 3200,
        maxRetrievedChars: 3600,
      },
      warnings: [],
    };

    const effectiveBudget = { promptToolCalls: 1, runtimeNoteReads: 1, maxRetrievedChars: 3600 };

    const turn = buildInitialUserTurn(request, snapshot, effectiveBudget);

    expect(turn).toMatch(/REQUEST SPECIFICATION/);
    expect(turn).toMatch(/Focused card UID: CW-001/);
    expect(turn).toMatch(/VAULT CONTEXT SNAPSHOT/);

    // The budget reminder deliberately lives in the system prompt's tool-loop
    // layer only; the user turn must not repeat it.
    expect(turn).not.toMatch(/read-only tool call/i);
    expect(turn).not.toMatch(/Total retrieval character budget/i);

    // Each phrase asserted absent above is asserted present here, so the coverage
    // moved rather than vanished.
    const systemPrompt = buildSystemPrompt(profile, 'guided-insert', 1, 1, 3600);
    expect(systemPrompt).toMatch(/You have at most 1 tool call available/);
    expect(systemPrompt).toMatch(/Note-read budget: at most 1 note read/i);
    expect(systemPrompt).toMatch(/Total retrieval character budget: up to 3600 chars/i);
  });

  // ── Observation message ───────────────────────────────────────────────────────

  it('buildObservationMessage formats successful tool result', () => {
    const result = {
      ok: true,
      toolName: 'read_note_excerpt',
      usage: {},
      data: { content: 'Found relevant text.' },
    };
    const msg = buildObservationMessage('read_note_excerpt', result, 2);

    expect(msg).toMatch(/TOOL RESULT: read_note_excerpt/);
    expect(msg).toMatch(/Status: SUCCESS/);
    expect(msg).toMatch(/Tool calls remaining: 2/);
  });

  it('buildObservationMessage formats error tool result', () => {
    const result = { ok: false, toolName: 'read_note_full', error: 'Budget exhausted.' };
    const msg = buildObservationMessage('read_note_full', result, 0);

    expect(msg).toMatch(/TOOL RESULT: read_note_full/);
    expect(msg).toMatch(/Status: ERROR/);
    expect(msg).toMatch(/Budget exhausted/);
    expect(msg).toMatch(/TOOL BUDGET EXHAUSTED/);
  });

  // ── Repair messages ───────────────────────────────────────────────────────────

  it('buildSyntacticRepairMessage directs model to fix JSON formatting', () => {
    const msg = buildSyntacticRepairMessage();
    expect(msg).toMatch(/JSON PARSE ERROR/i);
    expect(msg).toMatch(/raw JSON object only/i);
    expect(msg).toMatch(/"type": "tool"/);
    expect(msg).toMatch(/"type": "final"/);
  });

  it('buildSemanticRepairMessage directs model to use correct action envelope', () => {
    const msg = buildSemanticRepairMessage();
    expect(msg).toMatch(/INVALID ACTION ENVELOPE/i);
    expect(msg).toMatch(/"thought"/);
  });

  it('buildSchemaRepairMessage includes the specific validation error', () => {
    const msg = buildSchemaRepairMessage('Boundary markers must include card UID CW-001.');
    expect(msg).toMatch(/PLAN SCHEMA VALIDATION FAILED/i);
    expect(msg).toMatch(/CW-001/);
    expect(msg).toMatch(/referencedCards contains the exact focused card UID/i);
  });

  it('buildExhaustionRepairMessage forces immediate finalization', () => {
    const msg = buildExhaustionRepairMessage();
    expect(msg).toMatch(/TOOL BUDGET EXHAUSTED/i);
    expect(msg).toMatch(/"type": "final"/);
    expect(msg).toMatch(/evidence gathered/i);
  });
});

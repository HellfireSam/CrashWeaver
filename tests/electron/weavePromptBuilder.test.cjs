const test = require('node:test');
const assert = require('node:assert/strict');

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

const profile = {
  structuredOutputMode: 'fences_and_braces',
  systemPromptOverlay: '',
  repairStrategy: 'aggressive',
  maxTokens: 1500,
  timeoutMs: 30000,
  temperature: 0.2,
  iterationLimit: 2,
};

test('guided insert prompt forbids note edits and note creation when permissions are disabled', () => {
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

  assert.match(message, /Do not change surrounding note prose|Do not emit edit-note-content/i);
  assert.match(message, /Do not create new notes|Do not emit create-note/i);
});

test('system instruction frames crashpad as source-only and create-note as substantive', () => {
  const instruction = buildSystemPrompt(profile, 2, 1);

  assert.match(instruction, /Crashpad is source context only/i);
  assert.match(instruction, /create-note.*must.*meaningful markdown prose|create-note payload must contain substantive markdown prose/i);
});

test('intelligent prompt describes vault-wide note and directory restructuring', () => {
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

  assert.match(message, /note and directory create, edit, move, rename, and delete operations/i);
  assert.match(message, /GO HAM/i);
});

// ── Context layer ─────────────────────────────────────────────────────────────

test('buildContextLayer includes focused card uid, type, and referenced notes', () => {
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
      { filePath: 'notes/graph.md', title: 'Graph Theory', tags: ['math'], updatedAt: '2026-01-01T00:00:00Z', directoryPath: 'notes', score: 220, reasons: ['Card already references this note.'] },
    ],
    directorySummaries: [
      { directoryPath: 'notes', noteCount: 3, candidateCount: 1, sampleNotes: ['notes/graph.md'], score: 220, reasons: ['Contains existing card references.'] },
    ],
    retrievalBudget: { maxCandidateNotes: 10, maxDirectorySummaries: 8, maxNoteReads: 2, maxExcerptChars: 1400, maxFullNoteChars: 4200, maxRetrievedChars: 7000 },
    warnings: [],
  };

  const ctx = buildContextLayer(snapshot);

  assert.match(ctx, /Focused Card: CW-001/);
  assert.match(ctx, /Type: concept, math/);
  assert.match(ctx, /Already referenced in: notes\/graph\.md/);
  assert.match(ctx, /Candidate Notes/);
  assert.match(ctx, /notes\/graph\.md/);
  assert.match(ctx, /Score: 220/);
  assert.match(ctx, /Why included: Card already references/);
  assert.match(ctx, /Directory Summaries/);
});

test('buildContextLayer warns when no candidate notes are ranked', () => {
  const snapshot = {
    rootPath: 'D:/vault',
    requestKind: 'intelligent',
    intent: 'Test',
    card: { uid: 'CW-001', type: [], rawContentExcerpt: '', memoryTechnique: '', qaPairs: [], referencedIn: [] },
    candidateNotes: [],
    directorySummaries: [],
    retrievalBudget: { maxCandidateNotes: 10, maxDirectorySummaries: 8, maxNoteReads: 2, maxExcerptChars: 1400, maxFullNoteChars: 4200, maxRetrievedChars: 7000 },
    warnings: ['No candidate notes ranked above zero.'],
  };

  const ctx = buildContextLayer(snapshot);

  assert.match(ctx, /No candidate notes pre-loaded/);
  assert.match(ctx, /Retrieval Warnings/);
  assert.match(ctx, /No candidate notes ranked above zero/);
});

// ── Initial user turn ─────────────────────────────────────────────────────────

test('buildInitialUserTurn includes request spec, context, and budget reminder', () => {
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
    card: { uid: 'CW-001', type: [], rawContentExcerpt: '', memoryTechnique: '', qaPairs: [], referencedIn: [] },
    candidateNotes: [],
    directorySummaries: [],
    retrievalBudget: { maxCandidateNotes: 8, maxDirectorySummaries: 6, maxNoteReads: 1, maxExcerptChars: 1200, maxFullNoteChars: 3200, maxRetrievedChars: 3600 },
    warnings: [],
  };

  const effectiveBudget = { promptToolCalls: 1, runtimeNoteReads: 1, maxRetrievedChars: 3600 };

  const turn = buildInitialUserTurn(request, snapshot, effectiveBudget);

  assert.match(turn, /REQUEST SPECIFICATION/);
  assert.match(turn, /Focused card UID: CW-001/);
  assert.match(turn, /VAULT CONTEXT SNAPSHOT/);
  assert.match(turn, /read-only tool call/);
});

// ── Observation message ───────────────────────────────────────────────────────

test('buildObservationMessage formats successful tool result', () => {
  const result = { ok: true, toolName: 'read_note_excerpt', usage: {}, data: { content: 'Found relevant text.' } };
  const msg = buildObservationMessage('read_note_excerpt', result, 2);

  assert.match(msg, /TOOL RESULT: read_note_excerpt/);
  assert.match(msg, /Status: SUCCESS/);
  assert.match(msg, /Tool calls remaining: 2/);
});

test('buildObservationMessage formats error tool result', () => {
  const result = { ok: false, toolName: 'read_note_full', error: 'Budget exhausted.' };
  const msg = buildObservationMessage('read_note_full', result, 0);

  assert.match(msg, /TOOL RESULT: read_note_full/);
  assert.match(msg, /Status: ERROR/);
  assert.match(msg, /Budget exhausted/);
  assert.match(msg, /TOOL BUDGET EXHAUSTED/);
});

// ── Repair messages ───────────────────────────────────────────────────────────

test('buildSyntacticRepairMessage directs model to fix JSON formatting', () => {
  const msg = buildSyntacticRepairMessage();
  assert.match(msg, /JSON PARSE ERROR/i);
  assert.match(msg, /raw JSON object only/i);
  assert.match(msg, /"type": "tool"/);
  assert.match(msg, /"type": "final"/);
});

test('buildSemanticRepairMessage directs model to use correct action envelope', () => {
  const msg = buildSemanticRepairMessage();
  assert.match(msg, /INVALID ACTION ENVELOPE/i);
  assert.match(msg, /"thought"/);
});

test('buildSchemaRepairMessage includes the specific validation error', () => {
  const msg = buildSchemaRepairMessage('Boundary markers must include card UID CW-001.');
  assert.match(msg, /PLAN SCHEMA VALIDATION FAILED/i);
  assert.match(msg, /CW-001/);
  assert.match(msg, /referencedCards contains the exact focused card UID/i);
});

test('buildExhaustionRepairMessage forces immediate finalization', () => {
  const msg = buildExhaustionRepairMessage();
  assert.match(msg, /TOOL BUDGET EXHAUSTED/i);
  assert.match(msg, /"type": "final"/);
  assert.match(msg, /evidence gathered/i);
});
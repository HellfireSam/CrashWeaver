const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSystemPrompt,
  buildRequestSpecification,
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
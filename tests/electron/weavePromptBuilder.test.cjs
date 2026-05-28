const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSystemInstruction,
  buildUserMessage,
} = require('../../dist-electron/weaver/weavePromptBuilder.js');

test('guided insert prompt forbids note edits and note creation when permissions are disabled', () => {
  const message = buildUserMessage({
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

  assert.match(message, /Do not change surrounding note prose/i);
  assert.match(message, /Do not create new notes/i);
});

test('system instruction frames crashpad as source-only and create-note as substantive', () => {
  const instruction = buildSystemInstruction();

  assert.match(instruction, /Crashpad is source context only/i);
  assert.match(instruction, /create-note proposal must include meaningful markdown prose/i);
});

test('intelligent prompt describes vault-wide note and directory restructuring', () => {
  const message = buildUserMessage({
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
  assert.match(message, /GO HAM autonomy/i);
});
const test = require('node:test');
const assert = require('node:assert/strict');

const { StubWeaveProvider } = require('../../dist-electron/weaver/stubWeaveProvider.js');

function createGuidedRequest(overrides = {}) {
  return {
    rootPath: 'D:/vault',
    kind: 'guided-insert',
    preferredModel: 'openai/gpt-4o',
    intent: 'Place the focused card near graph notes.',
    cardUid: 'CW-001',
    permissions: {
      editContent: false,
      createNote: false,
    },
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
    activeNotePath: 'notes/graph.md',
    maxOperations: 8,
    ...overrides,
  };
}

function createIntelligentRequest(overrides = {}) {
  return {
    rootPath: 'D:/vault',
    kind: 'intelligent',
    preferredModel: 'openai/gpt-4o',
    strength: 'go-ham',
    intent: 'Restructure the graph note cluster.',
    cardUid: 'CW-001',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
    activeNotePath: 'notes/graph.md',
    maxOperations: 10,
    ...overrides,
  };
}

test('guided insert stub emits insertion only when no extra permissions are enabled', async () => {
  const provider = new StubWeaveProvider();
  const result = await provider.generatePlan(createGuidedRequest());

  assert.equal(result.plan.kind, 'guided-insert');
  assert.deepEqual(result.plan.operations.map((operation) => operation.kind), ['insert-boundary-pair']);
});

test('guided insert stub adds note edits and create-note when permissions allow them', async () => {
  const provider = new StubWeaveProvider();
  const result = await provider.generatePlan(
    createGuidedRequest({
      permissions: {
        editContent: true,
        createNote: true,
      },
    }),
  );
  const kinds = result.plan.operations.map((operation) => operation.kind);
  const createNoteOperation = result.plan.operations.find((operation) => operation.kind === 'create-note');

  assert.deepEqual(kinds, ['insert-boundary-pair', 'edit-note-content', 'create-note']);
  assert.ok(createNoteOperation);
  assert.match(createNoteOperation.payload.content, /Why this note exists/);
});

test('go-ham intelligent stub includes delete proposals and never emits crashpad operations', async () => {
  const provider = new StubWeaveProvider();
  const result = await provider.generatePlan(createIntelligentRequest());
  const kinds = result.plan.operations.map((operation) => operation.kind);

  assert.equal(result.plan.kind, 'intelligent');
  assert.ok(kinds.includes('delete-note'));
  assert.ok(kinds.includes('delete-directory'));
  assert.ok(kinds.includes('move-directory'));
  assert.ok(!kinds.some((kind) => kind.includes('crashpad')));
});
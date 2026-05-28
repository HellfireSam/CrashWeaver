const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  validateWeavePlanRequest,
  validateWeavePlanResult,
} = require('../../dist-electron/weaver/weavePlanSchema.js');

function buildBoundaryBlock(cardUid) {
  return [
    `%%CW_CARD_START uid:${cardUid}%%`,
    `Supporting prose for ${cardUid}.`,
    `%%CW_CARD_END uid:${cardUid}%%`,
  ].join('\n');
}

function createGuidedRequest(rootPath, overrides = {}) {
  return {
    rootPath,
    kind: 'guided-insert',
    intent: 'Place the focused card near graph notes.',
    cardUid: 'CW-001',
    permissions: {
      editContent: false,
      createNote: false,
    },
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
    activeNotePath: 'notes/graph.md',
    ...overrides,
  };
}

function createIntelligentRequest(rootPath, overrides = {}) {
  return {
    rootPath,
    kind: 'intelligent',
    strength: 'go-ham',
    intent: 'Restructure the graph theory notes around the focused card.',
    cardUid: 'CW-001',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
    activeNotePath: 'notes/graph.md',
    ...overrides,
  };
}

test('validateWeavePlanRequest accepts guided insert without strength and normalizes note paths', async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-schema-'));
  const request = validateWeavePlanRequest(
    createGuidedRequest(rootPath, {
      activeNotePath: 'notes/../notes/graph.md',
    }),
  );

  assert.equal(request.kind, 'guided-insert');
  assert.deepEqual(request.permissions, { editContent: false, createNote: false });
  assert.equal(request.activeNotePath, 'notes/graph.md');
});

test('guided insert rejects edit-note-content when editContent permission is disabled', async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-schema-'));
  const request = validateWeavePlanRequest(createGuidedRequest(rootPath));

  assert.throws(
    () => validateWeavePlanResult(
      {
        plan: {
          kind: 'guided-insert',
          permissions: { editContent: false, createNote: false },
          summary: 'Attempt to edit surrounding note content.',
          operations: [
            {
              kind: 'edit-note-content',
              targetPath: 'notes/graph.md',
              payload: {
                action: 'insert-after-heading',
                targetText: '# Graph Theory',
                replacementMarkdown: '# Graph Theory\n\nUpdated prose.',
              },
              rationale: 'This should be rejected because editContent is off.',
            },
          ],
          warnings: [],
          referencedCards: ['CW-001'],
        },
        model: 'stub',
        provider: 'stub',
        latencyMs: 1,
      },
      request,
    ),
    /cannot include edit-note-content/i,
  );
});

test('create-note payloads must include substantive prose and the focused boundary pair', async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-schema-'));
  const request = validateWeavePlanRequest(
    createGuidedRequest(rootPath, {
      permissions: {
        editContent: false,
        createNote: true,
      },
    }),
  );

  assert.throws(
    () => validateWeavePlanResult(
      {
        plan: {
          kind: 'guided-insert',
          permissions: { editContent: false, createNote: true },
          summary: 'Attempt to create a note without meaningful prose.',
          operations: [
            {
              kind: 'create-note',
              targetPath: 'notes/new-graph-note.md',
              payload: {
                cardUid: 'CW-001',
                title: 'New graph note',
                content: [
                  '%%CW_CARD_START uid:CW-001%%',
                  '%%CW_CARD_END uid:CW-001%%',
                ].join('\n'),
              },
              rationale: 'This should fail because the note has no meaningful prose.',
            },
          ],
          warnings: [],
          referencedCards: ['CW-001'],
        },
        model: 'stub',
        provider: 'stub',
        latencyMs: 1,
      },
      request,
    ),
    /substantive markdown prose/i,
  );
});

test('intelligent plans accept note and directory rename or delete operations outside crashpad targets', async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-schema-'));
  const request = validateWeavePlanRequest(createIntelligentRequest(rootPath));
  const result = validateWeavePlanResult(
    {
      plan: {
        kind: 'intelligent',
        strength: 'go-ham',
        summary: 'Restructure the graph note cluster around the focused card.',
        operations: [
          {
            kind: 'rename-note',
            targetPath: 'notes/graphs/graph-reference.md',
            payload: {
              fromPath: 'notes/graph.md',
              toPath: 'notes/graphs/graph-reference.md',
              renameReason: 'Clarify that this note is now the main reference entry.',
            },
            rationale: 'Rename the note so the vault title matches the new role.',
          },
          {
            kind: 'create-directory',
            targetPath: 'notes/graphs',
            payload: {
              purpose: 'Group the graph note cluster in one place.',
            },
            rationale: 'Create a dedicated directory for the new graph knowledge cluster.',
          },
          {
            kind: 'delete-directory',
            targetPath: 'notes/old-graphs',
            payload: {
              deleteReason: 'The old graph staging directory is obsolete after the restructure.',
            },
            rationale: 'Delete the obsolete staging directory once the new structure replaces it.',
          },
          {
            kind: 'create-note',
            targetPath: 'notes/graphs/graph-overview.md',
            payload: {
              cardUid: 'CW-001',
              title: 'Graph overview',
              content: [
                '# Graph overview',
                '',
                'This note introduces the graph cluster and explains why CW-001 belongs here.',
                '',
                buildBoundaryBlock('CW-001'),
              ].join('\n'),
            },
            rationale: 'Create an overview note that gives the card a durable home in the new cluster.',
          },
        ],
        warnings: [],
        referencedCards: ['CW-001'],
      },
      model: 'stub',
      provider: 'stub',
      latencyMs: 1,
    },
    request,
  );

  assert.equal(result.plan.kind, 'intelligent');
  assert.deepEqual(result.plan.operations.map((operation) => operation.kind), [
    'rename-note',
    'create-directory',
    'delete-directory',
    'create-note',
  ]);
});
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  validateWeavePlanRequest,
  validateWeavePlanResult,
} = require('../../dist-electron/weaver/weavePlanSchema.js');

describe('weavePlanSchema', () => {
  function buildBoundaryBlock(cardUid: string) {
    return [
      `%%CW_CARD_START uid:${cardUid}%%`,
      `Supporting prose for ${cardUid}.`,
      `%%CW_CARD_END uid:${cardUid}%%`,
    ].join('\n');
  }

  function createGuidedRequest(rootPath: string, overrides = {}) {
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

  function createIntelligentRequest(rootPath: string, overrides = {}) {
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

  it('validateWeavePlanRequest accepts guided insert without strength and normalizes note paths', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-schema-'));
    const request = validateWeavePlanRequest(
      createGuidedRequest(rootPath, {
        activeNotePath: 'notes/../notes/graph.md',
      }),
    );

    expect(request.kind).toBe('guided-insert');
    expect(request.permissions).toEqual({ editContent: false, createNote: false });
    expect(request.activeNotePath).toBe('notes/graph.md');
  });

  it('guided insert rejects edit-note-content when editContent permission is disabled', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-schema-'));
    const request = validateWeavePlanRequest(createGuidedRequest(rootPath));

    expect(() =>
      validateWeavePlanResult(
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
    ).toThrow(/cannot include edit-note-content/i);
  });

  // The create-note characterisation. Boundary markers are optional in a
  // create-note payload's content (see ADR-0002); only the trimmed prose floor
  // is enforced. These tests exist to fail if that acceptance behaviour changes.
  function guidedCreateNoteResult(content: string) {
    return {
      plan: {
        kind: 'guided-insert',
        permissions: { editContent: false, createNote: true },
        summary: 'Create a note for the focused card.',
        operations: [
          {
            kind: 'create-note',
            targetPath: 'notes/new-graph-note.md',
            payload: {
              cardUid: 'CW-001',
              title: 'New graph note',
              content,
            },
            rationale: 'The focused card needs a note of its own.',
          },
        ],
        warnings: [],
        referencedCards: ['CW-001'],
      },
      model: 'stub',
      provider: 'stub',
      latencyMs: 1,
    };
  }

  async function guidedCreateRequest() {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-schema-'));
    return validateWeavePlanRequest(
      createGuidedRequest(rootPath, {
        permissions: {
          editContent: false,
          createNote: true,
        },
      }),
    );
  }

  it('accepts create-note content that omits UID boundary markers', async () => {
    const request = await guidedCreateRequest();

    expect(() =>
      validateWeavePlanResult(
        guidedCreateNoteResult('# New graph note\n\nGraph traversal notes for the focused card.'),
        request,
      ),
    ).not.toThrow();
  });

  it('accepts boundary-only create-note content that clears the prose floor', async () => {
    const request = await guidedCreateRequest();

    expect(() =>
      validateWeavePlanResult(
        guidedCreateNoteResult(
          ['%%CW_CARD_START uid:CW-001%%', '%%CW_CARD_END uid:CW-001%%'].join('\n'),
        ),
        request,
      ),
    ).not.toThrow();
  });

  it('rejects create-note content shorter than the prose floor', async () => {
    const request = await guidedCreateRequest();

    expect(() => validateWeavePlanResult(guidedCreateNoteResult('Too short.'), request)).toThrow(
      /substantive markdown prose/i,
    );
  });

  it('intelligent plans accept note and directory rename or delete operations outside crashpad targets', async () => {
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
              rationale:
                'Delete the obsolete staging directory once the new structure replaces it.',
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
              rationale:
                'Create an overview note that gives the card a durable home in the new cluster.',
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

    expect(result.plan.kind).toBe('intelligent');
    expect(result.plan.operations.map((operation: { kind: string }) => operation.kind)).toEqual([
      'rename-note',
      'create-directory',
      'delete-directory',
      'create-note',
    ]);
  });

  it('rejects a traversal card UID when the plan is normalised', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-schema-'));
    const request = validateWeavePlanRequest(
      createGuidedRequest(rootPath, {
        permissions: { editContent: false, createNote: true },
      }),
    );

    expect(() =>
      validateWeavePlanResult(
        {
          plan: {
            kind: 'guided-insert',
            permissions: { editContent: false, createNote: true },
            summary: 'Create a note for a card whose UID escapes the card store.',
            operations: [
              {
                kind: 'create-note',
                targetPath: 'notes/evil.md',
                payload: {
                  cardUid: '../evil',
                  title: 'Evil',
                  content: 'Substantive prose that would otherwise be accepted by create-note.',
                },
                rationale: 'The traversal must be rejected during normalisation.',
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
    ).toThrow(/Card title \/ ID must use only letters, numbers/);
  });
});

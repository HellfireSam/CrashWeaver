import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const { StubWeaveProvider } = require('../../dist-electron/weaver/stubWeaveProvider.js');

describe('stubWeaveProvider', () => {
  type PlanOperation = { kind: string };

  function createGuidedRequest(overrides: Record<string, unknown> = {}) {
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

  function createIntelligentRequest(overrides: Record<string, unknown> = {}) {
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

  it('guided insert stub emits insertion only when no extra permissions are enabled', async () => {
    const provider = new StubWeaveProvider();
    const result = await provider.generatePlan(createGuidedRequest());

    expect(result.plan.kind).toBe('guided-insert');
    expect(result.plan.operations.map((operation: PlanOperation) => operation.kind)).toEqual([
      'insert-boundary-pair',
    ]);
  });

  it('guided insert stub adds note edits and create-note when permissions allow them', async () => {
    const provider = new StubWeaveProvider();
    const result = await provider.generatePlan(
      createGuidedRequest({
        permissions: {
          editContent: true,
          createNote: true,
        },
      }),
    );
    const kinds = result.plan.operations.map((operation: PlanOperation) => operation.kind);
    const createNoteOperation = result.plan.operations.find(
      (operation: PlanOperation) => operation.kind === 'create-note',
    );

    expect(kinds).toEqual(['insert-boundary-pair', 'edit-note-content', 'create-note']);
    expect(createNoteOperation).toBeTruthy();
    expect(createNoteOperation.payload.content).toMatch(/Why this note exists/);
  });

  it('go-ham intelligent stub includes delete proposals and never emits crashpad operations', async () => {
    const provider = new StubWeaveProvider();
    const result = await provider.generatePlan(createIntelligentRequest());
    const kinds = result.plan.operations.map((operation: PlanOperation) => operation.kind);

    expect(result.plan.kind).toBe('intelligent');
    expect(kinds.includes('delete-note')).toBeTruthy();
    expect(kinds.includes('delete-directory')).toBeTruthy();
    expect(kinds.includes('move-directory')).toBeTruthy();
    expect(!kinds.some((kind: string) => kind.includes('crashpad'))).toBeTruthy();
  });
});

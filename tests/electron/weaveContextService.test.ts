import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const settingsService = require('../../dist-electron/settingsService.js');
const vaultService = require('../../dist-electron/vaultService.js');
const { writeVaultIndex } = require('../../dist-electron/services/vaultIndexService.js');
const {
  buildWeaveContextSnapshot,
  createWeaveContextToolRuntime,
} = require('../../dist-electron/weaver/weaveContextService.js');

describe('weaveContextService', () => {
  type CandidateNote = { filePath: string };

  function createGuidedRequest(rootPath: string, overrides: Record<string, unknown> = {}) {
    return {
      rootPath,
      kind: 'guided-insert',
      preferredModel: 'openai/gpt-4o',
      intent: 'Place the reliability playbook near the current testing note.',
      cardUid: 'CW-RETRIEVE-1',
      permissions: {
        editContent: true,
        createNote: false,
      },
      activeNotePath: 'projects/testing.md',
      activeCrashpadId: 'cp-1',
      activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
      maxOperations: 8,
      ...overrides,
    };
  }

  async function writeNote(rootPath: string, filePath: string, content: string) {
    const absolutePath = path.join(rootPath, ...filePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
    return vaultService.readNote(rootPath, filePath);
  }

  async function createIndexedVault(rootPath: string) {
    const notes = await Promise.all([
      writeNote(
        rootPath,
        'knowledge/reliability-playbook.md',
        [
          '# Reliability Playbook',
          '',
          'Stage 5 planning needs deterministic note retrieval.',
          'Keep read-only retrieval bounded and explicit.',
          'Use focused card references to pick the right note.',
        ].join('\n'),
      ),
      writeNote(
        rootPath,
        'projects/testing.md',
        [
          '# Testing',
          '',
          'The current active note talks about deterministic integration coverage.',
          'Reliability work should stay close to the testing cluster.',
        ].join('\n'),
      ),
      writeNote(
        rootPath,
        'knowledge/reliability-review.md',
        [
          '# Reliability Review',
          '',
          '#reliability #testing',
          'A second note with overlapping terminology.',
        ].join('\n'),
      ),
      writeNote(
        rootPath,
        'archive/misc.md',
        ['# Misc', '', 'Unrelated archive material.'].join('\n'),
      ),
    ]);
    const indexPath = path.join(rootPath, '.crashweaver', 'index.json');
    const legacyPath = path.join(rootPath, 'index.json');

    await writeVaultIndex(indexPath, legacyPath, notes);
  }

  it('buildWeaveContextSnapshot prioritizes references, active note, and keyword overlap', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-context-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const createdCard = await vaultService.createCard(rootPath, 'CW-RETRIEVE-1');

      await vaultService.saveCard(rootPath, {
        ...createdCard,
        type: ['reliability', 'testing'],
        raw_content: 'Reliability playbook for deterministic test coverage and note retrieval.',
        referenced_in: [
          { note_path: 'knowledge/reliability-playbook.md', start_line: 2, end_line: 4 },
        ],
      });
      await createIndexedVault(rootPath);

      const snapshot = await buildWeaveContextSnapshot(createGuidedRequest(rootPath));
      const candidatePaths = snapshot.candidateNotes.map((note: CandidateNote) => note.filePath);

      expect(candidatePaths[0]).toBe('knowledge/reliability-playbook.md');
      expect(candidatePaths.includes('projects/testing.md')).toBeTruthy();
      expect(candidatePaths.includes('knowledge/reliability-review.md')).toBeTruthy();

      const referencedNote = snapshot.candidateNotes.find(
        (note: CandidateNote) => note.filePath === 'knowledge/reliability-playbook.md',
      );
      const activeNote = snapshot.candidateNotes.find(
        (note: CandidateNote) => note.filePath === 'projects/testing.md',
      );

      expect(referencedNote).toBeTruthy();
      expect(activeNote).toBeTruthy();
      expect(referencedNote.score > activeNote.score).toBeTruthy();
      expect(referencedNote.reasons.join(' ')).toMatch(/already references this note/i);
      expect(activeNote.reasons.join(' ')).toMatch(/active note context/i);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('WeaveContextToolRuntime enforces bounded note reads and truncates excerpts', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-runtime-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const createdCard = await vaultService.createCard(rootPath, 'CW-RETRIEVE-1');

      await vaultService.saveCard(rootPath, {
        ...createdCard,
        type: ['reliability'],
        raw_content: 'Reliability playbook for deterministic test coverage and note retrieval.',
        referenced_in: [
          { note_path: 'knowledge/reliability-playbook.md', start_line: 2, end_line: 4 },
        ],
      });
      await createIndexedVault(rootPath);

      const snapshot = await buildWeaveContextSnapshot(createGuidedRequest(rootPath));
      const runtime = createWeaveContextToolRuntime(snapshot, {
        maxNoteReads: 1,
        maxExcerptChars: 90,
        maxFullNoteChars: 140,
        maxRetrievedChars: 110,
      });

      const excerptResult = await runtime.execute('read_note_excerpt', {
        filePath: 'knowledge/reliability-playbook.md',
        maxChars: 400,
      });

      expect(excerptResult.ok).toBe(true);
      expect(excerptResult.toolName).toBe('read_note_excerpt');
      expect(excerptResult.data.content).toMatch(/deterministic note retrieval/i);
      expect(excerptResult.data.content.length <= 90).toBeTruthy();

      const fullReadAfterBudget = await runtime.execute('read_note_full', {
        filePath: 'projects/testing.md',
        maxChars: 400,
      });

      expect(fullReadAfterBudget.ok).toBe(false);
      expect(fullReadAfterBudget.error).toMatch(/note-read budget is exhausted/i);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  // ── Tool registry dispatch ───────────────────────────────────────────────────

  it('WeaveContextToolRuntime returns error for unsupported tool names', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-unknown-tool-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const createdCard = await vaultService.createCard(rootPath, 'CW-RETRIEVE-1');

      await vaultService.saveCard(rootPath, {
        ...createdCard,
        type: ['test'],
        raw_content: 'Test content.',
        referenced_in: [],
      });
      await createIndexedVault(rootPath);

      const snapshot = await buildWeaveContextSnapshot(createGuidedRequest(rootPath));
      const runtime = createWeaveContextToolRuntime(snapshot);

      const result = await runtime.execute('non_existent_tool', { some: 'args' });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Unsupported read-only tool/i);
      expect(result.diagnostics).toBeTruthy();
      expect(result.diagnostics.code).toBe('unsupported-tool');
      expect(result.diagnostics.recoverable).toBe(true);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('WeaveContextToolRuntime search_notes requires a non-empty query', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-search-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const createdCard = await vaultService.createCard(rootPath, 'CW-RETRIEVE-1');

      await vaultService.saveCard(rootPath, {
        ...createdCard,
        type: ['test'],
        raw_content: 'Test content.',
        referenced_in: [],
      });
      await createIndexedVault(rootPath);

      const snapshot = await buildWeaveContextSnapshot(createGuidedRequest(rootPath));
      const runtime = createWeaveContextToolRuntime(snapshot);

      // Empty query
      const result1 = await runtime.execute('search_notes', { query: '' });
      expect(result1.ok).toBe(false);
      expect(result1.error).toMatch(/requires a non-empty query/i);

      // Missing query
      const result2 = await runtime.execute('search_notes', {});
      expect(result2.ok).toBe(false);
      expect(result2.error).toMatch(/requires a non-empty query/i);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });
});

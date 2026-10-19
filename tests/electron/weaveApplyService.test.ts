import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  CardDocument,
  CardNoteReference,
  WeaveApplyOptions,
  WeaveApplyResult,
  WeavePlanOperation,
} from '../../electron/vault-contract';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first. The contract
// import above is type-only: the shared contract compiles to an empty module,
// so nothing under `electron/` is loaded at runtime and the suite still loads
// `dist-electron/` through `createRequire`. Typing against the contract keeps
// the test payloads and result assertions checked against the same shapes the
// main process uses.
const require = createRequire(import.meta.url);
const { applyWeaveOperations } = require('../../dist-electron/weaver/weaveApplyService.js');
const {
  formatCardStartBoundary,
  formatCardEndBoundary,
} = require('../../dist-electron/cardParser.js');

describe('weaveApplyService', () => {
  type TestVault = {
    rootPath: string;
    cardStorePath: string;
  };

  // Every vault is removed after the test, including when an assertion fails,
  // so a red run leaves no temporary directories behind.
  const vaultRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      vaultRoots.splice(0).map((rootPath) => fs.rm(rootPath, { recursive: true, force: true })),
    );
  });

  async function setupTestVault(
    files: Record<string, string> = {},
    directories: string[] = [],
  ): Promise<TestVault> {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-test-apply-'));
    vaultRoots.push(rootPath);
    const cardStorePath = path.join(rootPath, '.crashweaver', 'cards');
    await fs.mkdir(cardStorePath, { recursive: true });

    for (const directory of directories) {
      await fs.mkdir(path.join(rootPath, directory), { recursive: true });
    }

    for (const [relativePath, content] of Object.entries(files)) {
      await writeVaultFile({ rootPath, cardStorePath }, relativePath, content);
    }

    return { rootPath, cardStorePath };
  }

  function makeOperation<K extends WeavePlanOperation['kind']>(
    kind: K,
    targetPath: string,
    payload: Extract<WeavePlanOperation, { kind: K }>['payload'],
  ): WeavePlanOperation {
    // TypeScript cannot prove the correlated union from the three parameters,
    // so the helper asserts it once; callers still get payload-by-kind typing.
    return { kind, targetPath, payload, rationale: `${kind} under test` } as WeavePlanOperation;
  }

  function applyOperations(
    vault: TestVault,
    operations: WeavePlanOperation[],
    options: WeaveApplyOptions = {},
  ): Promise<WeaveApplyResult> {
    return applyWeaveOperations(vault.rootPath, vault.cardStorePath, operations, options);
  }

  function absolutePath(vault: TestVault, relativePath: string): string {
    return path.join(vault.rootPath, relativePath);
  }

  async function readVaultFile(vault: TestVault, relativePath: string): Promise<string> {
    return fs.readFile(absolutePath(vault, relativePath), 'utf8');
  }

  async function writeVaultFile(
    vault: TestVault,
    relativePath: string,
    content: string,
  ): Promise<void> {
    const target = absolutePath(vault, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }

  async function pathExists(target: string): Promise<boolean> {
    try {
      await fs.stat(target);
      return true;
    } catch {
      return false;
    }
  }

  async function readCard(vault: TestVault, uid: string): Promise<CardDocument> {
    const raw = await fs.readFile(path.join(vault.cardStorePath, `${uid}.json`), 'utf8');
    return JSON.parse(raw);
  }

  async function writeCard(vault: TestVault, card: CardDocument): Promise<void> {
    await writeVaultFile(
      vault,
      `.crashweaver/cards/${card.uid}.json`,
      JSON.stringify(card, null, 2),
    );
  }

  function makeCard(
    uid: string,
    referencedIn: CardNoteReference[],
    overrides: Partial<CardDocument> = {},
  ): CardDocument {
    return {
      uid,
      type: [],
      raw_content: `${uid} payload`,
      metadata: { familiarity: 0, next_review: null },
      memory_tricks: { memory_technique: '', qa_pairs: [] },
      referenced_in: referencedIn,
      ...overrides,
    };
  }

  function boundaryBlock(uid: string, content: string): string {
    return [formatCardStartBoundary(uid), content, formatCardEndBoundary(uid)].join('\n');
  }

  /**
   * Captures every file's content and every directory under the vault root, so
   * a test can prove a dry run wrote nothing — no note, no card JSON and no
   * directory.
   */
  async function snapshotVault(rootPath: string): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};

    async function walk(absoluteDirectory: string, relativeDirectory: string): Promise<void> {
      const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          snapshot[`${relativePath}/`] = '<directory>';
          await walk(path.join(absoluteDirectory, entry.name), relativePath);
        } else {
          snapshot[relativePath] = await fs.readFile(
            path.join(absoluteDirectory, entry.name),
            'utf8',
          );
        }
      }
    }

    await walk(rootPath, '');
    return snapshot;
  }

  // ── insert-boundary-pair ────────────────────────────────────────────────────

  describe('insert-boundary-pair', () => {
    it('appends the boundary block to the end of the note and syncs the card', async () => {
      const vault = await setupTestVault({
        'notes/target.md': '# Target Note\n\nSome content here.\n',
      });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-TEST',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-TEST', 'Test card content'),
        }),
      ]);

      expect(result).toEqual({
        results: [
          {
            operationIndex: 0,
            kind: 'insert-boundary-pair',
            targetPath: 'notes/target.md',
            ok: true,
            affectedPaths: ['notes/target.md'],
          },
        ],
        allOk: true,
        appliedCount: 1,
        failedCount: 0,
        warnings: [],
      });
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        [
          '# Target Note',
          '',
          'Some content here.',
          '',
          formatCardStartBoundary('CW-TEST'),
          'Test card content',
          formatCardEndBoundary('CW-TEST'),
        ].join('\n'),
      );

      const card = await readCard(vault, 'CW-TEST');
      expect(card.raw_content).toBe('Test card content');
      expect(card.referenced_in).toEqual([
        { note_path: 'notes/target.md', start_line: 5, end_line: 7 },
      ]);
    });

    it('prepends the boundary block to the start of the note', async () => {
      const vault = await setupTestVault({ 'notes/target.md': '# Target Note\n\nSome content.\n' });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-PREPEND',
          placement: 'prepend-to-note',
          boundaryBlock: boundaryBlock('CW-PREPEND', 'Prepended card'),
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        [
          formatCardStartBoundary('CW-PREPEND'),
          'Prepended card',
          formatCardEndBoundary('CW-PREPEND'),
          '# Target Note',
          '',
          'Some content.',
          '',
        ].join('\n'),
      );
    });

    it('inserts after a heading and the blank line that follows it', async () => {
      const vault = await setupTestVault({
        'notes/target.md':
          '# Intro\n\nIntro text.\n\n## Section A\n\nSection content.\n\n## Section B\n\nMore content.\n',
      });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-HEADING',
          placement: 'after-heading',
          headingText: 'Section A',
          boundaryBlock: boundaryBlock('CW-HEADING', 'After heading content'),
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        [
          '# Intro',
          '',
          'Intro text.',
          '',
          '## Section A',
          '',
          formatCardStartBoundary('CW-HEADING'),
          'After heading content',
          formatCardEndBoundary('CW-HEADING'),
          'Section content.',
          '',
          '## Section B',
          '',
          'More content.',
          '',
        ].join('\n'),
      );
    });

    it('inserts immediately after a heading when no blank line follows it', async () => {
      const vault = await setupTestVault({ 'notes/target.md': '# Heading\nBody line.\n' });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-DIRECT',
          placement: 'after-heading',
          headingText: 'Heading',
          boundaryBlock: boundaryBlock('CW-DIRECT', 'Card content'),
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        [
          '# Heading',
          formatCardStartBoundary('CW-DIRECT'),
          'Card content',
          formatCardEndBoundary('CW-DIRECT'),
          'Body line.',
          '',
        ].join('\n'),
      );
    });

    it('inserts before a heading', async () => {
      const vault = await setupTestVault({
        'notes/target.md': '# Intro\n\nIntro text.\n\n## Section B\n\nSection content.\n',
      });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-BEFORE',
          placement: 'before-heading',
          headingText: 'Section B',
          boundaryBlock: boundaryBlock('CW-BEFORE', 'Before heading content'),
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        [
          '# Intro',
          '',
          'Intro text.',
          '',
          formatCardStartBoundary('CW-BEFORE'),
          'Before heading content',
          formatCardEndBoundary('CW-BEFORE'),
          '## Section B',
          '',
          'Section content.',
          '',
        ].join('\n'),
      );
    });

    it('inserts after the selected text', async () => {
      const vault = await setupTestVault({
        'notes/target.md':
          '# Note\n\nThis is paragraph one.\n\nThis is paragraph two.\n\nThis is paragraph three.\n',
      });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-SELECTION',
          placement: 'after-selection',
          selectedText: 'This is paragraph one.',
          boundaryBlock: boundaryBlock('CW-SELECTION', 'After selection content'),
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        [
          '# Note',
          '',
          'This is paragraph one.',
          formatCardStartBoundary('CW-SELECTION'),
          'After selection content',
          formatCardEndBoundary('CW-SELECTION'),
          '',
          'This is paragraph two.',
          '',
          'This is paragraph three.',
          '',
        ].join('\n'),
      );
    });

    it('appends to the end when after-selection carries no selected text', async () => {
      const vault = await setupTestVault({ 'notes/target.md': '# Note\n\nContent.\n' });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-NO-SELECTION',
          placement: 'after-selection',
          selectedText: '',
          boundaryBlock: boundaryBlock('CW-NO-SELECTION', 'Card content'),
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        [
          '# Note',
          '',
          'Content.',
          '',
          formatCardStartBoundary('CW-NO-SELECTION'),
          'Card content',
          formatCardEndBoundary('CW-NO-SELECTION'),
        ].join('\n'),
      );
    });

    it('synthesises bare start and end boundaries when the boundary block is empty', async () => {
      const vault = await setupTestVault({ 'notes/target.md': '# Note\n\nContent.\n' });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-BARE',
          placement: 'append-to-note',
          boundaryBlock: '',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        [
          '# Note',
          '',
          'Content.',
          '',
          formatCardStartBoundary('CW-BARE'),
          formatCardEndBoundary('CW-BARE'),
        ].join('\n'),
      );
    });

    it('warns and leaves the note unchanged when the after-heading target is missing', async () => {
      const original = '# Note\n\nContent.\n';
      const vault = await setupTestVault({ 'notes/target.md': original });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-NO-HEADING',
          placement: 'after-heading',
          headingText: 'Missing heading',
          boundaryBlock: boundaryBlock('CW-NO-HEADING', 'Card content'),
        }),
      ]);

      const expectedWarning =
        '[insert-boundary-pair] notes/target.md: Heading "Missing heading" not found; appended to end of note.';
      expect(result.allOk).toBe(true);
      expect(result.results[0].ok).toBe(true);
      expect(result.results[0].warning).toBe(expectedWarning);
      expect(result.warnings).toEqual([expectedWarning]);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(original);
    });

    it('warns and leaves the note unchanged when the before-heading target is missing', async () => {
      const original = '# Note\n\nContent.\n';
      const vault = await setupTestVault({ 'notes/target.md': original });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-NO-BEFORE',
          placement: 'before-heading',
          headingText: 'Missing heading',
          boundaryBlock: boundaryBlock('CW-NO-BEFORE', 'Card content'),
        }),
      ]);

      const expectedWarning =
        '[insert-boundary-pair] notes/target.md: Heading "Missing heading" not found; prepended to note.';
      expect(result.allOk).toBe(true);
      expect(result.results[0].warning).toBe(expectedWarning);
      expect(result.warnings).toEqual([expectedWarning]);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(original);
    });

    it('warns and leaves the note unchanged when the selected text is missing', async () => {
      const original = '# Note\n\nContent.\n';
      const vault = await setupTestVault({ 'notes/target.md': original });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-NO-TEXT',
          placement: 'after-selection',
          selectedText: 'Text that is not here.',
          boundaryBlock: boundaryBlock('CW-NO-TEXT', 'Card content'),
        }),
      ]);

      const expectedWarning =
        '[insert-boundary-pair] notes/target.md: Selected text not found in note; appended to end.';
      expect(result.allOk).toBe(true);
      expect(result.results[0].warning).toBe(expectedWarning);
      expect(result.warnings).toEqual([expectedWarning]);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(original);
    });

    it('fails when the target note does not exist', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/missing.md', {
          cardUid: 'CW-MISSING-NOTE',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-MISSING-NOTE', 'Card content'),
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toContain('Note not found');
      expect(await pathExists(absolutePath(vault, 'notes/missing.md'))).toBe(false);
    });

    it('fails and leaves the note unchanged when the insertion would break a boundary pair', async () => {
      const original = '# Note\n\nContent.\n';
      const vault = await setupTestVault({ 'notes/target.md': original });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-BROKEN',
          placement: 'append-to-note',
          boundaryBlock: `${formatCardStartBoundary('CW-BROKEN')}\nbody without an end boundary`,
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error).toContain('Boundary integrity check failed');
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(original);
    });
  });

  // ── edit-note-content ───────────────────────────────────────────────────────

  describe('edit-note-content', () => {
    it('replaces every occurrence of the target text', async () => {
      const vault = await setupTestVault({
        'notes/target.md': '# Note\n\napple pie and apple juice.\n',
      });

      const result = await applyOperations(vault, [
        makeOperation('edit-note-content', 'notes/target.md', {
          action: 'replace-selection',
          targetText: 'apple',
          replacementMarkdown: 'pear',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(
        '# Note\n\npear pie and pear juice.\n',
      );
    });

    it('replaces a multi-line target by normalising CRLF line endings', async () => {
      const vault = await setupTestVault({
        'notes/target.md': '# Note\r\n\r\nfirst line\r\nsecond line\r\n',
      });

      const result = await applyOperations(vault, [
        makeOperation('edit-note-content', 'notes/target.md', {
          action: 'replace-selection',
          targetText: 'first line\nsecond line',
          replacementMarkdown: 'replacement',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/target.md')).toBe('# Note\n\nreplacement\n');
    });

    it('fails and leaves the note unchanged when the target text is absent', async () => {
      const original = '# Note\n\nSome content.\n';
      const vault = await setupTestVault({ 'notes/target.md': original });

      const result = await applyOperations(vault, [
        makeOperation('edit-note-content', 'notes/target.md', {
          action: 'replace-selection',
          targetText: 'This text does not exist in the note.',
          replacementMarkdown: 'Replacement.',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe(
        'Target text not found in note "notes/target.md". The note may have been modified since the plan was generated.',
      );
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(original);
    });

    it('fails and leaves the note unchanged when the edit would break a boundary pair', async () => {
      const uid = 'CW-PROTECTED';
      const original = [
        '# Note',
        '',
        'Some text.',
        '',
        formatCardStartBoundary(uid),
        'card body',
        formatCardEndBoundary(uid),
        '',
        'More text.',
        '',
      ].join('\n');
      const vault = await setupTestVault({ 'notes/target.md': original });

      const result = await applyOperations(vault, [
        makeOperation('edit-note-content', 'notes/target.md', {
          action: 'replace-selection',
          targetText: formatCardEndBoundary(uid),
          replacementMarkdown: 'Broken boundary',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toContain('Boundary integrity check failed');
      expect(await readVaultFile(vault, 'notes/target.md')).toBe(original);
    });

    it('fails when the target note does not exist', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('edit-note-content', 'notes/missing.md', {
          action: 'replace-selection',
          targetText: 'anything',
          replacementMarkdown: 'replacement',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toContain('Note not found');
    });
  });

  // ── create-note ─────────────────────────────────────────────────────────────

  describe('create-note', () => {
    it('creates the note, its parent directories and a default card document', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('create-note', 'notes/deep/new-note.md', {
          cardUid: 'CW-NEW',
          title: 'New Test Note',
          content: 'This is the content of the new note.',
        }),
      ]);

      expect(result).toEqual({
        results: [
          {
            operationIndex: 0,
            kind: 'create-note',
            targetPath: 'notes/deep/new-note.md',
            ok: true,
            affectedPaths: ['notes/deep/new-note.md', '.crashweaver/cards/CW-NEW.json'],
          },
        ],
        allOk: true,
        appliedCount: 1,
        failedCount: 0,
        warnings: [],
      });
      expect(await readVaultFile(vault, 'notes/deep/new-note.md')).toBe(
        '# New Test Note\n\nThis is the content of the new note.',
      );
      expect(await readCard(vault, 'CW-NEW')).toEqual({
        uid: 'CW-NEW',
        type: [],
        raw_content: '',
        metadata: { familiarity: 0, next_review: null },
        memory_tricks: { memory_technique: '', qa_pairs: [] },
        referenced_in: [{ note_path: 'notes/deep/new-note.md', start_line: 1, end_line: 3 }],
      });
    });

    it('passes boundary markers in the content through unmodified', async () => {
      const vault = await setupTestVault({});
      const content = boundaryBlock('CW-MARKED', 'Card body from the content');

      const result = await applyOperations(vault, [
        makeOperation('create-note', 'notes/marked.md', {
          cardUid: 'CW-MARKED',
          title: 'Marked',
          content,
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.results[0].affectedPaths).toEqual(['notes/marked.md']);
      expect(await readVaultFile(vault, 'notes/marked.md')).toBe(
        ['# Marked', '', content].join('\n'),
      );
      const card = await readCard(vault, 'CW-MARKED');
      expect(card.raw_content).toBe('Card body from the content');
      expect(card.referenced_in).toEqual([
        { note_path: 'notes/marked.md', start_line: 3, end_line: 5 },
      ]);
    });

    it('fails and leaves the existing note unchanged when the target path exists', async () => {
      const original = '# Existing\n';
      const vault = await setupTestVault({ 'notes/existing.md': original });

      const result = await applyOperations(vault, [
        makeOperation('create-note', 'notes/existing.md', {
          cardUid: 'CW-DUPLICATE',
          title: 'Duplicate',
          content: 'Should not work.',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('Note already exists: notes/existing.md');
      expect(await readVaultFile(vault, 'notes/existing.md')).toBe(original);
      expect(await pathExists(path.join(vault.cardStorePath, 'CW-DUPLICATE.json'))).toBe(false);
    });

    it('leaves an existing card document untouched when the note is created', async () => {
      const vault = await setupTestVault({});
      const existingCard = makeCard(
        'CW-KEEP',
        [{ note_path: 'other/note.md', start_line: 1, end_line: 2 }],
        { raw_content: 'Existing payload' },
      );
      await writeCard(vault, existingCard);

      const result = await applyOperations(vault, [
        makeOperation('create-note', 'notes/created.md', {
          cardUid: 'CW-KEEP',
          title: 'Created',
          content: 'Prose only.',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.results[0].affectedPaths).toEqual(['notes/created.md']);
      expect(await readCard(vault, 'CW-KEEP')).toEqual(existingCard);
    });
  });

  // ── rename-note ─────────────────────────────────────────────────────────────

  describe('rename-note', () => {
    it('renames the note and moves its content', async () => {
      const vault = await setupTestVault({ 'notes/old-name.md': '# Old Name\n\nContent.\n' });

      const result = await applyOperations(vault, [
        makeOperation('rename-note', 'notes/new-name.md', {
          fromPath: 'notes/old-name.md',
          toPath: 'notes/new-name.md',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.results[0].affectedPaths).toEqual(['notes/old-name.md', 'notes/new-name.md']);
      expect(await pathExists(absolutePath(vault, 'notes/old-name.md'))).toBe(false);
      expect(await readVaultFile(vault, 'notes/new-name.md')).toBe('# Old Name\n\nContent.\n');
    });

    it('rewrites the references of the cards whose boundaries appear in the note', async () => {
      const sharedUid = 'CW-SAME';
      const unrelatedUid = 'CW-UNRELATED';
      const noteContent = [
        '# Old Name',
        '',
        formatCardStartBoundary(sharedUid),
        'body one',
        formatCardEndBoundary(sharedUid),
        '',
        formatCardStartBoundary(unrelatedUid),
        'body two',
        formatCardEndBoundary(unrelatedUid),
        '',
      ].join('\n');
      const vault = await setupTestVault({ 'notes/old-name.md': noteContent });

      await writeCard(
        vault,
        makeCard(sharedUid, [{ note_path: 'notes/old-name.md', start_line: 3, end_line: 5 }], {
          raw_content: 'body one',
          type: ['deck'],
        }),
      );
      const unrelatedCard = makeCard(unrelatedUid, [
        { note_path: 'notes/elsewhere.md', start_line: 1, end_line: 2 },
      ]);
      await writeCard(vault, unrelatedCard);

      const result = await applyOperations(vault, [
        makeOperation('rename-note', 'notes/new-name.md', {
          fromPath: 'notes/old-name.md',
          toPath: 'notes/new-name.md',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(true);
      const sharedCard = await readCard(vault, sharedUid);
      expect(sharedCard.referenced_in).toEqual([
        { note_path: 'notes/new-name.md', start_line: 3, end_line: 5 },
      ]);
      expect(sharedCard.raw_content).toBe('body one');
      expect(sharedCard.type).toEqual(['deck']);
      expect(await readCard(vault, unrelatedUid)).toEqual(unrelatedCard);
    });

    it('renames the note even when a boundary UID has no card document', async () => {
      const noteContent = [
        '# No Card',
        '',
        formatCardStartBoundary('CW-ABSENT'),
        'body',
        formatCardEndBoundary('CW-ABSENT'),
        '',
      ].join('\n');
      const vault = await setupTestVault({ 'notes/no-card.md': noteContent });

      const result = await applyOperations(vault, [
        makeOperation('rename-note', 'notes/moved.md', {
          fromPath: 'notes/no-card.md',
          toPath: 'notes/moved.md',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'notes/moved.md')).toBe(noteContent);
    });

    it('fails when the source note does not exist', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('rename-note', 'notes/new-name.md', {
          fromPath: 'notes/missing.md',
          toPath: 'notes/new-name.md',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error).toContain('Note not found');
    });

    it('fails when the destination path already exists', async () => {
      const destination = '# Taken\n';
      const vault = await setupTestVault({
        'notes/source.md': '# Source\n',
        'notes/taken.md': destination,
      });

      const result = await applyOperations(vault, [
        makeOperation('rename-note', 'notes/taken.md', {
          fromPath: 'notes/source.md',
          toPath: 'notes/taken.md',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error).toBe('Target path already exists: notes/taken.md');
      expect(await readVaultFile(vault, 'notes/source.md')).toBe('# Source\n');
      expect(await readVaultFile(vault, 'notes/taken.md')).toBe(destination);
    });

    it('creates the destination parent directories', async () => {
      const vault = await setupTestVault({ 'notes/source.md': '# Source\n' });

      const result = await applyOperations(vault, [
        makeOperation('rename-note', 'archive/deep/source.md', {
          fromPath: 'notes/source.md',
          toPath: 'archive/deep/source.md',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'archive/deep/source.md')).toBe('# Source\n');
    });
  });

  // ── move-note ───────────────────────────────────────────────────────────────

  describe('move-note', () => {
    it('moves the note to a different directory and reports both paths', async () => {
      const vault = await setupTestVault({ 'notes/subject.md': '# Subject\n\nContent.\n' });

      const result = await applyOperations(vault, [
        makeOperation('move-note', 'notes/archive/subject.md', {
          fromPath: 'notes/subject.md',
          toPath: 'notes/archive/subject.md',
          moveReason: 'Archiving',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.results[0].affectedPaths).toEqual([
        'notes/subject.md',
        'notes/archive/subject.md',
      ]);
      expect(await pathExists(absolutePath(vault, 'notes/subject.md'))).toBe(false);
      expect(await readVaultFile(vault, 'notes/archive/subject.md')).toBe(
        '# Subject\n\nContent.\n',
      );
    });
  });

  // ── delete-note ─────────────────────────────────────────────────────────────

  describe('delete-note', () => {
    it('deletes the note and prunes its reference from the cards', async () => {
      const uid = 'CW-KEEP';
      const noteContent = [
        '# Delete Me',
        '',
        formatCardStartBoundary(uid),
        'content',
        formatCardEndBoundary(uid),
        '',
      ].join('\n');
      const vault = await setupTestVault({ 'notes/to-delete.md': noteContent });
      await writeCard(
        vault,
        makeCard(uid, [
          { note_path: 'notes/to-delete.md', start_line: 3, end_line: 5 },
          { note_path: 'notes/other.md', start_line: 1, end_line: 2 },
        ]),
      );

      const result = await applyOperations(vault, [
        makeOperation('delete-note', 'notes/to-delete.md', {
          deleteReason: 'No longer needed',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.results[0].warning).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(await pathExists(absolutePath(vault, 'notes/to-delete.md'))).toBe(false);
      expect((await readCard(vault, uid)).referenced_in).toEqual([
        { note_path: 'notes/other.md', start_line: 1, end_line: 2 },
      ]);
    });

    it('warns about the cards it orphans and preserves their card documents', async () => {
      const uid = 'CW-ORPHAN';
      const noteContent = [
        '# Orphan Note',
        '',
        formatCardStartBoundary(uid),
        'content',
        formatCardEndBoundary(uid),
        '',
      ].join('\n');
      const vault = await setupTestVault({ 'notes/orphan-note.md': noteContent });
      await writeCard(
        vault,
        makeCard(uid, [{ note_path: 'notes/orphan-note.md', start_line: 3, end_line: 5 }]),
      );

      const result = await applyOperations(vault, [
        makeOperation('delete-note', 'notes/orphan-note.md', {
          deleteReason: 'No longer needed',
        }),
      ]);

      const expectedWarning =
        '[delete-note] notes/orphan-note.md: Card(s) CW-ORPHAN no longer referenced in any note. Card JSON file(s) preserved in card store — delete manually if no longer needed.';
      expect(result.allOk).toBe(true);
      expect(result.results[0].warning).toBe(expectedWarning);
      expect(result.warnings).toEqual([expectedWarning]);
      expect(await pathExists(absolutePath(vault, 'notes/orphan-note.md'))).toBe(false);

      const orphan = await readCard(vault, uid);
      expect(orphan.referenced_in).toEqual([]);
      expect(orphan.raw_content).toBe(`${uid} payload`);
    });

    it('fails when the note does not exist', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('delete-note', 'notes/missing.md', { deleteReason: 'No longer needed' }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error).toContain('Note not found');
    });

    it('deletes the note even when a boundary card document is missing', async () => {
      const noteContent = [
        '# No Card',
        '',
        formatCardStartBoundary('CW-VANISHED'),
        'content',
        formatCardEndBoundary('CW-VANISHED'),
        '',
      ].join('\n');
      const vault = await setupTestVault({ 'notes/no-card.md': noteContent });

      const result = await applyOperations(vault, [
        makeOperation('delete-note', 'notes/no-card.md', { deleteReason: 'No longer needed' }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(await pathExists(absolutePath(vault, 'notes/no-card.md'))).toBe(false);
    });
  });

  // ── create-directory ────────────────────────────────────────────────────────

  describe('create-directory', () => {
    it('creates the directory and its parent directories', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('create-directory', 'notes/topic/subtopic', {
          purpose: 'Organise the topic notes',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.results[0].affectedPaths).toEqual(['notes/topic/subtopic']);
      const stats = await fs.stat(absolutePath(vault, 'notes/topic/subtopic'));
      expect(stats.isDirectory()).toBe(true);
    });

    it('succeeds when the directory already exists', async () => {
      const vault = await setupTestVault({}, ['notes/topic']);

      const result = await applyOperations(vault, [
        makeOperation('create-directory', 'notes/topic', { purpose: 'Organise the topic notes' }),
      ]);

      expect(result.allOk).toBe(true);
      const stats = await fs.stat(absolutePath(vault, 'notes/topic'));
      expect(stats.isDirectory()).toBe(true);
    });
  });

  // ── rename-directory ────────────────────────────────────────────────────────

  describe('rename-directory', () => {
    it('renames the directory and keeps its contents', async () => {
      const vault = await setupTestVault({ 'notes/old-dir/placeholder.md': '# Placeholder\n' });

      const result = await applyOperations(vault, [
        makeOperation('rename-directory', 'notes/new-dir', {
          fromPath: 'notes/old-dir',
          toPath: 'notes/new-dir',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await pathExists(absolutePath(vault, 'notes/old-dir'))).toBe(false);
      expect(await readVaultFile(vault, 'notes/new-dir/placeholder.md')).toBe('# Placeholder\n');
    });

    it('creates the destination parent directories', async () => {
      const vault = await setupTestVault({ 'notes/topic/note.md': '# Note\n' });

      const result = await applyOperations(vault, [
        makeOperation('rename-directory', 'archive/deep/topic', {
          fromPath: 'notes/topic',
          toPath: 'archive/deep/topic',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readVaultFile(vault, 'archive/deep/topic/note.md')).toBe('# Note\n');
    });

    it('fails when the source directory does not exist', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('rename-directory', 'notes/renamed', {
          fromPath: 'notes/missing',
          toPath: 'notes/renamed',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error).toBe('Directory not found: notes/missing');
    });

    it('fails when the destination directory already exists', async () => {
      const vault = await setupTestVault({}, ['notes/topic', 'notes/taken']);

      const result = await applyOperations(vault, [
        makeOperation('rename-directory', 'notes/taken', {
          fromPath: 'notes/topic',
          toPath: 'notes/taken',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error).toBe('Target directory already exists: notes/taken');
      expect(await pathExists(absolutePath(vault, 'notes/topic'))).toBe(true);
    });

    it('does not rewrite card references when it renames a directory', async () => {
      const uid = 'CW-DIR-REF';
      const noteContent = [
        '# Note',
        '',
        formatCardStartBoundary(uid),
        'content',
        formatCardEndBoundary(uid),
        '',
      ].join('\n');
      const vault = await setupTestVault({ 'notes/topic/note.md': noteContent });
      const card = makeCard(uid, [
        { note_path: 'notes/topic/note.md', start_line: 3, end_line: 5 },
      ]);
      await writeCard(vault, card);

      const result = await applyOperations(vault, [
        makeOperation('rename-directory', 'notes/renamed', {
          fromPath: 'notes/topic',
          toPath: 'notes/renamed',
          renameReason: 'Better name',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(await readCard(vault, uid)).toEqual(card);
    });
  });

  // ── move-directory ──────────────────────────────────────────────────────────

  describe('move-directory', () => {
    it('moves the directory and its contents to a new parent', async () => {
      const vault = await setupTestVault({ 'notes/topic/card.md': '# Card\n\nContent.\n' });

      const result = await applyOperations(vault, [
        makeOperation('move-directory', 'archive/topic', {
          fromPath: 'notes/topic',
          toPath: 'archive/topic',
          moveReason: 'Archiving',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.results[0].affectedPaths).toEqual(['notes/topic', 'archive/topic']);
      expect(await pathExists(absolutePath(vault, 'notes/topic'))).toBe(false);
      expect(await readVaultFile(vault, 'archive/topic/card.md')).toBe('# Card\n\nContent.\n');
    });
  });

  // ── delete-directory ────────────────────────────────────────────────────────

  describe('delete-directory', () => {
    it('deletes a non-empty directory recursively and warns about its contents', async () => {
      const vault = await setupTestVault({
        'notes/to-delete-dir/file1.md': '# File 1\n',
        'notes/to-delete-dir/file2.md': '# File 2\n',
      });

      const result = await applyOperations(vault, [
        makeOperation('delete-directory', 'notes/to-delete-dir', {
          deleteReason: 'No longer needed',
        }),
      ]);

      const expectedWarning =
        '[delete-directory] notes/to-delete-dir: Directory contains 2 item(s); they will be permanently deleted.';
      expect(result.allOk).toBe(true);
      expect(result.results[0].affectedPaths).toEqual(['notes/to-delete-dir']);
      expect(result.results[0].warning).toBe(expectedWarning);
      expect(result.warnings).toEqual([expectedWarning]);
      expect(await pathExists(absolutePath(vault, 'notes/to-delete-dir'))).toBe(false);
    });

    it('deletes an empty directory without warning', async () => {
      const vault = await setupTestVault({}, ['notes/empty-dir']);

      const result = await applyOperations(vault, [
        makeOperation('delete-directory', 'notes/empty-dir', {
          deleteReason: 'No longer needed',
        }),
      ]);

      expect(result.allOk).toBe(true);
      expect(result.results[0].warning).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(await pathExists(absolutePath(vault, 'notes/empty-dir'))).toBe(false);
    });

    it('refuses to delete the vault root', async () => {
      const vault = await setupTestVault({ 'notes/keep.md': '# Keep\n' });

      const result = await applyOperations(vault, [
        makeOperation('delete-directory', '.', { deleteReason: 'No longer needed' }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('Refusing to delete the vault root directory.');
      expect(await readVaultFile(vault, 'notes/keep.md')).toBe('# Keep\n');
    });

    it('fails when the directory does not exist', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('delete-directory', 'notes/missing', {
          deleteReason: 'No longer needed',
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error).toBe('Directory not found: notes/missing');
    });
  });

  // ── reporting ───────────────────────────────────────────────────────────────

  describe('reporting', () => {
    it('applies a plan in order and reports every operation with its index', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('create-directory', 'notes/topic', { purpose: 'Organise notes' }),
        makeOperation('create-note', 'notes/topic/one.md', {
          cardUid: 'CW-ONE',
          title: 'One',
          content: 'Prose.',
        }),
        makeOperation('insert-boundary-pair', 'notes/topic/one.md', {
          cardUid: 'CW-ONE',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-ONE', 'Card body'),
        }),
      ]);

      expect(
        result.results.map((entry) => [entry.operationIndex, entry.kind, entry.targetPath]),
      ).toEqual([
        [0, 'create-directory', 'notes/topic'],
        [1, 'create-note', 'notes/topic/one.md'],
        [2, 'insert-boundary-pair', 'notes/topic/one.md'],
      ]);
      expect(result.allOk).toBe(true);
      expect(result.appliedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(await readVaultFile(vault, 'notes/topic/one.md')).toBe(
        [
          '# One',
          '',
          'Prose.',
          formatCardStartBoundary('CW-ONE'),
          'Card body',
          formatCardEndBoundary('CW-ONE'),
        ].join('\n'),
      );
    });

    it('stops on the first failure by default and reports the rest as skipped', async () => {
      const original = '# Valid\n';
      const vault = await setupTestVault({ 'notes/valid.md': original });

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', 'notes/missing.md', {
          cardUid: 'CW-FAIL',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-FAIL', 'Card content'),
        }),
        makeOperation('insert-boundary-pair', 'notes/valid.md', {
          cardUid: 'CW-SKIPPED',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-SKIPPED', 'Card content'),
        }),
      ]);

      expect(result.results).toEqual([
        {
          operationIndex: 0,
          kind: 'insert-boundary-pair',
          targetPath: 'notes/missing.md',
          ok: false,
          error: expect.stringContaining('Note not found'),
        },
        {
          operationIndex: 1,
          kind: 'insert-boundary-pair',
          targetPath: 'notes/valid.md',
          ok: false,
          error: 'Skipped due to previous failure.',
        },
      ]);
      expect(result.allOk).toBe(false);
      expect(result.appliedCount).toBe(0);
      expect(result.failedCount).toBe(2);
      expect(await readVaultFile(vault, 'notes/valid.md')).toBe(original);
    });

    it('continues after a failure when stopOnError is false', async () => {
      const vault = await setupTestVault({ 'notes/valid.md': '# Valid\n' });

      const result = await applyOperations(
        vault,
        [
          makeOperation('edit-note-content', 'notes/valid.md', {
            action: 'replace-selection',
            targetText: 'Non-existent text',
            replacementMarkdown: 'Replacement',
          }),
          makeOperation('insert-boundary-pair', 'notes/valid.md', {
            cardUid: 'CW-CONTINUE',
            placement: 'append-to-note',
            boundaryBlock: boundaryBlock('CW-CONTINUE', 'This should be applied'),
          }),
        ],
        { stopOnError: false },
      );

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[1].ok).toBe(true);
      expect(result.appliedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(await readVaultFile(vault, 'notes/valid.md')).toBe(
        [
          '# Valid',
          '',
          formatCardStartBoundary('CW-CONTINUE'),
          'This should be applied',
          formatCardEndBoundary('CW-CONTINUE'),
        ].join('\n'),
      );
    });

    it('reports an unknown operation kind as a failed result and skips the rest', async () => {
      const vault = await setupTestVault({});
      // Plan data crosses IPC, so a kind outside the contract union is
      // reachable at runtime; the double assertion is the deliberate way to
      // feed the guard without widening the operation type for every test.
      const unknownOperation = {
        kind: 'not-a-real-kind',
        targetPath: 'notes/somewhere.md',
        payload: {},
        rationale: 'Unknown kind under test',
      } as unknown as WeavePlanOperation;

      const result = await applyOperations(vault, [
        unknownOperation,
        makeOperation('create-directory', 'notes/after-failure', { purpose: 'Skipped' }),
      ]);

      expect(result.results).toEqual([
        {
          operationIndex: 0,
          kind: 'not-a-real-kind',
          targetPath: 'notes/somewhere.md',
          ok: false,
          error: 'Unknown operation kind: not-a-real-kind',
        },
        {
          operationIndex: 1,
          kind: 'create-directory',
          targetPath: 'notes/after-failure',
          ok: false,
          error: 'Skipped due to previous failure.',
        },
      ]);
      expect(result.allOk).toBe(false);
      expect(result.failedCount).toBe(2);
      expect(await pathExists(absolutePath(vault, 'notes/after-failure'))).toBe(false);
    });

    it('rejects a target path that escapes the vault root', async () => {
      const vault = await setupTestVault({});

      const result = await applyOperations(vault, [
        makeOperation('insert-boundary-pair', '../outside-vault.md', {
          cardUid: 'CW-ESCAPE',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-ESCAPE', 'Card content'),
        }),
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('Path escapes vault root: ../outside-vault.md');
    });
  });

  // ── dry run ─────────────────────────────────────────────────────────────────

  describe('dry run', () => {
    type DryRunCase = {
      name: string;
      files?: Record<string, string>;
      operation: WeavePlanOperation;
    };

    type DryRunNoWriteCase = DryRunCase & { affectedPaths: string[] };
    type DryRunRefusedCase = DryRunCase & { realRunError: string };

    /**
     * Runs an operation as a dry run and then for real. Every dry-run case is
     * paired with the real run so the test proves the operation was genuinely
     * refused and the dry run reported success only because it skipped the
     * check that refuses it. `afterDryRun` asserts on the vault between the two
     * runs, before the real run mutates it.
     */
    async function applyDryRunThenRealRun(
      vault: TestVault,
      operation: WeavePlanOperation,
      afterDryRun?: () => Promise<void>,
    ) {
      const dryRunResult = await applyOperations(vault, [operation], { dryRun: true });
      await afterDryRun?.();
      const realResult = await applyOperations(vault, [operation]);
      return { dryRunResult, realResult };
    }

    // One valid operation per kind: every handler returns success and reports
    // affected paths, and nothing under the vault root changes.
    const noWriteCases: DryRunNoWriteCase[] = [
      {
        name: 'insert-boundary-pair',
        files: { 'notes/target.md': '# Note\n\nContent.\n' },
        operation: makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-DRY-INSERT',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-DRY-INSERT', 'Dry run card'),
        }),
        affectedPaths: ['notes/target.md'],
      },
      {
        name: 'edit-note-content',
        files: { 'notes/target.md': '# Note\n\nOld text.\n' },
        operation: makeOperation('edit-note-content', 'notes/target.md', {
          action: 'replace-selection',
          targetText: 'Old text.',
          replacementMarkdown: 'New text.',
        }),
        affectedPaths: ['notes/target.md'],
      },
      {
        name: 'create-note',
        operation: makeOperation('create-note', 'notes/new-note.md', {
          cardUid: 'CW-DRY-CREATE',
          title: 'New note',
          content: 'Content.',
        }),
        affectedPaths: ['notes/new-note.md'],
      },
      {
        name: 'rename-note',
        files: { 'notes/old.md': '# Old\n' },
        operation: makeOperation('rename-note', 'notes/new.md', {
          fromPath: 'notes/old.md',
          toPath: 'notes/new.md',
          renameReason: 'Dry run',
        }),
        affectedPaths: ['notes/old.md', 'notes/new.md'],
      },
      {
        name: 'move-note',
        files: { 'notes/old.md': '# Old\n' },
        operation: makeOperation('move-note', 'notes/archive/old.md', {
          fromPath: 'notes/old.md',
          toPath: 'notes/archive/old.md',
          moveReason: 'Dry run',
        }),
        affectedPaths: ['notes/old.md', 'notes/archive/old.md'],
      },
      {
        name: 'delete-note',
        files: { 'notes/doomed.md': '# Doomed\n' },
        operation: makeOperation('delete-note', 'notes/doomed.md', { deleteReason: 'Dry run' }),
        affectedPaths: ['notes/doomed.md'],
      },
      {
        name: 'create-directory',
        operation: makeOperation('create-directory', 'notes/topic', { purpose: 'Dry run' }),
        affectedPaths: ['notes/topic'],
      },
      {
        name: 'rename-directory',
        files: { 'notes/topic/note.md': '# Note\n' },
        operation: makeOperation('rename-directory', 'notes/topic-renamed', {
          fromPath: 'notes/topic',
          toPath: 'notes/topic-renamed',
          renameReason: 'Dry run',
        }),
        affectedPaths: ['notes/topic', 'notes/topic-renamed'],
      },
      {
        name: 'move-directory',
        files: { 'notes/topic/note.md': '# Note\n' },
        operation: makeOperation('move-directory', 'archive/topic', {
          fromPath: 'notes/topic',
          toPath: 'archive/topic',
          moveReason: 'Dry run',
        }),
        affectedPaths: ['notes/topic', 'archive/topic'],
      },
      {
        name: 'delete-directory',
        files: { 'notes/doomed/note.md': '# Note\n' },
        operation: makeOperation('delete-directory', 'notes/doomed', { deleteReason: 'Dry run' }),
        affectedPaths: ['notes/doomed'],
      },
    ];

    for (const testCase of noWriteCases) {
      it(`${testCase.name} writes nothing under a dry run`, async () => {
        const vault = await setupTestVault(testCase.files);
        const before = await snapshotVault(vault.rootPath);

        const result = await applyOperations(vault, [testCase.operation], { dryRun: true });

        expect(result).toEqual({
          results: [
            {
              operationIndex: 0,
              kind: testCase.operation.kind,
              targetPath: testCase.operation.targetPath,
              ok: true,
              affectedPaths: testCase.affectedPaths,
            },
          ],
          allOk: true,
          appliedCount: 1,
          failedCount: 0,
          warnings: [],
        });
        expect(await snapshotVault(vault.rootPath)).toEqual(before);
      });
    }

    // Every case here is an operation the real run refuses because of a check
    // the early return skips: note existence, target-text presence, boundary
    // integrity, destination occupancy, or directory existence. The dry run
    // reports it as applied, which is the behaviour under test.
    const skippedValidationCases: DryRunRefusedCase[] = [
      {
        name: 'insert-boundary-pair on a missing note',
        operation: makeOperation('insert-boundary-pair', 'notes/missing.md', {
          cardUid: 'CW-DRY-MISSING',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-DRY-MISSING', 'Card content'),
        }),
        realRunError: 'Note not found',
      },
      {
        name: 'insert-boundary-pair with a block that breaks a boundary pair',
        files: { 'notes/target.md': '# Note\n\nContent.\n' },
        operation: makeOperation('insert-boundary-pair', 'notes/target.md', {
          cardUid: 'CW-DRY-BROKEN',
          placement: 'append-to-note',
          boundaryBlock: `${formatCardStartBoundary('CW-DRY-BROKEN')}\nbody without an end boundary`,
        }),
        realRunError: 'Boundary integrity check failed',
      },
      {
        name: 'edit-note-content when the target text is absent',
        files: { 'notes/target.md': '# Note\n\nContent.\n' },
        operation: makeOperation('edit-note-content', 'notes/target.md', {
          action: 'replace-selection',
          targetText: 'Absent text.',
          replacementMarkdown: 'Replacement.',
        }),
        realRunError: 'Target text not found',
      },
      {
        name: 'edit-note-content that breaks a boundary pair',
        files: {
          'notes/target.md': [
            '# Note',
            '',
            formatCardStartBoundary('CW-DRY-PAIR'),
            'body',
            formatCardEndBoundary('CW-DRY-PAIR'),
            '',
          ].join('\n'),
        },
        operation: makeOperation('edit-note-content', 'notes/target.md', {
          action: 'replace-selection',
          targetText: formatCardEndBoundary('CW-DRY-PAIR'),
          replacementMarkdown: 'Broken boundary',
        }),
        realRunError: 'Boundary integrity check failed',
      },
      {
        name: 'create-note when the path already exists',
        files: { 'notes/existing.md': '# Existing\n' },
        operation: makeOperation('create-note', 'notes/existing.md', {
          cardUid: 'CW-DRY-DUPLICATE',
          title: 'Duplicate',
          content: 'Should not work.',
        }),
        realRunError: 'Note already exists',
      },
      {
        name: 'rename-note when the source is missing',
        operation: makeOperation('rename-note', 'notes/new.md', {
          fromPath: 'notes/missing.md',
          toPath: 'notes/new.md',
          renameReason: 'Dry run',
        }),
        realRunError: 'Note not found',
      },
      {
        name: 'move-note when the source is missing',
        operation: makeOperation('move-note', 'notes/new.md', {
          fromPath: 'notes/missing.md',
          toPath: 'notes/new.md',
          moveReason: 'Dry run',
        }),
        realRunError: 'Note not found',
      },
      {
        name: 'delete-note when the note is missing',
        operation: makeOperation('delete-note', 'notes/missing.md', { deleteReason: 'Dry run' }),
        realRunError: 'Note not found',
      },
      {
        name: 'rename-directory when the source is missing',
        operation: makeOperation('rename-directory', 'notes/renamed', {
          fromPath: 'notes/missing',
          toPath: 'notes/renamed',
          renameReason: 'Dry run',
        }),
        realRunError: 'Directory not found',
      },
      {
        name: 'move-directory when the source is missing',
        operation: makeOperation('move-directory', 'notes/renamed', {
          fromPath: 'notes/missing',
          toPath: 'notes/renamed',
          moveReason: 'Dry run',
        }),
        realRunError: 'Directory not found',
      },
      {
        name: 'delete-directory when the directory is missing',
        operation: makeOperation('delete-directory', 'notes/missing', { deleteReason: 'Dry run' }),
        realRunError: 'Directory not found',
      },
    ];

    for (const testCase of skippedValidationCases) {
      it(`skips validation: ${testCase.name}`, async () => {
        const vault = await setupTestVault(testCase.files);
        const before = await snapshotVault(vault.rootPath);
        const { dryRunResult, realResult } = await applyDryRunThenRealRun(
          vault,
          testCase.operation,
        );

        expect(dryRunResult.allOk).toBe(true);
        expect(dryRunResult.results[0].ok).toBe(true);
        expect(dryRunResult.results[0].error).toBeUndefined();
        expect(dryRunResult.warnings).toEqual([]);
        expect(await snapshotVault(vault.rootPath)).toEqual(before);

        expect(realResult.allOk).toBe(false);
        expect(realResult.results[0].ok).toBe(false);
        expect(realResult.results[0].error).toContain(testCase.realRunError);
      });
    }

    it('skips the vault-root guard for delete-directory', async () => {
      const vault = await setupTestVault({ 'notes/keep.md': '# Keep\n' });
      const operation = makeOperation('delete-directory', '.', { deleteReason: 'Dry run' });
      const { dryRunResult, realResult } = await applyDryRunThenRealRun(vault, operation);

      expect(dryRunResult.allOk).toBe(true);
      expect(dryRunResult.results[0].ok).toBe(true);
      expect(await readVaultFile(vault, 'notes/keep.md')).toBe('# Keep\n');

      expect(realResult.allOk).toBe(false);
      expect(realResult.results[0].error).toBe('Refusing to delete the vault root directory.');
      expect(await readVaultFile(vault, 'notes/keep.md')).toBe('# Keep\n');
    });

    it('reports no non-empty-directory warning under a dry run', async () => {
      const vault = await setupTestVault({
        'notes/topic/one.md': '# One\n',
        'notes/topic/two.md': '# Two\n',
      });
      const operation = makeOperation('delete-directory', 'notes/topic', {
        deleteReason: 'Dry run',
      });
      const { dryRunResult, realResult } = await applyDryRunThenRealRun(
        vault,
        operation,
        async () => {
          expect(await pathExists(absolutePath(vault, 'notes/topic'))).toBe(true);
        },
      );

      expect(dryRunResult.allOk).toBe(true);
      expect(dryRunResult.results[0].warning).toBeUndefined();
      expect(dryRunResult.warnings).toEqual([]);

      expect(realResult.allOk).toBe(true);
      expect(realResult.warnings).toEqual([
        '[delete-directory] notes/topic: Directory contains 2 item(s); they will be permanently deleted.',
      ]);
      expect(await pathExists(absolutePath(vault, 'notes/topic'))).toBe(false);
    });

    // Every handler must run its vault-boundary assertion before the dry-run
    // early return, so a dry run still validates containment.
    const escapeCases: DryRunCase[] = [
      {
        name: 'insert-boundary-pair',
        operation: makeOperation('insert-boundary-pair', '../escape-vault.md', {
          cardUid: 'CW-ESCAPE',
          placement: 'append-to-note',
          boundaryBlock: boundaryBlock('CW-ESCAPE', 'Card content'),
        }),
      },
      {
        name: 'edit-note-content',
        operation: makeOperation('edit-note-content', '../escape-vault.md', {
          action: 'replace-selection',
          targetText: 'anything',
          replacementMarkdown: 'replacement',
        }),
      },
      {
        name: 'create-note',
        operation: makeOperation('create-note', '../escape-vault.md', {
          cardUid: 'CW-ESCAPE',
          title: 'Escape',
          content: 'Should not be written.',
        }),
      },
      {
        name: 'rename-note',
        operation: makeOperation('rename-note', 'notes/new.md', {
          fromPath: '../escape-vault.md',
          toPath: 'notes/new.md',
          renameReason: 'Escape',
        }),
      },
      {
        name: 'move-note',
        operation: makeOperation('move-note', 'notes/new.md', {
          fromPath: '../escape-vault.md',
          toPath: 'notes/new.md',
          moveReason: 'Escape',
        }),
      },
      {
        name: 'delete-note',
        operation: makeOperation('delete-note', '../escape-vault.md', {
          deleteReason: 'Escape',
        }),
      },
      {
        name: 'create-directory',
        operation: makeOperation('create-directory', '../escape-vault-dir', {
          purpose: 'Escape',
        }),
      },
      {
        name: 'rename-directory',
        operation: makeOperation('rename-directory', 'notes/new-dir', {
          fromPath: '../escape-vault-dir',
          toPath: 'notes/new-dir',
          renameReason: 'Escape',
        }),
      },
      {
        name: 'move-directory',
        operation: makeOperation('move-directory', 'notes/new-dir', {
          fromPath: '../escape-vault-dir',
          toPath: 'notes/new-dir',
          moveReason: 'Escape',
        }),
      },
      {
        name: 'delete-directory',
        operation: makeOperation('delete-directory', '../escape-vault-dir', {
          deleteReason: 'Escape',
        }),
      },
    ];

    function escapingPathOf(operation: WeavePlanOperation): string {
      switch (operation.kind) {
        case 'rename-note':
        case 'move-note':
        case 'rename-directory':
        case 'move-directory':
          return operation.payload.fromPath;
        default:
          return operation.targetPath;
      }
    }

    for (const testCase of escapeCases) {
      it(`still rejects an escaping target: ${testCase.name}`, async () => {
        const vault = await setupTestVault({ 'notes/present.md': '# Present\n' });
        const before = await snapshotVault(vault.rootPath);

        const result = await applyOperations(vault, [testCase.operation], { dryRun: true });

        expect(result.allOk).toBe(false);
        expect(result.results[0].ok).toBe(false);
        expect(result.results[0].error).toBe(
          `Path escapes vault root: ${escapingPathOf(testCase.operation)}`,
        );
        expect(await snapshotVault(vault.rootPath)).toEqual(before);
      });
    }
  });
});

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const { applyWeaveOperations } = require('../../dist-electron/weaver/weaveApplyService.js');
const {
  formatCardStartBoundary,
  formatCardEndBoundary,
} = require('../../dist-electron/cardParser.js');

describe('weaveApplyService', () => {
  /**
   * Creates a temporary test vault with the given structure.
   * Returns { rootPath, cardStorePath, cleanup }.
   */
  async function setupTestVault(notes: Record<string, string>) {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-test-apply-'));
    const cardStorePath = path.join(rootPath, '.crashweaver', 'cards');
    await fs.mkdir(cardStorePath, { recursive: true });

    for (const [relativePath, content] of Object.entries(notes)) {
      const absolutePath = path.join(rootPath, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');
    }

    return {
      rootPath,
      cardStorePath,
      async cleanup() {
        await fs.rm(rootPath, { recursive: true, force: true });
      },
    };
  }

  // ── insert-boundary-pair tests ──────────────────────────────────────────────

  it('insert-boundary-pair: appends to end of note', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/target.md': '# Target Note\n\nSome content here.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'insert-boundary-pair',
          targetPath: 'notes/target.md',
          payload: {
            cardUid: 'CW-TEST',
            placement: 'append-to-note',
            boundaryBlock: `${formatCardStartBoundary('CW-TEST')}\nTest card content\n${formatCardEndBoundary('CW-TEST')}`,
          },
          rationale: 'Add test card to note',
        },
      ]);

      expect(result.allOk).toBe(true);
      expect(result.appliedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
      const startBoundary = formatCardStartBoundary('CW-TEST');
      const endBoundary = formatCardEndBoundary('CW-TEST');
      expect(content.includes(startBoundary), 'Should contain start boundary').toBeTruthy();
      expect(content.includes(endBoundary), 'Should contain end boundary').toBeTruthy();
      expect(
        content.includes('Test card content'),
        'Should contain boundary block content',
      ).toBeTruthy();
      // Boundaries should be at the end
      expect(content.indexOf(startBoundary) > content.indexOf('Some content')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('insert-boundary-pair: prepends to beginning of note', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/target.md': '# Target Note\n\nSome content.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'insert-boundary-pair',
          targetPath: 'notes/target.md',
          payload: {
            cardUid: 'CW-PREPEND',
            placement: 'prepend-to-note',
            boundaryBlock: `${formatCardStartBoundary('CW-PREPEND')}\nPrepended card\n${formatCardEndBoundary('CW-PREPEND')}`,
          },
          rationale: 'Prepend to note',
        },
      ]);

      expect(result.allOk).toBe(true);
      const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
      expect(
        content.startsWith(formatCardStartBoundary('CW-PREPEND')),
        'Should start with boundary',
      ).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('insert-boundary-pair: after a specific heading', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/target.md':
        '# Intro\n\nIntro text.\n\n## Section A\n\nSection content.\n\n## Section B\n\nMore content.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'insert-boundary-pair',
          targetPath: 'notes/target.md',
          payload: {
            cardUid: 'CW-HEADING',
            placement: 'after-heading',
            headingText: 'Section A',
            boundaryBlock: `${formatCardStartBoundary('CW-HEADING')}\nAfter heading content\n${formatCardEndBoundary('CW-HEADING')}`,
          },
          rationale: 'Insert after Section A',
        },
      ]);

      expect(result.allOk).toBe(true);
      const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
      const lines = content.split('\n');
      const headingIndex = lines.findIndex((l) => l.includes('## Section A'));
      const boundaryIndex = lines.findIndex((l) =>
        l.includes(formatCardStartBoundary('CW-HEADING')),
      );
      expect(boundaryIndex > headingIndex, 'Boundary should be after the heading').toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('insert-boundary-pair: before a specific heading', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/target.md': '# Intro\n\nIntro text.\n\n## Section B\n\nSection content.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'insert-boundary-pair',
          targetPath: 'notes/target.md',
          payload: {
            cardUid: 'CW-BEFORE',
            placement: 'before-heading',
            headingText: 'Section B',
            boundaryBlock: `${formatCardStartBoundary('CW-BEFORE')}\nBefore heading content\n${formatCardEndBoundary('CW-BEFORE')}`,
          },
          rationale: 'Insert before Section B',
        },
      ]);

      expect(result.allOk).toBe(true);
      const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
      const lines = content.split('\n');
      const boundaryIndex = lines.findIndex((l) =>
        l.includes(formatCardStartBoundary('CW-BEFORE')),
      );
      const headingIndex = lines.findIndex((l) => l.includes('## Section B'));
      expect(boundaryIndex, 'Boundary should be present in content').not.toBe(-1);
      expect(boundaryIndex < headingIndex, 'Boundary should be before the heading').toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('insert-boundary-pair: after selection text', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/target.md':
        '# Note\n\nThis is paragraph one.\n\nThis is paragraph two.\n\nThis is paragraph three.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'insert-boundary-pair',
          targetPath: 'notes/target.md',
          payload: {
            cardUid: 'CW-SEL',
            placement: 'after-selection',
            selectedText: 'This is paragraph one.',
            boundaryBlock: `${formatCardStartBoundary('CW-SEL')}\nAfter selection content\n${formatCardEndBoundary('CW-SEL')}`,
          },
          rationale: 'Insert after paragraph one',
        },
      ]);

      expect(result.allOk).toBe(true);
      const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
      const lines = content.split('\n');
      const paraOneIndex = lines.findIndex((l) => l === 'This is paragraph one.');
      const boundaryIndex = lines.findIndex((l) => l.includes(formatCardStartBoundary('CW-SEL')));
      expect(boundaryIndex > paraOneIndex, 'Boundary should be after paragraph one').toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  // ── edit-note-content tests ─────────────────────────────────────────────────

  it('edit-note-content: replaces target text in note', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/target.md': '# Note\n\nOriginal text that needs updating.\n\nMore content.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'edit-note-content',
          targetPath: 'notes/target.md',
          payload: {
            action: 'replace-selection',
            targetText: 'Original text that needs updating.',
            replacementMarkdown: 'Updated text with new information.',
          },
          rationale: 'Update the content',
        },
      ]);

      expect(result.allOk).toBe(true);
      const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
      expect(content.includes('Updated text with new information.')).toBeTruthy();
      expect(!content.includes('Original text that needs updating.')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('edit-note-content: fails when target text not found', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/target.md': '# Note\n\nSome content.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'edit-note-content',
          targetPath: 'notes/target.md',
          payload: {
            action: 'replace-selection',
            targetText: 'This text does not exist in the note.',
            replacementMarkdown: 'Replacement.',
          },
          rationale: 'Should fail',
        },
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error.includes('Target text not found')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('edit-note-content: fails when edit would break boundary integrity', async () => {
    const uid = 'CW-PROTECTED';
    const startBoundary = formatCardStartBoundary(uid);
    const endBoundary = formatCardEndBoundary(uid);

    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/target.md': `# Note\n\nSome text.\n\n${startBoundary}\ncard body\n${endBoundary}\n\nMore text.\n`,
    });

    try {
      // Try to replace text that includes the end boundary but not the start
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'edit-note-content',
          targetPath: 'notes/target.md',
          payload: {
            action: 'replace-selection',
            targetText: endBoundary,
            replacementMarkdown: 'Broken boundary',
          },
          rationale: 'Should fail - breaks boundary pair',
        },
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
    } finally {
      await cleanup();
    }
  });

  // ── create-note tests ───────────────────────────────────────────────────────

  it('create-note: creates a new markdown note with boundary pair', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({});

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'create-note',
          targetPath: 'notes/new-note.md',
          payload: {
            cardUid: 'CW-NEW',
            title: 'New Test Note',
            content: `${formatCardStartBoundary('CW-NEW')}\nThis is the content of the new note.\n${formatCardEndBoundary('CW-NEW')}`,
          },
          rationale: 'Create a new note for the card',
        },
      ]);

      expect(result.allOk).toBe(true);
      expect(result.appliedCount).toBe(1);

      const content = await fs.readFile(path.join(rootPath, 'notes/new-note.md'), 'utf8');
      expect(content.includes('# New Test Note')).toBeTruthy();
      expect(content.includes('This is the content of the new note.')).toBeTruthy();
      expect(content.includes(formatCardStartBoundary('CW-NEW'))).toBeTruthy();
      expect(content.includes(formatCardEndBoundary('CW-NEW'))).toBeTruthy();

      // Card JSON should also be auto-created
      const cardPath = path.join(cardStorePath, 'CW-NEW.json');
      const cardRaw = await fs.readFile(cardPath, 'utf8');
      const card = JSON.parse(cardRaw);
      expect(card.uid).toBe('CW-NEW');
    } finally {
      await cleanup();
    }
  });

  it('create-note: fails if note already exists', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/existing.md': '# Existing\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'create-note',
          targetPath: 'notes/existing.md',
          payload: {
            cardUid: 'CW-DUP',
            title: 'Duplicate',
            content: 'Should not work.',
          },
          rationale: 'Should fail - note exists',
        },
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error.includes('already exists')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  // ── rename-note tests ───────────────────────────────────────────────────────

  it('rename-note: renames a note file', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/old-name.md': '# Old Name\n\nContent.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'rename-note',
          targetPath: 'notes/new-name.md',
          payload: {
            fromPath: 'notes/old-name.md',
            toPath: 'notes/new-name.md',
            renameReason: 'Better name',
          },
          rationale: 'Rename for clarity',
        },
      ]);

      expect(result.allOk).toBe(true);
      // Old path should not exist
      await expect(() => fs.stat(path.join(rootPath, 'notes/old-name.md'))).rejects.toThrow();
      // New path should exist
      const content = await fs.readFile(path.join(rootPath, 'notes/new-name.md'), 'utf8');
      expect(content.includes('# Old Name')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  // ── move-note tests ─────────────────────────────────────────────────────────

  it('move-note: moves a note to a different directory', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/subject.md': '# Subject\n\nContent.\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'move-note',
          targetPath: 'notes/archive/subject.md',
          payload: {
            fromPath: 'notes/subject.md',
            toPath: 'notes/archive/subject.md',
            moveReason: 'Archiving',
          },
          rationale: 'Move to archive',
        },
      ]);

      expect(result.allOk).toBe(true);
      await expect(() => fs.stat(path.join(rootPath, 'notes/subject.md'))).rejects.toThrow();
      const content = await fs.readFile(path.join(rootPath, 'notes/archive/subject.md'), 'utf8');
      expect(content.includes('# Subject')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  // ── delete-note tests ───────────────────────────────────────────────────────

  it('delete-note: deletes a note file and cleans up card references', async () => {
    const uid = 'CW-DELREF';
    const startBoundary = formatCardStartBoundary(uid);
    const endBoundary = formatCardEndBoundary(uid);

    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/to-delete.md': `# Delete Me\n\n${startBoundary}\ncontent\n${endBoundary}\n`,
    });

    // Pre-create the card JSON with a reference to this note
    const cardData = {
      uid,
      type: [],
      raw_content: 'content',
      metadata: { familiarity: 0, next_review: null },
      memory_tricks: { memory_technique: '', qa_pairs: [] },
      referenced_in: [{ note_path: 'notes/to-delete.md', start_line: 3, end_line: 5 }],
    };
    await fs.writeFile(
      path.join(cardStorePath, `${uid}.json`),
      JSON.stringify(cardData, null, 2),
      'utf8',
    );

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'delete-note',
          targetPath: 'notes/to-delete.md',
          payload: { deleteReason: 'No longer needed' },
          rationale: 'Remove obsolete note',
        },
      ]);

      expect(result.allOk).toBe(true);
      // File should be gone
      await expect(() => fs.stat(path.join(rootPath, 'notes/to-delete.md'))).rejects.toThrow();

      // Card should no longer reference the deleted note
      const cardRaw = await fs.readFile(path.join(cardStorePath, `${uid}.json`), 'utf8');
      const card = JSON.parse(cardRaw);
      expect(
        card.referenced_in.filter(
          (r: { note_path: string }) => r.note_path === 'notes/to-delete.md',
        ).length,
        'Card should not reference the deleted note',
      ).toBe(0);
    } finally {
      await cleanup();
    }
  });

  // ── directory operations tests ──────────────────────────────────────────────

  it('create-directory: creates a new directory', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({});

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'create-directory',
          targetPath: 'notes/new-topic',
          payload: { purpose: 'Organize topic notes' },
          rationale: 'Create topic folder',
        },
      ]);

      expect(result.allOk).toBe(true);
      const stats = await fs.stat(path.join(rootPath, 'notes/new-topic'));
      expect(stats.isDirectory()).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('rename-directory: renames an existing directory', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/old-dir/placeholder.md': '# Placeholder\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'rename-directory',
          targetPath: 'notes/new-dir',
          payload: {
            fromPath: 'notes/old-dir',
            toPath: 'notes/new-dir',
            renameReason: 'Better name',
          },
          rationale: 'Rename directory',
        },
      ]);

      expect(result.allOk).toBe(true);
      await expect(() => fs.stat(path.join(rootPath, 'notes/old-dir'))).rejects.toThrow();
      const stats = await fs.stat(path.join(rootPath, 'notes/new-dir'));
      expect(stats.isDirectory()).toBeTruthy();
      // File inside should still exist
      const fileStats = await fs.stat(path.join(rootPath, 'notes/new-dir/placeholder.md'));
      expect(fileStats.isFile()).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('delete-directory: deletes a directory and its contents', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/to-delete-dir/file1.md': '# File 1\n',
      'notes/to-delete-dir/file2.md': '# File 2\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'delete-directory',
          targetPath: 'notes/to-delete-dir',
          payload: { deleteReason: 'No longer needed' },
          rationale: 'Remove obsolete directory',
        },
      ]);

      expect(result.allOk).toBe(true);
      // Should warn about non-empty directory
      expect(result.warnings.length > 0, 'Should warn about non-empty directory').toBeTruthy();

      await expect(() => fs.stat(path.join(rootPath, 'notes/to-delete-dir'))).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  // ── dry-run mode tests ──────────────────────────────────────────────────────

  it('dryRun: does not modify any files', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/safe.md': '# Safe Note\n\nOriginal content.\n',
    });

    try {
      const originalContent = await fs.readFile(path.join(rootPath, 'notes/safe.md'), 'utf8');

      const result = await applyWeaveOperations(
        rootPath,
        cardStorePath,
        [
          {
            kind: 'insert-boundary-pair',
            targetPath: 'notes/safe.md',
            payload: {
              cardUid: 'CW-DRY',
              placement: 'append-to-note',
              boundaryBlock: 'Should not be written',
            },
            rationale: 'Dry run test',
          },
        ],
        { dryRun: true },
      );

      expect(result.allOk).toBe(true);
      const contentAfter = await fs.readFile(path.join(rootPath, 'notes/safe.md'), 'utf8');
      expect(contentAfter, 'File should be unchanged in dry-run mode').toBe(originalContent);
    } finally {
      await cleanup();
    }
  });

  // ── stopOnError tests ───────────────────────────────────────────────────────

  it('stopOnError: stops after first failure (default)', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/valid.md': '# Valid\n',
    });

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'edit-note-content',
          targetPath: 'notes/valid.md',
          payload: {
            action: 'replace-selection',
            targetText: 'Non-existent text',
            replacementMarkdown: 'Replacement',
          },
          rationale: 'This will fail',
        },
        {
          kind: 'insert-boundary-pair',
          targetPath: 'notes/valid.md',
          payload: {
            cardUid: 'CW-SKIP',
            placement: 'append-to-note',
            boundaryBlock: 'This should be skipped',
          },
          rationale: 'Should be skipped due to stopOnError',
        },
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[1].ok).toBe(false);
      expect(result.results[1].error.includes('Skipped')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it('stopOnError false: continues after failure', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({
      'notes/valid.md': '# Valid\n',
    });

    try {
      const result = await applyWeaveOperations(
        rootPath,
        cardStorePath,
        [
          {
            kind: 'edit-note-content',
            targetPath: 'notes/valid.md',
            payload: {
              action: 'replace-selection',
              targetText: 'Non-existent text',
              replacementMarkdown: 'Replacement',
            },
            rationale: 'This will fail',
          },
          {
            kind: 'insert-boundary-pair',
            targetPath: 'notes/valid.md',
            payload: {
              cardUid: 'CW-CONTINUE',
              placement: 'append-to-note',
              boundaryBlock: 'This should be applied',
            },
            rationale: 'Should still run',
          },
        ],
        { stopOnError: false },
      );

      expect(result.allOk).toBe(false);
      expect(result.results[0].ok).toBe(false);
      expect(result.results[1].ok).toBe(true); // Second op should succeed
    } finally {
      await cleanup();
    }
  });

  // ── path escape prevention ──────────────────────────────────────────────────

  it('safety: rejects paths that escape vault root', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({});

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'insert-boundary-pair',
          targetPath: '../outside-vault.md',
          payload: {
            cardUid: 'CW-ESCAPE',
            placement: 'append-to-note',
            boundaryBlock: 'Should fail',
          },
          rationale: 'Path escape attempt',
        },
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error.includes('escapes vault root')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  // ── unknown operation kind ──────────────────────────────────────────────────

  it('safety: handles unknown operation kind', async () => {
    const { rootPath, cardStorePath, cleanup } = await setupTestVault({});

    try {
      const result = await applyWeaveOperations(rootPath, cardStorePath, [
        {
          kind: 'not-a-real-kind',
          targetPath: 'notes/somewhere.md',
          payload: {},
          rationale: 'This kind does not exist',
        },
      ]);

      expect(result.allOk).toBe(false);
      expect(result.results[0].error.includes('Unknown operation kind')).toBeTruthy();
    } finally {
      await cleanup();
    }
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { applyWeaveOperations } = require('../../dist-electron/weaver/weaveApplyService.js');
const { formatCardStartBoundary, formatCardEndBoundary } = require('../../dist-electron/cardParser.js');

/**
 * Creates a temporary test vault with the given structure.
 * Returns { rootPath, cardStorePath, cleanup }.
 */
async function setupTestVault(notes) {
  const rootPath = path.join(os.tmpdir(), `cw-test-apply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

test('insert-boundary-pair: appends to end of note', async (t) => {
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

    assert.equal(result.allOk, true);
    assert.equal(result.appliedCount, 1);
    assert.equal(result.failedCount, 0);

    const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
    const startBoundary = formatCardStartBoundary('CW-TEST');
    const endBoundary = formatCardEndBoundary('CW-TEST');
    assert.ok(content.includes(startBoundary), 'Should contain start boundary');
    assert.ok(content.includes(endBoundary), 'Should contain end boundary');
    assert.ok(content.includes('Test card content'), 'Should contain boundary block content');
    // Boundaries should be at the end
    assert.ok(content.indexOf(startBoundary) > content.indexOf('Some content'));
  } finally {
    await cleanup();
  }
});

test('insert-boundary-pair: prepends to beginning of note', async (t) => {
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

    assert.equal(result.allOk, true);
    const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
    assert.ok(content.startsWith(formatCardStartBoundary('CW-PREPEND')), 'Should start with boundary');
  } finally {
    await cleanup();
  }
});

test('insert-boundary-pair: after a specific heading', async (t) => {
  const { rootPath, cardStorePath, cleanup } = await setupTestVault({
    'notes/target.md': '# Intro\n\nIntro text.\n\n## Section A\n\nSection content.\n\n## Section B\n\nMore content.\n',
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

    assert.equal(result.allOk, true);
    const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
    const lines = content.split('\n');
    const headingIndex = lines.findIndex((l) => l.includes('## Section A'));
    const boundaryIndex = lines.findIndex((l) => l.includes(formatCardStartBoundary('CW-HEADING')));
    assert.ok(boundaryIndex > headingIndex, 'Boundary should be after the heading');
  } finally {
    await cleanup();
  }
});

test('insert-boundary-pair: before a specific heading', async (t) => {
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

    assert.equal(result.allOk, true);
    const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
    const lines = content.split('\n');
    const boundaryIndex = lines.findIndex((l) => l.includes(formatCardStartBoundary('CW-BEFORE')));
    const headingIndex = lines.findIndex((l) => l.includes('## Section B'));
    assert.notStrictEqual(boundaryIndex, -1, 'Boundary should be present in content');
    assert.ok(boundaryIndex < headingIndex, 'Boundary should be before the heading');
  } finally {
    await cleanup();
  }
});

test('insert-boundary-pair: after selection text', async (t) => {
  const { rootPath, cardStorePath, cleanup } = await setupTestVault({
    'notes/target.md': '# Note\n\nThis is paragraph one.\n\nThis is paragraph two.\n\nThis is paragraph three.\n',
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

    assert.equal(result.allOk, true);
    const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
    const lines = content.split('\n');
    const paraOneIndex = lines.findIndex((l) => l === 'This is paragraph one.');
    const boundaryIndex = lines.findIndex((l) => l.includes(formatCardStartBoundary('CW-SEL')));
    assert.ok(boundaryIndex > paraOneIndex, 'Boundary should be after paragraph one');
  } finally {
    await cleanup();
  }
});

// ── edit-note-content tests ─────────────────────────────────────────────────

test('edit-note-content: replaces target text in note', async (t) => {
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

    assert.equal(result.allOk, true);
    const content = await fs.readFile(path.join(rootPath, 'notes/target.md'), 'utf8');
    assert.ok(content.includes('Updated text with new information.'));
    assert.ok(!content.includes('Original text that needs updating.'));
  } finally {
    await cleanup();
  }
});

test('edit-note-content: fails when target text not found', async (t) => {
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

    assert.equal(result.allOk, false);
    assert.equal(result.results[0].ok, false);
    assert.ok(result.results[0].error.includes('Target text not found'));
  } finally {
    await cleanup();
  }
});

test('edit-note-content: fails when edit would break boundary integrity', async (t) => {
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

    assert.equal(result.allOk, false);
    assert.equal(result.results[0].ok, false);
  } finally {
    await cleanup();
  }
});

// ── create-note tests ───────────────────────────────────────────────────────

test('create-note: creates a new markdown note with boundary pair', async (t) => {
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

    assert.equal(result.allOk, true);
    assert.equal(result.appliedCount, 1);

    const content = await fs.readFile(path.join(rootPath, 'notes/new-note.md'), 'utf8');
    assert.ok(content.includes('# New Test Note'));
    assert.ok(content.includes('This is the content of the new note.'));
    assert.ok(content.includes(formatCardStartBoundary('CW-NEW')));
    assert.ok(content.includes(formatCardEndBoundary('CW-NEW')));

    // Card JSON should also be auto-created
    const cardPath = path.join(cardStorePath, 'CW-NEW.json');
    const cardRaw = await fs.readFile(cardPath, 'utf8');
    const card = JSON.parse(cardRaw);
    assert.equal(card.uid, 'CW-NEW');
  } finally {
    await cleanup();
  }
});

test('create-note: fails if note already exists', async (t) => {
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

    assert.equal(result.allOk, false);
    assert.equal(result.results[0].ok, false);
    assert.ok(result.results[0].error.includes('already exists'));
  } finally {
    await cleanup();
  }
});

// ── rename-note tests ───────────────────────────────────────────────────────

test('rename-note: renames a note file', async (t) => {
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

    assert.equal(result.allOk, true);
    // Old path should not exist
    await assert.rejects(() => fs.stat(path.join(rootPath, 'notes/old-name.md')));
    // New path should exist
    const content = await fs.readFile(path.join(rootPath, 'notes/new-name.md'), 'utf8');
    assert.ok(content.includes('# Old Name'));
  } finally {
    await cleanup();
  }
});

// ── move-note tests ─────────────────────────────────────────────────────────

test('move-note: moves a note to a different directory', async (t) => {
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

    assert.equal(result.allOk, true);
    await assert.rejects(() => fs.stat(path.join(rootPath, 'notes/subject.md')));
    const content = await fs.readFile(path.join(rootPath, 'notes/archive/subject.md'), 'utf8');
    assert.ok(content.includes('# Subject'));
  } finally {
    await cleanup();
  }
});

// ── delete-note tests ───────────────────────────────────────────────────────

test('delete-note: deletes a note file and cleans up card references', async (t) => {
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
  await fs.writeFile(path.join(cardStorePath, `${uid}.json`), JSON.stringify(cardData, null, 2), 'utf8');

  try {
    const result = await applyWeaveOperations(rootPath, cardStorePath, [
      {
        kind: 'delete-note',
        targetPath: 'notes/to-delete.md',
        payload: { deleteReason: 'No longer needed' },
        rationale: 'Remove obsolete note',
      },
    ]);

    assert.equal(result.allOk, true);
    // File should be gone
    await assert.rejects(() => fs.stat(path.join(rootPath, 'notes/to-delete.md')));

    // Card should no longer reference the deleted note
    const cardRaw = await fs.readFile(path.join(cardStorePath, `${uid}.json`), 'utf8');
    const card = JSON.parse(cardRaw);
    assert.equal(card.referenced_in.filter((r) => r.note_path === 'notes/to-delete.md').length, 0,
      'Card should not reference the deleted note');
  } finally {
    await cleanup();
  }
});

// ── directory operations tests ──────────────────────────────────────────────

test('create-directory: creates a new directory', async (t) => {
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

    assert.equal(result.allOk, true);
    const stats = await fs.stat(path.join(rootPath, 'notes/new-topic'));
    assert.ok(stats.isDirectory());
  } finally {
    await cleanup();
  }
});

test('rename-directory: renames an existing directory', async (t) => {
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

    assert.equal(result.allOk, true);
    await assert.rejects(() => fs.stat(path.join(rootPath, 'notes/old-dir')));
    const stats = await fs.stat(path.join(rootPath, 'notes/new-dir'));
    assert.ok(stats.isDirectory());
    // File inside should still exist
    const fileStats = await fs.stat(path.join(rootPath, 'notes/new-dir/placeholder.md'));
    assert.ok(fileStats.isFile());
  } finally {
    await cleanup();
  }
});

test('delete-directory: deletes a directory and its contents', async (t) => {
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

    assert.equal(result.allOk, true);
    // Should warn about non-empty directory
    assert.ok(result.warnings.length > 0, 'Should warn about non-empty directory');

    await assert.rejects(() => fs.stat(path.join(rootPath, 'notes/to-delete-dir')));
  } finally {
    await cleanup();
  }
});

// ── dry-run mode tests ──────────────────────────────────────────────────────

test('dryRun: does not modify any files', async (t) => {
  const { rootPath, cardStorePath, cleanup } = await setupTestVault({
    'notes/safe.md': '# Safe Note\n\nOriginal content.\n',
  });

  try {
    const originalContent = await fs.readFile(path.join(rootPath, 'notes/safe.md'), 'utf8');

    const result = await applyWeaveOperations(rootPath, cardStorePath, [
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
    ], { dryRun: true });

    assert.equal(result.allOk, true);
    const contentAfter = await fs.readFile(path.join(rootPath, 'notes/safe.md'), 'utf8');
    assert.equal(contentAfter, originalContent, 'File should be unchanged in dry-run mode');
  } finally {
    await cleanup();
  }
});

// ── stopOnError tests ───────────────────────────────────────────────────────

test('stopOnError: stops after first failure (default)', async (t) => {
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

    assert.equal(result.allOk, false);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[1].ok, false);
    assert.ok(result.results[1].error.includes('Skipped'));
  } finally {
    await cleanup();
  }
});

test('stopOnError false: continues after failure', async (t) => {
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
          cardUid: 'CW-CONTINUE',
          placement: 'append-to-note',
          boundaryBlock: 'This should be applied',
        },
        rationale: 'Should still run',
      },
    ], { stopOnError: false });

    assert.equal(result.allOk, false);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[1].ok, true); // Second op should succeed
  } finally {
    await cleanup();
  }
});

// ── path escape prevention ──────────────────────────────────────────────────

test('safety: rejects paths that escape vault root', async (t) => {
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

    assert.equal(result.allOk, false);
    assert.ok(result.results[0].error.includes('escapes vault root'));
  } finally {
    await cleanup();
  }
});

// ── unknown operation kind ──────────────────────────────────────────────────

test('safety: handles unknown operation kind', async (t) => {
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

    assert.equal(result.allOk, false);
    assert.ok(result.results[0].error.includes('Unknown operation kind'));
  } finally {
    await cleanup();
  }
});

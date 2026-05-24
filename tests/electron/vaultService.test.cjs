const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const vaultService = require('../../dist-electron/vaultService.js');
const settingsService = require('../../dist-electron/settingsService.js');
const { formatCardEndBoundary, formatCardStartBoundary } = require('../../dist-electron/cardParser.js');

function cloneCardWithReferences(card, references) {
  return {
    ...card,
    referenced_in: references,
  };
}

test('renameCard ignores missing referenced notes and still renames the card', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-rename-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');

  await fs.mkdir(rootPath, { recursive: true });

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const created = await vaultService.createCard(rootPath, 'alpha');
    const saved = await vaultService.saveCard(
      rootPath,
      cloneCardWithReferences(created, [{ note_path: 'missing.md', start_line: 1, end_line: 2 }]),
    );

    const renamed = await vaultService.renameCard(rootPath, 'alpha', {
      ...saved,
      uid: 'beta',
    });

    assert.equal(renamed.previousUid, 'alpha');
    assert.equal(renamed.card.uid, 'beta');
    assert.deepEqual(renamed.updatedNotePaths, []);
    assert.equal(renamed.updatedCrashpads, 0);

    const cards = await vaultService.listCards(rootPath);
    assert.equal(cards.some((card) => card.uid === 'alpha'), false);
    assert.equal(cards.some((card) => card.uid === 'beta'), true);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('deleteCard ignores missing referenced notes when removing boundaries', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-delete-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');

  await fs.mkdir(rootPath, { recursive: true });

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const created = await vaultService.createCard(rootPath, 'gamma');
    await vaultService.saveCard(
      rootPath,
      cloneCardWithReferences(created, [{ note_path: 'missing.md', start_line: 3, end_line: 7 }]),
    );

    const result = await vaultService.deleteCard(rootPath, 'gamma', {
      removeNoteBoundaries: true,
    });

    assert.equal(result.uid, 'gamma');
    assert.equal(result.removedCardFile, true);
    assert.equal(result.removedBoundariesFrom, 0);
    assert.equal(result.removedBoundaryLines, 0);

    const cards = await vaultService.listCards(rootPath);
    assert.equal(cards.some((card) => card.uid === 'gamma'), false);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('renameCard propagates uid updates into active and deleted crashpad entries', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-crashpad-rename-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');

  await fs.mkdir(rootPath, { recursive: true });

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const created = await vaultService.createCard(rootPath, 'rename-src');
    const crashpad = await vaultService.createVaultCrashpad(rootPath, 'daily');

    await vaultService.saveCrashpad(rootPath, {
      ...crashpad,
      cards: [{ uid: 'rename-src', origin: 'existing', addedAt: new Date().toISOString() }],
      deletedCards: [
        {
          uid: 'rename-src',
          origin: 'new',
          deletedAt: new Date().toISOString(),
          removeNoteBoundaries: true,
          card: created,
        },
      ],
    });

    const renamed = await vaultService.renameCard(rootPath, 'rename-src', {
      ...created,
      uid: 'rename-dst',
    });

    assert.equal(renamed.updatedCrashpads, 1);

    const updatedCrashpad = await vaultService.openCrashpad(rootPath, crashpad.id);
    assert.ok(updatedCrashpad);
    assert.equal(updatedCrashpad.cards.some((entry) => entry.uid === 'rename-dst'), true);
    assert.equal(updatedCrashpad.deletedCards.some((entry) => entry.uid === 'rename-dst'), true);
    assert.equal(updatedCrashpad.deletedCards.some((entry) => entry.card.uid === 'rename-dst'), true);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('restoreDeletedCard forget mode clears saved references and reports forgotten count', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-restore-forget-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');

  await fs.mkdir(rootPath, { recursive: true });

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const snapshot = {
      uid: 'restore-uid',
      origin: 'existing',
      deletedAt: new Date().toISOString(),
      removeNoteBoundaries: true,
      card: {
        uid: 'restore-uid',
        type: [],
        raw_content: 'Q\nA',
        metadata: {
          familiarity: 0,
          next_review: null,
        },
        memory_tricks: {
          memory_technique: '',
          qa_pairs: [],
        },
        referenced_in: [
          { note_path: 'missing-one.md', start_line: 1, end_line: 2 },
          { note_path: 'missing-two.md', start_line: 3, end_line: 4 },
        ],
      },
    };

    const result = await vaultService.restoreDeletedCard(rootPath, snapshot, {
      mode: 'forget-note-references',
    });

    assert.equal(result.uid, 'restore-uid');
    assert.equal(result.forgottenReferences, 2);
    assert.equal(result.reinsertedInto, 0);
    assert.equal(result.alreadyPresentIn, 0);
    assert.deepEqual(result.skippedNotePaths, []);

    const cards = await vaultService.listCards(rootPath);
    const restoredCard = cards.find((card) => card.uid === 'restore-uid');
    assert.ok(restoredCard);
    assert.deepEqual(restoredCard.referenced_in, []);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('restoreDeletedCard reinsert mode restores boundaries into matching note content', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-restore-reinsert-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');
  const notePath = path.join(rootPath, 'notes', 'topic.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.writeFile(notePath, ['top', 'Question line', 'Answer line', 'bottom'].join('\n'), 'utf8');

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const snapshot = {
      uid: 'reinsert-uid',
      origin: 'existing',
      deletedAt: new Date().toISOString(),
      removeNoteBoundaries: true,
      card: {
        uid: 'reinsert-uid',
        type: [],
        raw_content: 'Question line\nAnswer line',
        metadata: {
          familiarity: 0,
          next_review: null,
        },
        memory_tricks: {
          memory_technique: '',
          qa_pairs: [],
        },
        referenced_in: [
          { note_path: 'notes/topic.md', start_line: 2, end_line: 5 },
        ],
      },
    };

    const result = await vaultService.restoreDeletedCard(rootPath, snapshot, {
      mode: 'reinsert-note-boundaries',
    });

    assert.equal(result.uid, 'reinsert-uid');
    assert.equal(result.reinsertedInto, 1);
    assert.equal(result.alreadyPresentIn, 0);
    assert.equal(result.forgottenReferences, 0);
    assert.deepEqual(result.skippedNotePaths, []);

    const restoredNote = await fs.readFile(notePath, 'utf8');
    assert.match(restoredNote, new RegExp(formatCardStartBoundary('reinsert-uid').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(restoredNote, new RegExp(formatCardEndBoundary('reinsert-uid').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('restoreDeletedCard reinsert mode reports skipped note when content cannot be matched', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-restore-skipped-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');
  const notePath = path.join(rootPath, 'notes', 'topic.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.writeFile(notePath, ['alpha', 'beta', 'gamma'].join('\n'), 'utf8');

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const snapshot = {
      uid: 'skip-uid',
      origin: 'existing',
      deletedAt: new Date().toISOString(),
      removeNoteBoundaries: true,
      card: {
        uid: 'skip-uid',
        type: [],
        raw_content: 'non matching block',
        metadata: {
          familiarity: 0,
          next_review: null,
        },
        memory_tricks: {
          memory_technique: '',
          qa_pairs: [],
        },
        referenced_in: [
          { note_path: 'notes/topic.md', start_line: 2, end_line: 2 },
        ],
      },
    };

    const result = await vaultService.restoreDeletedCard(rootPath, snapshot, {
      mode: 'reinsert-note-boundaries',
    });

    assert.equal(result.uid, 'skip-uid');
    assert.equal(result.reinsertedInto, 0);
    assert.equal(result.alreadyPresentIn, 0);
    assert.deepEqual(result.skippedNotePaths, ['notes/topic.md']);

    const restoredNote = await fs.readFile(notePath, 'utf8');
    assert.equal(restoredNote, ['alpha', 'beta', 'gamma'].join('\n'));
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('renameCard updates existing referenced note and ignores missing reference in one pass', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-rename-mixed-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');
  const notePath = path.join(rootPath, 'notes', 'exists.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  const startOld = formatCardStartBoundary('mix-src');
  const endOld = formatCardEndBoundary('mix-src');
  await fs.writeFile(notePath, ['top', startOld, 'body', endOld, 'bottom'].join('\n'), 'utf8');

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const created = await vaultService.createCard(rootPath, 'mix-src');
    const withRefs = await vaultService.saveCard(rootPath, {
      ...created,
      referenced_in: [
        { note_path: 'notes/exists.md', start_line: 2, end_line: 5 },
        { note_path: 'notes/missing.md', start_line: 1, end_line: 2 },
      ],
    });

    const renamed = await vaultService.renameCard(rootPath, 'mix-src', {
      ...withRefs,
      uid: 'mix-dst',
    });

    assert.deepEqual(renamed.updatedNotePaths, ['notes/exists.md']);

    const rewritten = await fs.readFile(notePath, 'utf8');
    const startNew = formatCardStartBoundary('mix-dst');
    const endNew = formatCardEndBoundary('mix-dst');
    assert.match(rewritten, new RegExp(startNew.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(rewritten, new RegExp(endNew.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(rewritten.includes(startOld), false);
    assert.equal(rewritten.includes(endOld), false);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('deleteCard removes boundaries from existing note and ignores missing reference in one pass', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-delete-mixed-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');
  const notePath = path.join(rootPath, 'notes', 'exists.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  const start = formatCardStartBoundary('del-mix');
  const end = formatCardEndBoundary('del-mix');
  await fs.writeFile(notePath, ['top', start, 'body', end, 'bottom'].join('\n'), 'utf8');

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const created = await vaultService.createCard(rootPath, 'del-mix');
    await vaultService.saveCard(rootPath, {
      ...created,
      referenced_in: [
        { note_path: 'notes/exists.md', start_line: 2, end_line: 5 },
        { note_path: 'notes/missing.md', start_line: 1, end_line: 2 },
      ],
    });

    const deleted = await vaultService.deleteCard(rootPath, 'del-mix', {
      removeNoteBoundaries: true,
    });

    assert.equal(deleted.removedBoundariesFrom, 1);
    assert.equal(deleted.removedBoundaryLines, 2);

    const rewritten = await fs.readFile(notePath, 'utf8');
    assert.equal(rewritten.includes(start), false);
    assert.equal(rewritten.includes(end), false);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

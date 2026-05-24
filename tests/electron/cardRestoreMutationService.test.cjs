const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { reinsertCardBoundariesForReferences } = require('../../dist-electron/services/cardRestoreMutationService.js');
const { formatCardStartBoundary, formatCardEndBoundary } = require('../../dist-electron/cardParser.js');

test('reinsertCardBoundariesForReferences reinserts boundaries into matching note content', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-restore-mutation-insert-'));
  const rootPath = path.join(tempDir, 'vault-root');
  const cardStorePath = path.join(rootPath, '.crashweaver', 'cards');
  const notePath = path.join(rootPath, 'notes', 'topic.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.mkdir(cardStorePath, { recursive: true });
  await fs.writeFile(notePath, ['top', 'Q line', 'A line', 'bottom'].join('\n'), 'utf8');

  const result = await reinsertCardBoundariesForReferences({
    rootPath,
    cardStorePath,
    uid: 'restore-ref',
    rawContent: 'Q line\nA line',
    references: [{ note_path: 'notes/topic.md', start_line: 2, end_line: 5 }],
  });

  assert.equal(result.reinsertedInto, 1);
  assert.equal(result.alreadyPresentIn, 0);
  assert.deepEqual(result.skippedNotePaths, []);

  const nextContent = await fs.readFile(notePath, 'utf8');
  assert.equal(nextContent.includes(formatCardStartBoundary('restore-ref')), true);
  assert.equal(nextContent.includes(formatCardEndBoundary('restore-ref')), true);
});

test('reinsertCardBoundariesForReferences reports skipped note when no insertion is possible', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-restore-mutation-skip-'));
  const rootPath = path.join(tempDir, 'vault-root');
  const cardStorePath = path.join(rootPath, '.crashweaver', 'cards');
  const notePath = path.join(rootPath, 'notes', 'topic.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.mkdir(cardStorePath, { recursive: true });
  await fs.writeFile(notePath, ['alpha', 'beta', 'gamma'].join('\n'), 'utf8');

  const result = await reinsertCardBoundariesForReferences({
    rootPath,
    cardStorePath,
    uid: 'restore-skip',
    rawContent: 'not present',
    references: [{ note_path: 'notes/topic.md', start_line: 2, end_line: 2 }],
  });

  assert.equal(result.reinsertedInto, 0);
  assert.equal(result.alreadyPresentIn, 0);
  assert.deepEqual(result.skippedNotePaths, ['notes/topic.md']);
});

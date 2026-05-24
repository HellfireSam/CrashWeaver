const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  renameCardBoundariesAcrossReferences,
  removeCardBoundariesAcrossReferences,
} = require('../../dist-electron/services/cardReferenceMutationService.js');
const { formatCardStartBoundary, formatCardEndBoundary } = require('../../dist-electron/cardParser.js');

test('renameCardBoundariesAcrossReferences updates existing note and skips missing notes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-ref-mutation-rename-'));
  const rootPath = path.join(tempDir, 'vault-root');
  const cardStorePath = path.join(rootPath, '.crashweaver', 'cards');
  const notePath = path.join(rootPath, 'notes', 'exists.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.mkdir(cardStorePath, { recursive: true });

  const oldStart = formatCardStartBoundary('old-ref');
  const oldEnd = formatCardEndBoundary('old-ref');
  await fs.writeFile(notePath, ['before', oldStart, 'payload', oldEnd, 'after'].join('\n'), 'utf8');

  const updated = await renameCardBoundariesAcrossReferences({
    rootPath,
    cardStorePath,
    previousUid: 'old-ref',
    nextUid: 'new-ref',
    notePaths: ['notes/exists.md', 'notes/missing.md'],
  });

  assert.deepEqual(updated, ['notes/exists.md']);

  const nextContent = await fs.readFile(notePath, 'utf8');
  const newStart = formatCardStartBoundary('new-ref');
  const newEnd = formatCardEndBoundary('new-ref');

  assert.equal(nextContent.includes(oldStart), false);
  assert.equal(nextContent.includes(oldEnd), false);
  assert.equal(nextContent.includes(newStart), true);
  assert.equal(nextContent.includes(newEnd), true);
});

test('removeCardBoundariesAcrossReferences removes boundaries for existing note and skips missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-ref-mutation-delete-'));
  const rootPath = path.join(tempDir, 'vault-root');
  const cardStorePath = path.join(rootPath, '.crashweaver', 'cards');
  const notePath = path.join(rootPath, 'notes', 'exists.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.mkdir(cardStorePath, { recursive: true });

  const start = formatCardStartBoundary('remove-ref');
  const end = formatCardEndBoundary('remove-ref');
  await fs.writeFile(notePath, ['before', start, 'payload', end, 'after'].join('\n'), 'utf8');

  const result = await removeCardBoundariesAcrossReferences({
    rootPath,
    cardStorePath,
    uid: 'remove-ref',
    references: [
      { note_path: 'notes/exists.md', start_line: 2, end_line: 5 },
      { note_path: 'notes/missing.md', start_line: 1, end_line: 2 },
    ],
  });

  assert.equal(result.removedBoundariesFrom, 1);
  assert.equal(result.removedBoundaryLines, 2);

  const nextContent = await fs.readFile(notePath, 'utf8');
  assert.equal(nextContent.includes(start), false);
  assert.equal(nextContent.includes(end), false);
});

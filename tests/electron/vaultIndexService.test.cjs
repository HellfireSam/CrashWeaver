const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { writeVaultIndex } = require('../../dist-electron/services/vaultIndexService.js');

function createReview(familiarity) {
  return {
    familiarity,
    lastReviewedAt: null,
    nextReviewAt: null,
    intervalDays: familiarity,
    repetition: familiarity,
    easeFactor: 2.5,
  };
}

test('writeVaultIndex preserves existing ids/review and sorts by filePath', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-index-'));
  const indexPath = path.join(tempDir, 'internal-index.json');
  const legacyPath = path.join(tempDir, 'legacy-index.json');

  const seeded = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: [
      {
        id: 'seed-b',
        filePath: 'b.md',
        title: 'B',
        tags: ['x'],
        updatedAt: new Date().toISOString(),
        review: createReview(9),
      },
    ],
  };

  await fs.writeFile(indexPath, `${JSON.stringify(seeded, null, 2)}\n`, 'utf8');

  const notes = [
    { filePath: 'b.md', title: 'B changed', size: 1, modifiedAt: '2026-05-23T00:00:00.000Z', tags: [], content: 'b' },
    { filePath: 'a.md', title: 'A', size: 1, modifiedAt: '2026-05-22T00:00:00.000Z', tags: ['tag'], content: 'a' },
  ];

  const index = await writeVaultIndex(indexPath, legacyPath, notes);

  assert.deepEqual(index.entries.map((entry) => entry.filePath), ['a.md', 'b.md']);
  const bEntry = index.entries.find((entry) => entry.filePath === 'b.md');
  assert.ok(bEntry);
  assert.equal(bEntry.id, 'seed-b');
  assert.equal(bEntry.review.familiarity, 9);

  const aEntry = index.entries.find((entry) => entry.filePath === 'a.md');
  assert.ok(aEntry);
  assert.equal(aEntry.review.familiarity, 0);

  const persistedRaw = await fs.readFile(indexPath, 'utf8');
  const persisted = JSON.parse(persistedRaw);
  assert.equal(persisted.entries.length, 2);
});

test('writeVaultIndex uses legacy index when internal index is missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-index-legacy-'));
  const indexPath = path.join(tempDir, 'internal-index.json');
  const legacyPath = path.join(tempDir, 'legacy-index.json');

  const legacy = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: [
      {
        id: 'legacy-id',
        filePath: 'note.md',
        title: 'Legacy note',
        tags: [],
        updatedAt: new Date().toISOString(),
        review: createReview(5),
      },
    ],
  };

  await fs.writeFile(legacyPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

  const notes = [
    {
      filePath: 'note.md',
      title: 'Updated title',
      size: 1,
      modifiedAt: '2026-05-23T01:00:00.000Z',
      tags: [],
      content: 'x',
    },
  ];

  const index = await writeVaultIndex(indexPath, legacyPath, notes);
  assert.equal(index.entries[0].id, 'legacy-id');
  assert.equal(index.entries[0].review.familiarity, 5);
});

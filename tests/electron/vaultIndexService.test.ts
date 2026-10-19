import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const { writeVaultIndex } = require('../../dist-electron/services/vaultIndexService.js');

function createReview(familiarity: number) {
  return {
    familiarity,
    lastReviewedAt: null,
    nextReviewAt: null,
    intervalDays: familiarity,
    repetition: familiarity,
    easeFactor: 2.5,
  };
}

describe('vaultIndexService', () => {
  it('writeVaultIndex preserves existing ids/review and sorts by filePath', async () => {
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
      {
        filePath: 'b.md',
        title: 'B changed',
        size: 1,
        modifiedAt: '2026-05-23T00:00:00.000Z',
        tags: [],
        content: 'b',
      },
      {
        filePath: 'a.md',
        title: 'A',
        size: 1,
        modifiedAt: '2026-05-22T00:00:00.000Z',
        tags: ['tag'],
        content: 'a',
      },
    ];

    const index = await writeVaultIndex(indexPath, legacyPath, notes);

    expect(index.entries.map((entry: { filePath: string }) => entry.filePath)).toEqual([
      'a.md',
      'b.md',
    ]);
    const bEntry = index.entries.find((entry: { filePath: string }) => entry.filePath === 'b.md');
    expect(bEntry).toBeTruthy();
    expect(bEntry.id).toBe('seed-b');
    expect(bEntry.review.familiarity).toBe(9);

    const aEntry = index.entries.find((entry: { filePath: string }) => entry.filePath === 'a.md');
    expect(aEntry).toBeTruthy();
    expect(aEntry.review.familiarity).toBe(0);

    const persistedRaw = await fs.readFile(indexPath, 'utf8');
    const persisted = JSON.parse(persistedRaw);
    expect(persisted.entries).toHaveLength(2);
  });

  it('writeVaultIndex uses legacy index when internal index is missing', async () => {
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
    expect(index.entries[0].id).toBe('legacy-id');
    expect(index.entries[0].review.familiarity).toBe(5);
  });
});

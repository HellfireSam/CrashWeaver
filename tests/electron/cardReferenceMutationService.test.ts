import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  renameCardBoundariesAcrossReferences,
  removeCardBoundariesAcrossReferences,
} = require('../../dist-electron/services/cardReferenceMutationService.js');
const {
  formatCardStartBoundary,
  formatCardEndBoundary,
} = require('../../dist-electron/cardParser.js');

describe('cardReferenceMutationService', () => {
  it('renameCardBoundariesAcrossReferences updates existing note and skips missing notes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-ref-mutation-rename-'));
    const rootPath = path.join(tempDir, 'vault-root');
    const cardStorePath = path.join(rootPath, '.crashweaver', 'cards');
    const notePath = path.join(rootPath, 'notes', 'exists.md');

    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.mkdir(cardStorePath, { recursive: true });

    const oldStart = formatCardStartBoundary('old-ref');
    const oldEnd = formatCardEndBoundary('old-ref');
    await fs.writeFile(
      notePath,
      ['before', oldStart, 'payload', oldEnd, 'after'].join('\n'),
      'utf8',
    );

    const updated = await renameCardBoundariesAcrossReferences({
      rootPath,
      cardStorePath,
      previousUid: 'old-ref',
      nextUid: 'new-ref',
      notePaths: ['notes/exists.md', 'notes/missing.md'],
    });

    expect(updated).toEqual(['notes/exists.md']);

    const nextContent = await fs.readFile(notePath, 'utf8');
    const newStart = formatCardStartBoundary('new-ref');
    const newEnd = formatCardEndBoundary('new-ref');

    expect(nextContent).not.toContain(oldStart);
    expect(nextContent).not.toContain(oldEnd);
    expect(nextContent).toContain(newStart);
    expect(nextContent).toContain(newEnd);
  });

  it('removeCardBoundariesAcrossReferences removes boundaries for existing note and skips missing', async () => {
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

    expect(result.removedBoundariesFrom).toBe(1);
    expect(result.removedBoundaryLines).toBe(2);

    const nextContent = await fs.readFile(notePath, 'utf8');
    expect(nextContent).not.toContain(start);
    expect(nextContent).not.toContain(end);
  });
});

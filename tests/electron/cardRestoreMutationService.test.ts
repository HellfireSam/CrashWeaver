import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  reinsertCardBoundariesForReferences,
} = require('../../dist-electron/services/cardRestoreMutationService.js');
const {
  formatCardStartBoundary,
  formatCardEndBoundary,
} = require('../../dist-electron/cardParser.js');

describe('cardRestoreMutationService', () => {
  it('reinsertCardBoundariesForReferences reinserts boundaries into matching note content', async () => {
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

    expect(result.reinsertedInto).toBe(1);
    expect(result.alreadyPresentIn).toBe(0);
    expect(result.skippedNotePaths).toEqual([]);

    const nextContent = await fs.readFile(notePath, 'utf8');
    expect(nextContent).toContain(formatCardStartBoundary('restore-ref'));
    expect(nextContent).toContain(formatCardEndBoundary('restore-ref'));
  });

  it('reinsertCardBoundariesForReferences reports skipped note when no insertion is possible', async () => {
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

    expect(result.reinsertedInto).toBe(0);
    expect(result.alreadyPresentIn).toBe(0);
    expect(result.skippedNotePaths).toEqual(['notes/topic.md']);
  });
});

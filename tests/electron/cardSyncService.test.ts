import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  rebuildCardStoreFromNotes,
  syncNoteToCardStore,
} = require('../../dist-electron/cardSyncService.js');

describe('cardSyncService', () => {
  const vaultRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      vaultRoots.splice(0).map((rootPath) => fs.rm(rootPath, { recursive: true, force: true })),
    );
  });

  async function setupCardStore(): Promise<string> {
    const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-card-sync-'));
    vaultRoots.push(vaultRoot);
    const cardStorePath = path.join(vaultRoot, '.crashweaver', 'cards');
    await fs.mkdir(cardStorePath, { recursive: true });
    return cardStorePath;
  }

  it('leaves a hand-dropped card file outside the UID grammar untouched', async () => {
    const cardStorePath = await setupCardStore();
    const strayCardPath = path.join(cardStorePath, 'my%card.json');
    const strayCard = {
      uid: 'my%card',
      type: [],
      raw_content: '',
      metadata: { familiarity: 0, next_review: null, interval_days: 0, ease_factor: 2.5 },
      memory_tricks: { memory_technique: '', qa_pairs: [] },
      referenced_in: [{ note_path: 'notes/graph.md', start_line: 1, end_line: 2 }],
    };
    await fs.writeFile(strayCardPath, JSON.stringify(strayCard), 'utf8');

    // The note carries no boundary for the stray card. The sync must not fail
    // on a filename it cannot address through the guarded UID-to-path builder;
    // listing tolerates such files, so the reference stays as it was.
    await expect(
      syncNoteToCardStore(cardStorePath, 'notes/graph.md', '# Graph\n\nProse without boundaries.'),
    ).resolves.toBeDefined();

    const syncedCard = JSON.parse(await fs.readFile(strayCardPath, 'utf8'));
    expect(syncedCard.referenced_in).toEqual(strayCard.referenced_in);
  });

  it('leaves a hand-dropped card file untouched when the vault index is rebuilt', async () => {
    const cardStorePath = await setupCardStore();
    const strayCardPath = path.join(cardStorePath, 'my%card.json');
    const strayCard = {
      uid: 'my%card',
      type: [],
      raw_content: '',
      metadata: { familiarity: 0, next_review: null, interval_days: 0, ease_factor: 2.5 },
      memory_tricks: { memory_technique: '', qa_pairs: [] },
      // The reference names a note that no longer exists, so a rebuild that
      // prunes stale references would try to write this card's file.
      referenced_in: [{ note_path: 'notes/gone.md', start_line: 1, end_line: 2 }],
    };
    await fs.writeFile(strayCardPath, JSON.stringify(strayCard), 'utf8');

    await expect(
      rebuildCardStoreFromNotes(cardStorePath, [
        { filePath: 'notes/graph.md', content: '# Graph\n\nProse without boundaries.' },
      ]),
    ).resolves.toBeDefined();

    const rebuiltCard = JSON.parse(await fs.readFile(strayCardPath, 'utf8'));
    expect(rebuiltCard.referenced_in).toEqual(strayCard.referenced_in);
  });
});

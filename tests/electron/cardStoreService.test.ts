import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  cardDocumentExists,
  createCardDocument,
  deleteCardDocument,
  getCardFilePath,
  readCardDocument,
  writeCardDocument,
} = require('../../dist-electron/cardStoreService.js');

describe('cardStoreService', () => {
  const vaultRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      vaultRoots.splice(0).map((rootPath) => fs.rm(rootPath, { recursive: true, force: true })),
    );
  });

  async function setupCardStore(): Promise<{ vaultRoot: string; cardStorePath: string }> {
    const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-card-store-'));
    vaultRoots.push(vaultRoot);
    const cardStorePath = path.join(vaultRoot, '.crashweaver', 'cards');
    await fs.mkdir(cardStorePath, { recursive: true });
    return { vaultRoot, cardStorePath };
  }

  // Every shape that could resolve a path outside the card store: parent
  // traversal with both separators, absolute paths, an encoded traversal, and
  // the empty/whitespace cases the validator already rejected.
  const invalidUids = ['../evil', '..\\evil', '/tmp/x', 'C:\\x', '%2e%2e', '', '   '];

  it('builds no card path for a UID the grammar rejects', async () => {
    const { cardStorePath } = await setupCardStore();

    for (const uid of invalidUids) {
      expect(() => getCardFilePath(cardStorePath, uid)).toThrow(/Card title \/ ID/);
    }
  });

  it('refuses to read a sibling file through a traversal UID', async () => {
    const { vaultRoot, cardStorePath } = await setupCardStore();
    const siblingCardPath = path.join(vaultRoot, '.crashweaver', 'evil.json');
    await fs.writeFile(siblingCardPath, JSON.stringify({ uid: 'evil' }), 'utf8');

    await expect(readCardDocument(cardStorePath, '../evil')).rejects.toThrow(/Card title \/ ID/);
    await expect(cardDocumentExists(cardStorePath, '../evil')).rejects.toThrow(/Card title \/ ID/);
  });

  it('refuses to write or delete outside the card store', async () => {
    const { vaultRoot, cardStorePath } = await setupCardStore();
    const outsideCardPath = path.join(vaultRoot, '.crashweaver', 'evil.json');
    const outsideContent = JSON.stringify({ uid: 'evil' });
    await fs.writeFile(outsideCardPath, outsideContent, 'utf8');

    const traversalCard = {
      ...createCardDocument('CW-001'),
      uid: '../evil',
    };

    await expect(writeCardDocument(cardStorePath, traversalCard)).rejects.toThrow(
      /Card title \/ ID/,
    );
    await expect(deleteCardDocument(cardStorePath, '../evil')).rejects.toThrow(/Card title \/ ID/);

    // The sibling file is untouched and the card store gained nothing.
    expect(await fs.readFile(outsideCardPath, 'utf8')).toBe(outsideContent);
    expect(await fs.readdir(cardStorePath)).toEqual([]);
  });

  it('reads, writes and deletes a valid UID through the guarded path builder', async () => {
    const { cardStorePath } = await setupCardStore();
    const card = createCardDocument('CW-001');

    expect(getCardFilePath(cardStorePath, 'CW-001')).toBe(path.join(cardStorePath, 'CW-001.json'));

    await writeCardDocument(cardStorePath, card);
    expect(await cardDocumentExists(cardStorePath, 'CW-001')).toBe(true);
    expect(await readCardDocument(cardStorePath, 'CW-001')).toEqual(card);

    expect(await deleteCardDocument(cardStorePath, 'CW-001')).toBe(true);
    expect(await cardDocumentExists(cardStorePath, 'CW-001')).toBe(false);
  });
});

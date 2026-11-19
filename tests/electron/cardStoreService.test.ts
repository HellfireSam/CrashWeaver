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
  removeCardReference,
  upsertCardReference,
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

  /** Writes a sibling file the traversal UIDs in these tests would reach. */
  async function writeSiblingCard(
    vaultRoot: string,
  ): Promise<{ outsidePath: string; content: string }> {
    const outsidePath = path.join(vaultRoot, '.crashweaver', 'evil.json');
    const content = JSON.stringify({ uid: 'evil' });
    await fs.writeFile(outsidePath, content, 'utf8');
    return { outsidePath, content };
  }

  // Every shape that could resolve a path outside the card store: parent
  // traversal with both separators, absolute paths, an encoded traversal, and
  // the empty/whitespace cases the validator rejects.
  const invalidUids = ['../evil', '..\\evil', '/tmp/x', 'C:\\x', '%2e%2e', '', '   '];

  it('builds no card path for a UID the grammar rejects', async () => {
    const { cardStorePath } = await setupCardStore();

    for (const uid of invalidUids) {
      expect(() => getCardFilePath(cardStorePath, uid)).toThrow(/Card title \/ ID/);
    }
  });

  it('rejects a traversal UID when reading a card', async () => {
    const { vaultRoot, cardStorePath } = await setupCardStore();
    await writeSiblingCard(vaultRoot);

    await expect(readCardDocument(cardStorePath, '../evil')).rejects.toThrow(/Card title \/ ID/);
  });

  it('rejects a traversal UID when checking whether a card exists', async () => {
    const { vaultRoot, cardStorePath } = await setupCardStore();
    await writeSiblingCard(vaultRoot);

    await expect(cardDocumentExists(cardStorePath, '../evil')).rejects.toThrow(/Card title \/ ID/);
  });

  it('rejects a traversal UID on write and leaves the sibling file untouched', async () => {
    const { vaultRoot, cardStorePath } = await setupCardStore();
    const sibling = await writeSiblingCard(vaultRoot);
    const traversalCard = { ...createCardDocument('CW-001'), uid: '../evil' };

    await expect(writeCardDocument(cardStorePath, traversalCard)).rejects.toThrow(
      /Card title \/ ID/,
    );
    expect(await fs.readFile(sibling.outsidePath, 'utf8')).toBe(sibling.content);
    expect(await fs.readdir(cardStorePath)).toEqual([]);
  });

  it('rejects a traversal UID on delete and leaves the sibling file untouched', async () => {
    const { vaultRoot, cardStorePath } = await setupCardStore();
    const sibling = await writeSiblingCard(vaultRoot);

    await expect(deleteCardDocument(cardStorePath, '../evil')).rejects.toThrow(/Card title \/ ID/);
    expect(await fs.readFile(sibling.outsidePath, 'utf8')).toBe(sibling.content);
  });

  it('rejects a traversal UID when upserting a card reference', async () => {
    const { cardStorePath } = await setupCardStore();

    await expect(
      upsertCardReference(cardStorePath, 'notes/graph.md', {
        uid: '../evil',
        startLine: 1,
        endLine: 2,
        blockContent: 'Prose.',
      }),
    ).rejects.toThrow(/Card title \/ ID/);
  });

  it('rejects a traversal UID when removing a card reference', async () => {
    const { cardStorePath } = await setupCardStore();

    await expect(removeCardReference(cardStorePath, '../evil', 'notes/graph.md')).rejects.toThrow(
      /Card title \/ ID/,
    );
  });

  it('reads a valid card through the guarded path builder', async () => {
    const { cardStorePath } = await setupCardStore();
    const card = createCardDocument('CW-001');

    expect(getCardFilePath(cardStorePath, 'CW-001')).toBe(path.join(cardStorePath, 'CW-001.json'));
    await writeCardDocument(cardStorePath, card);
    expect(await readCardDocument(cardStorePath, 'CW-001')).toEqual(card);
  });

  it('deletes a valid card through the guarded path builder', async () => {
    const { cardStorePath } = await setupCardStore();
    await writeCardDocument(cardStorePath, createCardDocument('CW-001'));

    expect(await deleteCardDocument(cardStorePath, 'CW-001')).toBe(true);
    expect(await cardDocumentExists(cardStorePath, 'CW-001')).toBe(false);
  });
});

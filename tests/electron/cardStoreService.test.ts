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
  findCardByFoldedUid,
  getCardFilePath,
  readCardDocument,
  removeCardReference,
  renameCardDocument,
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

  it('writes a title containing spaces to the file named for that title', async () => {
    const { cardStorePath } = await setupCardStore();
    const card = { ...createCardDocument('Three-way handshake'), raw_content: 'SYN, SYN-ACK, ACK' };

    const written = await writeCardDocument(cardStorePath, card);

    expect(written.uid).toBe('Three-way handshake');
    expect(getCardFilePath(cardStorePath, 'Three-way handshake')).toBe(
      path.join(cardStorePath, 'Three-way handshake.json'),
    );
    const onDisk = JSON.parse(
      await fs.readFile(path.join(cardStorePath, 'Three-way handshake.json'), 'utf8'),
    );
    expect(onDisk.uid).toBe('Three-way handshake');
    expect(await readCardDocument(cardStorePath, 'Three-way handshake')).toEqual(written);
  });

  it('trims a UID before naming the file and storing the body', async () => {
    const { cardStorePath } = await setupCardStore();

    const written = await writeCardDocument(cardStorePath, {
      ...createCardDocument('My Card'),
      uid: '  My Card  ',
    });

    expect(written.uid).toBe('My Card');
    expect(await fs.readdir(cardStorePath)).toEqual(['My Card.json']);
    const onDisk = JSON.parse(await fs.readFile(path.join(cardStorePath, 'My Card.json'), 'utf8'));
    expect(onDisk.uid).toBe('My Card');
  });

  it('rejects a title longer than the maximum before writing anything', async () => {
    const { cardStorePath } = await setupCardStore();
    const tooLongCard = { ...createCardDocument('CW-001'), uid: 'a'.repeat(101) };

    await expect(writeCardDocument(cardStorePath, tooLongCard)).rejects.toThrow(
      'Card title / ID must be 100 characters or fewer.',
    );
    expect(await fs.readdir(cardStorePath)).toEqual([]);
  });

  it('renames a card to a genuinely different title and removes the previous file', async () => {
    const { cardStorePath } = await setupCardStore();
    const card = createCardDocument('Three-way handshake');
    await writeCardDocument(cardStorePath, card);

    const renamed = await renameCardDocument(cardStorePath, 'Three-way handshake', {
      ...card,
      uid: 'Three-way handshake revisited',
    });

    expect(renamed.uid).toBe('Three-way handshake revisited');
    expect(await fs.readdir(cardStorePath)).toEqual(['Three-way handshake revisited.json']);
    const onDisk = JSON.parse(
      await fs.readFile(path.join(cardStorePath, 'Three-way handshake revisited.json'), 'utf8'),
    );
    expect(onDisk.uid).toBe('Three-way handshake revisited');
  });

  it('renames a card whose title differs only in case without losing it', async () => {
    const { cardStorePath } = await setupCardStore();
    const card = createCardDocument('My Card');
    await writeCardDocument(cardStorePath, card);

    const renamed = await renameCardDocument(cardStorePath, 'My Card', {
      ...card,
      uid: 'my card',
    });

    expect(renamed.uid).toBe('my card');
    // Exactly one card file, named with the new casing. On Windows this is the
    // assertion the unsafe write-then-unlink implementation fails (it deletes
    // the only file); on Linux it pins the same end state.
    expect(await fs.readdir(cardStorePath)).toEqual(['my card.json']);
    const onDisk = JSON.parse(await fs.readFile(path.join(cardStorePath, 'my card.json'), 'utf8'));
    expect(onDisk.uid).toBe('my card');
  });

  it('finds a stored card through a case-folded title and can exclude one card', async () => {
    const { cardStorePath } = await setupCardStore();
    await writeCardDocument(cardStorePath, createCardDocument('My Card'));

    expect((await findCardByFoldedUid(cardStorePath, 'my card')).uid).toBe('My Card');
    expect(await findCardByFoldedUid(cardStorePath, 'MY CARD', 'My Card')).toBeNull();
    expect(await findCardByFoldedUid(cardStorePath, 'Other Card')).toBeNull();
  });

  it('fails closed when a case-folded match cannot be read', async () => {
    const { cardStorePath } = await setupCardStore();
    await fs.writeFile(path.join(cardStorePath, 'My Card.json'), '{ not json', 'utf8');

    await expect(findCardByFoldedUid(cardStorePath, 'my card')).rejects.toThrow();
  });
});

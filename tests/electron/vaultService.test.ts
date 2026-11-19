import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const vaultService = require('../../dist-electron/vaultService.js');
const settingsService = require('../../dist-electron/settingsService.js');
const {
  formatCardEndBoundary,
  formatCardStartBoundary,
} = require('../../dist-electron/cardParser.js');

describe('vaultService', () => {
  it('renameCard ignores missing referenced notes and still renames the card', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-rename-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const created = await vaultService.createCard(rootPath, 'alpha');
      const saved = await vaultService.saveCard(rootPath, {
        ...created,
        referenced_in: [{ note_path: 'missing.md', start_line: 1, end_line: 2 }],
      });

      const renamed = await vaultService.renameCard(rootPath, 'alpha', {
        ...saved,
        uid: 'beta',
      });

      expect(renamed.previousUid).toBe('alpha');
      expect(renamed.card.uid).toBe('beta');
      expect(renamed.updatedNotePaths).toEqual([]);
      expect(renamed.updatedCrashpads).toBe(0);

      const cards = await vaultService.listCards(rootPath);
      expect(cards.some((card: { uid: string }) => card.uid === 'alpha')).toBe(false);
      expect(cards.some((card: { uid: string }) => card.uid === 'beta')).toBe(true);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('deleteCard ignores missing referenced notes when removing boundaries', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-delete-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const created = await vaultService.createCard(rootPath, 'gamma');
      await vaultService.saveCard(rootPath, {
        ...created,
        referenced_in: [{ note_path: 'missing.md', start_line: 3, end_line: 7 }],
      });

      const result = await vaultService.deleteCard(rootPath, 'gamma', {
        removeNoteBoundaries: true,
      });

      expect(result.uid).toBe('gamma');
      expect(result.removedCardFile).toBe(true);
      expect(result.removedBoundariesFrom).toBe(0);
      expect(result.removedBoundaryLines).toBe(0);

      const cards = await vaultService.listCards(rootPath);
      expect(cards.some((card: { uid: string }) => card.uid === 'gamma')).toBe(false);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('renameCard propagates uid updates into active and deleted crashpad entries', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-crashpad-rename-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const created = await vaultService.createCard(rootPath, 'rename-src');
      const crashpad = await vaultService.createVaultCrashpad(rootPath, 'daily');

      await vaultService.saveCrashpad(rootPath, {
        ...crashpad,
        cards: [{ uid: 'rename-src', origin: 'existing', addedAt: new Date().toISOString() }],
        deletedCards: [
          {
            uid: 'rename-src',
            origin: 'new',
            deletedAt: new Date().toISOString(),
            removeNoteBoundaries: true,
            card: created,
          },
        ],
      });

      const renamed = await vaultService.renameCard(rootPath, 'rename-src', {
        ...created,
        uid: 'rename-dst',
      });

      expect(renamed.updatedCrashpads).toBe(1);

      const updatedCrashpad = await vaultService.openCrashpad(rootPath, crashpad.id);
      expect(updatedCrashpad).toBeTruthy();
      expect(
        updatedCrashpad.cards.some((entry: { uid: string }) => entry.uid === 'rename-dst'),
      ).toBe(true);
      expect(
        updatedCrashpad.deletedCards.some((entry: { uid: string }) => entry.uid === 'rename-dst'),
      ).toBe(true);
      expect(
        updatedCrashpad.deletedCards.some(
          (entry: { card: { uid: string } }) => entry.card.uid === 'rename-dst',
        ),
      ).toBe(true);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('restoreDeletedCard rejects a corrupted snapshot UID instead of resolving a path outside the store', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-restore-traversal-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      // A hand-edited crashpad can carry any string in a deleted-card snapshot;
      // the restore path must fail closed rather than resolve a path outside
      // the card store.
      await expect(
        vaultService.restoreDeletedCard(
          rootPath,
          {
            uid: 'restore-uid',
            origin: 'existing',
            deletedAt: new Date().toISOString(),
            removeNoteBoundaries: false,
            card: {
              uid: '../evil',
              type: [],
              raw_content: 'Q\nA',
              metadata: { familiarity: 0, next_review: null },
              memory_tricks: { memory_technique: '', qa_pairs: [] },
              referenced_in: [],
            },
          },
          { mode: 'forget-note-references' },
        ),
      ).rejects.toThrow(/Card title \/ ID must use only letters, numbers/);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('restoreDeletedCard forget mode clears saved references and reports forgotten count', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-restore-forget-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const snapshot = {
        uid: 'restore-uid',
        origin: 'existing',
        deletedAt: new Date().toISOString(),
        removeNoteBoundaries: true,
        card: {
          uid: 'restore-uid',
          type: [],
          raw_content: 'Q\nA',
          metadata: {
            familiarity: 0,
            next_review: null,
          },
          memory_tricks: {
            memory_technique: '',
            qa_pairs: [],
          },
          referenced_in: [
            { note_path: 'missing-one.md', start_line: 1, end_line: 2 },
            { note_path: 'missing-two.md', start_line: 3, end_line: 4 },
          ],
        },
      };

      const result = await vaultService.restoreDeletedCard(rootPath, snapshot, {
        mode: 'forget-note-references',
      });

      expect(result.uid).toBe('restore-uid');
      expect(result.forgottenReferences).toBe(2);
      expect(result.reinsertedInto).toBe(0);
      expect(result.alreadyPresentIn).toBe(0);
      expect(result.skippedNotePaths).toEqual([]);

      const cards = await vaultService.listCards(rootPath);
      const restoredCard = cards.find((card: { uid: string }) => card.uid === 'restore-uid');
      expect(restoredCard).toBeTruthy();
      expect(restoredCard.referenced_in).toEqual([]);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('restoreDeletedCard reinsert mode restores boundaries into matching note content', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-restore-reinsert-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');
    const notePath = path.join(rootPath, 'notes', 'topic.md');

    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(
      notePath,
      ['top', 'Question line', 'Answer line', 'bottom'].join('\n'),
      'utf8',
    );

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const snapshot = {
        uid: 'reinsert-uid',
        origin: 'existing',
        deletedAt: new Date().toISOString(),
        removeNoteBoundaries: true,
        card: {
          uid: 'reinsert-uid',
          type: [],
          raw_content: 'Question line\nAnswer line',
          metadata: {
            familiarity: 0,
            next_review: null,
          },
          memory_tricks: {
            memory_technique: '',
            qa_pairs: [],
          },
          referenced_in: [{ note_path: 'notes/topic.md', start_line: 2, end_line: 5 }],
        },
      };

      const result = await vaultService.restoreDeletedCard(rootPath, snapshot, {
        mode: 'reinsert-note-boundaries',
      });

      expect(result.uid).toBe('reinsert-uid');
      expect(result.reinsertedInto).toBe(1);
      expect(result.alreadyPresentIn).toBe(0);
      expect(result.forgottenReferences).toBe(0);
      expect(result.skippedNotePaths).toEqual([]);

      const restoredNote = await fs.readFile(notePath, 'utf8');
      expect(restoredNote).toMatch(
        new RegExp(formatCardStartBoundary('reinsert-uid').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
      expect(restoredNote).toMatch(
        new RegExp(formatCardEndBoundary('reinsert-uid').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('restoreDeletedCard reinsert mode reports skipped note when content cannot be matched', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-restore-skipped-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');
    const notePath = path.join(rootPath, 'notes', 'topic.md');

    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(notePath, ['alpha', 'beta', 'gamma'].join('\n'), 'utf8');

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const snapshot = {
        uid: 'skip-uid',
        origin: 'existing',
        deletedAt: new Date().toISOString(),
        removeNoteBoundaries: true,
        card: {
          uid: 'skip-uid',
          type: [],
          raw_content: 'non matching block',
          metadata: {
            familiarity: 0,
            next_review: null,
          },
          memory_tricks: {
            memory_technique: '',
            qa_pairs: [],
          },
          referenced_in: [{ note_path: 'notes/topic.md', start_line: 2, end_line: 2 }],
        },
      };

      const result = await vaultService.restoreDeletedCard(rootPath, snapshot, {
        mode: 'reinsert-note-boundaries',
      });

      expect(result.uid).toBe('skip-uid');
      expect(result.reinsertedInto).toBe(0);
      expect(result.alreadyPresentIn).toBe(0);
      expect(result.skippedNotePaths).toEqual(['notes/topic.md']);

      const restoredNote = await fs.readFile(notePath, 'utf8');
      expect(restoredNote).toBe(['alpha', 'beta', 'gamma'].join('\n'));
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('renameCard updates existing referenced note and ignores missing reference in one pass', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-rename-mixed-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');
    const notePath = path.join(rootPath, 'notes', 'exists.md');

    await fs.mkdir(path.dirname(notePath), { recursive: true });
    const startOld = formatCardStartBoundary('mix-src');
    const endOld = formatCardEndBoundary('mix-src');
    await fs.writeFile(notePath, ['top', startOld, 'body', endOld, 'bottom'].join('\n'), 'utf8');

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const created = await vaultService.createCard(rootPath, 'mix-src');
      const withRefs = await vaultService.saveCard(rootPath, {
        ...created,
        referenced_in: [
          { note_path: 'notes/exists.md', start_line: 2, end_line: 5 },
          { note_path: 'notes/missing.md', start_line: 1, end_line: 2 },
        ],
      });

      const renamed = await vaultService.renameCard(rootPath, 'mix-src', {
        ...withRefs,
        uid: 'mix-dst',
      });

      expect(renamed.updatedNotePaths).toEqual(['notes/exists.md']);

      const rewritten = await fs.readFile(notePath, 'utf8');
      const startNew = formatCardStartBoundary('mix-dst');
      const endNew = formatCardEndBoundary('mix-dst');
      expect(rewritten).toMatch(new RegExp(startNew.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      expect(rewritten).toMatch(new RegExp(endNew.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      expect(rewritten).not.toContain(startOld);
      expect(rewritten).not.toContain(endOld);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('deleteCard removes boundaries from existing note and ignores missing reference in one pass', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-delete-mixed-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');
    const notePath = path.join(rootPath, 'notes', 'exists.md');

    await fs.mkdir(path.dirname(notePath), { recursive: true });
    const start = formatCardStartBoundary('del-mix');
    const end = formatCardEndBoundary('del-mix');
    await fs.writeFile(notePath, ['top', start, 'body', end, 'bottom'].join('\n'), 'utf8');

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const created = await vaultService.createCard(rootPath, 'del-mix');
      await vaultService.saveCard(rootPath, {
        ...created,
        referenced_in: [
          { note_path: 'notes/exists.md', start_line: 2, end_line: 5 },
          { note_path: 'notes/missing.md', start_line: 1, end_line: 2 },
        ],
      });

      const deleted = await vaultService.deleteCard(rootPath, 'del-mix', {
        removeNoteBoundaries: true,
      });

      expect(deleted.removedBoundariesFrom).toBe(1);
      expect(deleted.removedBoundaryLines).toBe(2);

      const rewritten = await fs.readFile(notePath, 'utf8');
      expect(rewritten).not.toContain(start);
      expect(rewritten).not.toContain(end);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  describe('card UID validation', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
      await Promise.all(
        tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })),
      );
    });

    async function setupVault() {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-uid-'));
      tempDirs.push(tempDir);
      const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
      const rootPath = path.join(tempDir, 'vault-root');
      await fs.mkdir(rootPath, { recursive: true });
      settingsService.__resetSettingsMutationQueueForTests();
      settingsService.__setSettingsFilePathForTests(settingsPath);
      return rootPath;
    }

    it('saveCard rejects a traversal UID before writing anything', async () => {
      const rootPath = await setupVault();
      const card = await vaultService.createCard(rootPath, 'CW-001');

      await expect(vaultService.saveCard(rootPath, { ...card, uid: '../evil' })).rejects.toThrow(
        /Card title \/ ID/,
      );
    });

    it('renameCard rejects a traversal previous UID', async () => {
      const rootPath = await setupVault();
      const card = await vaultService.createCard(rootPath, 'CW-001');

      await expect(
        vaultService.renameCard(rootPath, '../evil', { ...card, uid: 'CW-002' }),
      ).rejects.toThrow(/Card title \/ ID/);
    });

    it('deleteCard rejects a traversal UID', async () => {
      const rootPath = await setupVault();

      await expect(
        vaultService.deleteCard(rootPath, '../evil', { removeNoteBoundaries: false }),
      ).rejects.toThrow(/Card title \/ ID/);
    });
  });

  describe('card titles that contain spaces', () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
      await Promise.all(
        tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })),
      );
    });

    async function setupVault() {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-vault-spaced-title-'));
      tempDirs.push(tempDir);
      const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
      const rootPath = path.join(tempDir, 'vault-root');
      await fs.mkdir(rootPath, { recursive: true });
      settingsService.__resetSettingsMutationQueueForTests();
      settingsService.__setSettingsFilePathForTests(settingsPath);
      return rootPath;
    }

    function cardStoreDirectory(rootPath: string) {
      return path.join(rootPath, '.crashweaver', 'cards');
    }

    async function readCardFile(rootPath: string, uid: string) {
      return JSON.parse(
        await fs.readFile(path.join(cardStoreDirectory(rootPath), `${uid}.json`), 'utf8'),
      );
    }

    async function listCardFileNames(rootPath: string) {
      return (await fs.readdir(cardStoreDirectory(rootPath))).filter((name) =>
        name.endsWith('.json'),
      );
    }

    it('createCard writes a spaced title verbatim into the file and the body', async () => {
      const rootPath = await setupVault();

      const created = await vaultService.createCard(rootPath, '  Three-way handshake  ');

      expect(created.uid).toBe('Three-way handshake');
      expect(await listCardFileNames(rootPath)).toEqual(['Three-way handshake.json']);
      expect((await readCardFile(rootPath, 'Three-way handshake')).uid).toBe('Three-way handshake');
    });

    it('saveCard keeps a spaced title verbatim while updating the payload', async () => {
      const rootPath = await setupVault();
      const created = await vaultService.createCard(rootPath, 'Three-way handshake');

      const saved = await vaultService.saveCard(rootPath, {
        ...created,
        raw_content: 'SYN, SYN-ACK, ACK',
      });

      expect(saved.uid).toBe('Three-way handshake');
      expect(await listCardFileNames(rootPath)).toEqual(['Three-way handshake.json']);
      const onDisk = await readCardFile(rootPath, 'Three-way handshake');
      expect(onDisk.uid).toBe('Three-way handshake');
      expect(onDisk.raw_content).toBe('SYN, SYN-ACK, ACK');
    });

    it('createCard rejects a stored title regardless of letter case and echoes the stored casing', async () => {
      const rootPath = await setupVault();
      await vaultService.createCard(rootPath, 'My Card');

      await expect(vaultService.createCard(rootPath, 'my card')).rejects.toThrow(
        'Card My Card already exists.',
      );
      await expect(vaultService.createCard(rootPath, 'My Card')).rejects.toThrow(
        'Card My Card already exists.',
      );
    });

    it('createCard rejects a too-long or illegal title with the user-facing reason', async () => {
      const rootPath = await setupVault();

      await expect(vaultService.createCard(rootPath, 'a'.repeat(101))).rejects.toThrow(
        'Card title / ID must be 100 characters or fewer.',
      );
      await expect(vaultService.createCard(rootPath, 'TCP: handshake')).rejects.toThrow(
        'Card title / ID must use only letters, numbers, spaces, underscores, or dashes.',
      );
    });

    it('renameCard rejects a target title that folds to another card and echoes its stored casing', async () => {
      const rootPath = await setupVault();
      await vaultService.createCard(rootPath, 'My Card');
      const otherCard = await vaultService.createCard(rootPath, 'Other Card');

      await expect(
        vaultService.renameCard(rootPath, 'Other Card', { ...otherCard, uid: 'my card' }),
      ).rejects.toThrow('Card My Card already exists.');

      expect((await listCardFileNames(rootPath)).sort()).toEqual([
        'My Card.json',
        'Other Card.json',
      ]);
    });

    it('createCard fails closed when a case-folded card file is unreadable', async () => {
      const rootPath = await setupVault();
      const cardStorePath = cardStoreDirectory(rootPath);
      await fs.mkdir(cardStorePath, { recursive: true });
      await fs.writeFile(path.join(cardStorePath, 'My Card.json'), '{ not json', 'utf8');

      await expect(vaultService.createCard(rootPath, 'my card')).rejects.toThrow();
    });

    it('renameCard rewrites a spaced title across the note, crashpad and card file', async () => {
      const rootPath = await setupVault();
      const notePath = path.join(rootPath, 'notes', 'tcp.md');
      await fs.mkdir(path.dirname(notePath), { recursive: true });
      await fs.writeFile(
        notePath,
        [
          formatCardStartBoundary('Three-way handshake'),
          'SYN, SYN-ACK, ACK.',
          formatCardEndBoundary('Three-way handshake'),
        ].join('\n'),
        'utf8',
      );

      const created = await vaultService.createCard(rootPath, 'Three-way handshake');
      const saved = await vaultService.saveCard(rootPath, {
        ...created,
        referenced_in: [{ note_path: 'notes/tcp.md', start_line: 1, end_line: 3 }],
      });
      const crashpad = await vaultService.createVaultCrashpad(rootPath, 'daily');
      await vaultService.saveCrashpad(rootPath, {
        ...crashpad,
        cards: [
          {
            uid: 'Three-way handshake',
            origin: 'existing',
            addedAt: new Date().toISOString(),
          },
        ],
        deletedCards: [
          {
            uid: 'Three-way handshake',
            origin: 'new',
            deletedAt: new Date().toISOString(),
            removeNoteBoundaries: true,
            card: saved,
          },
        ],
      });

      const renamed = await vaultService.renameCard(rootPath, 'Three-way handshake', {
        ...saved,
        uid: 'Three-way handshake revisited',
      });

      expect(renamed.previousUid).toBe('Three-way handshake');
      expect(renamed.card.uid).toBe('Three-way handshake revisited');
      expect(renamed.updatedNotePaths).toEqual(['notes/tcp.md']);
      expect(renamed.updatedCrashpads).toBe(1);

      const noteContent = await fs.readFile(notePath, 'utf8');
      expect(noteContent).toContain(formatCardStartBoundary('Three-way handshake revisited'));
      expect(noteContent).toContain(formatCardEndBoundary('Three-way handshake revisited'));
      expect(noteContent).not.toContain(formatCardStartBoundary('Three-way handshake'));

      expect(await listCardFileNames(rootPath)).toEqual(['Three-way handshake revisited.json']);
      expect((await readCardFile(rootPath, 'Three-way handshake revisited')).uid).toBe(
        'Three-way handshake revisited',
      );

      const updatedCrashpad = await vaultService.openCrashpad(rootPath, crashpad.id);
      expect(updatedCrashpad.cards.map((entry: { uid: string }) => entry.uid)).toEqual([
        'Three-way handshake revisited',
      ]);
      expect(updatedCrashpad.deletedCards[0].uid).toBe('Three-way handshake revisited');
      expect(updatedCrashpad.deletedCards[0].card.uid).toBe('Three-way handshake revisited');
    });

    it('a case-only rename keeps one card file and moves the casing through note and crashpad', async () => {
      const rootPath = await setupVault();
      const notePath = path.join(rootPath, 'notes', 'case.md');
      await fs.mkdir(path.dirname(notePath), { recursive: true });
      await fs.writeFile(
        notePath,
        [formatCardStartBoundary('My Card'), 'Card prose.', formatCardEndBoundary('My Card')].join(
          '\n',
        ),
        'utf8',
      );

      const created = await vaultService.createCard(rootPath, 'My Card');
      const saved = await vaultService.saveCard(rootPath, {
        ...created,
        referenced_in: [{ note_path: 'notes/case.md', start_line: 1, end_line: 3 }],
      });
      const crashpad = await vaultService.createVaultCrashpad(rootPath, 'daily');
      await vaultService.saveCrashpad(rootPath, {
        ...crashpad,
        cards: [
          {
            uid: 'My Card',
            origin: 'existing',
            addedAt: new Date().toISOString(),
          },
        ],
      });

      const renamed = await vaultService.renameCard(rootPath, 'My Card', {
        ...saved,
        uid: 'my card',
      });

      expect(renamed.previousUid).toBe('My Card');
      expect(renamed.card.uid).toBe('my card');
      expect(renamed.updatedNotePaths).toEqual(['notes/case.md']);
      expect(await listCardFileNames(rootPath)).toEqual(['my card.json']);
      expect((await readCardFile(rootPath, 'my card')).uid).toBe('my card');

      const noteContent = await fs.readFile(notePath, 'utf8');
      expect(noteContent).toContain(formatCardStartBoundary('my card'));
      expect(noteContent).toContain(formatCardEndBoundary('my card'));

      const updatedCrashpad = await vaultService.openCrashpad(rootPath, crashpad.id);
      expect(updatedCrashpad.cards.map((entry: { uid: string }) => entry.uid)).toEqual(['my card']);
    });

    it('deleteCard removes a spaced title from the note boundaries and the store', async () => {
      const rootPath = await setupVault();
      const notePath = path.join(rootPath, 'notes', 'tcp.md');
      await fs.mkdir(path.dirname(notePath), { recursive: true });
      await fs.writeFile(
        notePath,
        [
          '# TCP notes',
          '',
          formatCardStartBoundary('Three-way handshake'),
          'SYN, SYN-ACK, ACK.',
          formatCardEndBoundary('Three-way handshake'),
        ].join('\n'),
        'utf8',
      );

      const created = await vaultService.createCard(rootPath, 'Three-way handshake');
      await vaultService.saveCard(rootPath, {
        ...created,
        referenced_in: [{ note_path: 'notes/tcp.md', start_line: 3, end_line: 5 }],
      });

      const deleteResult = await vaultService.deleteCard(rootPath, 'Three-way handshake', {
        removeNoteBoundaries: true,
      });

      expect(deleteResult.uid).toBe('Three-way handshake');
      expect(deleteResult.removedCardFile).toBe(true);
      expect(deleteResult.removedBoundariesFrom).toBe(1);
      expect(deleteResult.removedBoundaryLines).toBe(2);
      expect(await listCardFileNames(rootPath)).toEqual([]);
      expect(await fs.readFile(notePath, 'utf8')).not.toContain('Three-way handshake');
    });

    it('restoreDeletedCard writes a spaced title back with its note boundaries', async () => {
      const rootPath = await setupVault();
      const notePath = path.join(rootPath, 'notes', 'tcp.md');
      await fs.mkdir(path.dirname(notePath), { recursive: true });
      await fs.writeFile(notePath, ['# TCP notes', '', 'SYN, SYN-ACK, ACK.'].join('\n'), 'utf8');

      const created = await vaultService.createCard(rootPath, 'Three-way handshake');
      const saved = await vaultService.saveCard(rootPath, {
        ...created,
        raw_content: 'SYN, SYN-ACK, ACK.',
        referenced_in: [{ note_path: 'notes/tcp.md', start_line: 3, end_line: 5 }],
      });

      const restoreResult = await vaultService.restoreDeletedCard(
        rootPath,
        {
          uid: 'Three-way handshake',
          origin: 'existing',
          deletedAt: new Date().toISOString(),
          removeNoteBoundaries: true,
          card: saved,
        },
        { mode: 'reinsert-note-boundaries' },
      );

      expect(restoreResult.uid).toBe('Three-way handshake');
      expect(restoreResult.reinsertedInto).toBe(1);
      expect(await listCardFileNames(rootPath)).toEqual(['Three-way handshake.json']);
      expect((await readCardFile(rootPath, 'Three-way handshake')).uid).toBe('Three-way handshake');
      const restoredNote = await fs.readFile(notePath, 'utf8');
      expect(restoredNote).toContain(formatCardStartBoundary('Three-way handshake'));
      expect(restoredNote).toContain(formatCardEndBoundary('Three-way handshake'));
    });
  });
});

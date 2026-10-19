import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
});

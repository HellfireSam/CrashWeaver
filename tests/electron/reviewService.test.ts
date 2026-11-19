import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  previewCardReview,
  scheduleCardReview,
  __resetReviewClockForTests,
  __setReviewClockForTests,
} = require('../../dist-electron/reviewService.js');
const { readCardDocument, writeCardDocument } = require('../../dist-electron/cardStoreService.js');
const { __setSettingsFilePathForTests } = require('../../dist-electron/settingsService.js');

const REVIEW_DATE = new Date(2026, 10, 19, 12, 0, 0);

function createCard(uid: string) {
  return {
    uid,
    type: ['concept'],
    raw_content: 'A reliability pattern worth remembering.',
    metadata: {
      familiarity: 0,
      next_review: null,
      interval_days: 0,
      ease_factor: 2.5,
    },
    memory_tricks: {
      memory_technique: '',
      qa_pairs: [],
    },
    referenced_in: [{ note_path: 'notes/reliability.md', start_line: 1, end_line: 3 }],
  };
}

describe('reviewService', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    __resetReviewClockForTests();
    __setSettingsFilePathForTests(null);
    await Promise.all(
      tempRoots.splice(0).map((rootPath) => fs.rm(rootPath, { recursive: true, force: true })),
    );
  });

  async function setupVault() {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-review-'));
    tempRoots.push(rootPath);
    const cardStorePath = path.join(rootPath, '.crashweaver', 'cards');
    await fs.mkdir(cardStorePath, { recursive: true });
    __setSettingsFilePathForTests(path.join(rootPath, 'settings.json'));
    __setReviewClockForTests(() => REVIEW_DATE);
    return { rootPath, cardStorePath };
  }

  it('previews the card and the interval each response would schedule', async () => {
    const { rootPath, cardStorePath } = await setupVault();
    await writeCardDocument(cardStorePath, createCard('Review me'));

    const snapshot = await previewCardReview(rootPath, 'Review me');

    expect(snapshot.card.uid).toBe('Review me');
    expect(snapshot.intervalDaysByResponse).toEqual({ again: 0, hard: 1, good: 3, easy: 4 });
  });

  it('records a Good review on disk and returns the next preview', async () => {
    const { rootPath, cardStorePath } = await setupVault();
    await writeCardDocument(cardStorePath, createCard('Review me'));

    const snapshot = await scheduleCardReview(rootPath, 'Review me', 'good');
    const persisted = await readCardDocument(cardStorePath, 'Review me');

    expect(snapshot.card.metadata).toEqual({
      familiarity: 3,
      next_review: '2026-11-22',
      interval_days: 3,
      ease_factor: 2.5,
    });
    expect(persisted.metadata).toEqual(snapshot.card.metadata);
    expect(snapshot.intervalDaysByResponse).toEqual({ again: 0, hard: 2, good: 8, easy: 11 });
    expect(persisted.referenced_in).toEqual(createCard('Review me').referenced_in);
  });

  it('leaves an Again card due today and starts the next rating from one day', async () => {
    const { rootPath, cardStorePath } = await setupVault();
    await writeCardDocument(cardStorePath, createCard('Review me'));

    const again = await scheduleCardReview(rootPath, 'Review me', 'again');
    expect(again.card.metadata).toEqual({
      familiarity: 1,
      next_review: '2026-11-19',
      interval_days: 0,
      ease_factor: 2.3,
    });

    const good = await scheduleCardReview(rootPath, 'Review me', 'good');
    expect(good.card.metadata).toEqual({
      familiarity: 3,
      next_review: '2026-11-21',
      interval_days: 2,
      ease_factor: 2.3,
    });
  });

  it('rejects a card the store does not hold', async () => {
    const { rootPath } = await setupVault();

    await expect(scheduleCardReview(rootPath, 'Missing card', 'good')).rejects.toThrow(
      'Card Missing card was not found.',
    );
  });

  it('rejects a response outside the four the algorithm defines', async () => {
    const { rootPath, cardStorePath } = await setupVault();
    await writeCardDocument(cardStorePath, createCard('Review me'));

    await expect(scheduleCardReview(rootPath, 'Review me', 'perfect')).rejects.toThrow(
      'Unknown review response: perfect',
    );
  });
});

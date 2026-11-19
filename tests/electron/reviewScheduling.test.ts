import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  nextEaseFactor,
  nextIntervalDays,
  previewReviewIntervals,
  scheduleCardMetadata,
} = require('../../dist-electron/services/reviewScheduling.js');

const NEW_CARD = {
  familiarity: 0,
  next_review: null,
  interval_days: 0,
  ease_factor: 2.5,
};

const REVIEWED_ON = '2026-11-19';

describe('reviewScheduling', () => {
  it('Again schedules the card for today and lowers the ease', () => {
    expect(scheduleCardMetadata(NEW_CARD, 'again', REVIEWED_ON)).toEqual({
      familiarity: 1,
      next_review: REVIEWED_ON,
      interval_days: 0,
      ease_factor: 2.3,
    });
  });

  it('Hard floors a never-reviewed card at one day and lowers the ease', () => {
    expect(scheduleCardMetadata(NEW_CARD, 'hard', REVIEWED_ON)).toEqual({
      familiarity: 2,
      next_review: '2026-11-20',
      interval_days: 1,
      ease_factor: 2.3,
    });
  });

  it('Good multiplies the one-day base by the ease and keeps the ease', () => {
    expect(scheduleCardMetadata(NEW_CARD, 'good', REVIEWED_ON)).toEqual({
      familiarity: 3,
      next_review: '2026-11-22',
      interval_days: 3,
      ease_factor: 2.5,
    });
  });

  it('Easy raises the ease and applies the raised ease with the easy bonus', () => {
    expect(scheduleCardMetadata(NEW_CARD, 'easy', REVIEWED_ON)).toEqual({
      familiarity: 4,
      next_review: '2026-11-23',
      interval_days: 4,
      ease_factor: 2.7,
    });
  });

  it('a Good after an Again starts from the one-day base instead of looping today', () => {
    const afterAgain = scheduleCardMetadata(NEW_CARD, 'again', REVIEWED_ON);

    expect(scheduleCardMetadata(afterAgain, 'good', REVIEWED_ON)).toEqual({
      familiarity: 3,
      next_review: '2026-11-21',
      interval_days: 2,
      ease_factor: 2.3,
    });
  });

  it('never lets the ease fall below the 1.3 floor', () => {
    expect(nextEaseFactor(1.3, 'hard')).toBe(1.3);
    expect(nextEaseFactor(1.3, 'again')).toBe(1.3);
  });

  it('caps the interval at the maximum', () => {
    const longInterval = {
      ...NEW_CARD,
      interval_days: 30_000,
    };

    expect(nextIntervalDays(longInterval, 'good')).toBe(36_525);
  });

  it('adds the interval across a month boundary and a leap day', () => {
    const threeDays = { ...NEW_CARD, interval_days: 3, ease_factor: 2.5 };

    expect(scheduleCardMetadata(threeDays, 'good', '2026-12-30').next_review).toBe('2027-01-07');
    expect(scheduleCardMetadata(NEW_CARD, 'good', '2024-02-27').next_review).toBe('2024-03-01');
  });

  it('previews exactly the intervals the responses would schedule', () => {
    const previews = previewReviewIntervals(NEW_CARD);

    expect(previews).toEqual({ again: 0, hard: 1, good: 3, easy: 4 });
    expect(previews.good).toBe(nextIntervalDays(NEW_CARD, 'good'));
  });
});

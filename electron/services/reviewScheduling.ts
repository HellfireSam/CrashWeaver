import { addCalendarDays } from '../utils/calendarDate';
import type { CardMetadata, CardReviewResponse } from '../vault-contract';

/**
 * The scheduling constants. They are fixed in code on purpose: the algorithm
 * parameters are a product decision recorded in ADR-0004, not a setting, and a
 * vault whose reviews were scheduled under different constants could not be
 * compared with another.
 */
export const CARD_EASE_FACTOR_DEFAULT = 2.5;
export const CARD_EASE_FACTOR_MIN = 1.3;
export const CARD_FAMILIARITY_MAX = 4;

const CARD_EASE_FACTOR_STEP = 0.2;
const CARD_EASY_INTERVAL_BONUS = 1.3;
const CARD_HARD_INTERVAL_FACTOR = 0.5;
const CARD_MAX_INTERVAL_DAYS = 36_525;

const FAMILIARITY_BY_RESPONSE: Record<CardReviewResponse, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

function roundEaseFactor(easeFactor: number) {
  return Math.round(easeFactor * 100) / 100;
}

/** The stored ease after a response; only the interval uses it, Good leaves it alone. */
export function nextEaseFactor(easeFactor: number, response: CardReviewResponse): number {
  if (response === 'good') {
    return easeFactor;
  }

  const nextEaseFactor =
    response === 'easy' ? easeFactor + CARD_EASE_FACTOR_STEP : easeFactor - CARD_EASE_FACTOR_STEP;

  return roundEaseFactor(Math.max(CARD_EASE_FACTOR_MIN, nextEaseFactor));
}

/**
 * The interval the response produces, in whole days. `max(1, interval_days)` is
 * the reference plugin's base and is what keeps Again's `0` from turning the
 * next calculation into another zero interval.
 */
export function nextIntervalDays(metadata: CardMetadata, response: CardReviewResponse): number {
  const interval = Math.max(1, metadata.interval_days);

  switch (response) {
    case 'again':
      return 0;
    case 'hard':
      return Math.min(
        CARD_MAX_INTERVAL_DAYS,
        Math.max(1, Math.round(interval * CARD_HARD_INTERVAL_FACTOR)),
      );
    case 'good':
      return Math.min(
        CARD_MAX_INTERVAL_DAYS,
        Math.max(1, Math.round(interval * metadata.ease_factor)),
      );
    case 'easy':
      // Easy raises the ease before multiplying, matching the reference plugin.
      return Math.min(
        CARD_MAX_INTERVAL_DAYS,
        Math.max(
          1,
          Math.round(
            interval * nextEaseFactor(metadata.ease_factor, response) * CARD_EASY_INTERVAL_BONUS,
          ),
        ),
      );
  }
}

/**
 * The next scheduling state for one Review. Pure: the review date is passed in,
 * so the caller owns the clock and the tests do not depend on wall time.
 */
export function scheduleCardMetadata(
  metadata: CardMetadata,
  response: CardReviewResponse,
  reviewedOn: string,
): CardMetadata {
  const intervalDays = nextIntervalDays(metadata, response);

  return {
    familiarity: FAMILIARITY_BY_RESPONSE[response],
    next_review: response === 'again' ? reviewedOn : addCalendarDays(reviewedOn, intervalDays),
    interval_days: intervalDays,
    ease_factor: nextEaseFactor(metadata.ease_factor, response),
  };
}

/** What each response would do to the stored state, for the rating buttons. */
export function previewReviewIntervals(metadata: CardMetadata): Record<CardReviewResponse, number> {
  return {
    again: nextIntervalDays(metadata, 'again'),
    hard: nextIntervalDays(metadata, 'hard'),
    good: nextIntervalDays(metadata, 'good'),
    easy: nextIntervalDays(metadata, 'easy'),
  };
}

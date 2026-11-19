import { describe, expect, it } from 'vitest';
import type { CardDocument } from '../../electron/vault-contract';
import { formatIntervalDays, selectDueCards, toCalendarDate } from './reviewQueue';

function createCard(uid: string, nextReview: string | null): CardDocument {
  return {
    uid,
    type: [],
    raw_content: '',
    metadata: {
      familiarity: 0,
      next_review: nextReview,
      interval_days: 0,
      ease_factor: 2.5,
    },
    memory_tricks: {
      memory_technique: '',
      qa_pairs: [],
    },
    referenced_in: [],
  };
}

const TODAY = '2026-11-19';

describe('selectDueCards', () => {
  it('selects never-reviewed cards, today and overdue cards, not future ones', () => {
    const cards = [
      createCard('Future', '2026-11-20'),
      createCard('Today', TODAY),
      createCard('Overdue', '2026-11-10'),
      createCard('New', null),
    ];

    expect(selectDueCards(cards, TODAY).map((card) => card.uid)).toEqual([
      'New',
      'Overdue',
      'Today',
    ]);
  });

  it('orders new cards first, then oldest due date, then UID', () => {
    const cards = [
      createCard('Zebra', null),
      createCard('Alpha', null),
      createCard('Older', '2026-11-01'),
      createCard('Recent', '2026-11-18'),
    ];

    expect(selectDueCards(cards, TODAY).map((card) => card.uid)).toEqual([
      'Alpha',
      'Zebra',
      'Older',
      'Recent',
    ]);
  });

  it('returns an empty queue when nothing is due', () => {
    expect(selectDueCards([createCard('Future', '2026-11-20')], TODAY)).toEqual([]);
  });
});

describe('toCalendarDate', () => {
  it('formats the local calendar day as YYYY-MM-DD', () => {
    expect(toCalendarDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('formatIntervalDays', () => {
  it('reads the scheduled interval for the rating buttons', () => {
    expect(formatIntervalDays(0)).toBe('today');
    expect(formatIntervalDays(1)).toBe('1 day');
    expect(formatIntervalDays(3)).toBe('3 days');
  });
});

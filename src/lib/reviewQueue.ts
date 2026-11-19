import type { CardDocument, CardReviewResponse } from '../../electron/vault-contract';

/**
 * The queue the review session walks: every card the card store can address
 * whose next review is missing (never reviewed) or today-or-earlier.
 *
 * New cards come first, then the most overdue, then UID so a batch of cards
 * added together is reviewed in a stable order. The selector is pure and takes
 * `today` as an argument so it has no clock of its own.
 */
export function selectDueCards(cards: CardDocument[], today: string): CardDocument[] {
  return cards
    .filter((card) => card.metadata.next_review === null || card.metadata.next_review <= today)
    .sort(compareDueCards);
}

function compareDueCards(left: CardDocument, right: CardDocument) {
  const leftDue = left.metadata.next_review;
  const rightDue = right.metadata.next_review;

  if (leftDue === rightDue) {
    return left.uid.localeCompare(right.uid);
  }

  if (leftDue === null) {
    return -1;
  }

  if (rightDue === null) {
    return 1;
  }

  return leftDue.localeCompare(rightDue);
}

/**
 * The local calendar day, as `YYYY-MM-DD`. The main process owns the scheduling
 * clock; the renderer needs the same date only to decide what is due for the
 * session it is about to build, so this mirrors the main-process formatter
 * rather than crossing the process boundary for one string.
 */
export function toCalendarDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/** The four responses, in the order the rating buttons are shown. */
export const REVIEW_RESPONSES: CardReviewResponse[] = ['again', 'hard', 'good', 'easy'];

export const REVIEW_RESPONSE_LABELS: Record<CardReviewResponse, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

/** What a rating button says about the interval it will produce. */
export function formatIntervalDays(days: number) {
  if (days <= 0) {
    return 'today';
  }

  return days === 1 ? '1 day' : `${days} days`;
}

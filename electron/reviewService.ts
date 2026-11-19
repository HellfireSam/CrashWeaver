import { readCardDocument, writeCardDocument } from './cardStoreService';
import { getCardStoreConfig } from './settingsService';
import { previewReviewIntervals, scheduleCardMetadata } from './services/reviewScheduling';
import { toCalendarDate } from './utils/calendarDate';
import type { CardReviewResponse, CardReviewSnapshot } from './vault-contract';

/**
 * The review write path. The renderer chooses which card to review and which
 * response to record, but the scheduling state is read, computed and written
 * here: a card the vault watcher just refreshed cannot be clobbered by a stale
 * renderer copy, and the definition of "today" lives in one process.
 */

let reviewClock: () => Date = () => new Date();

/** Test seam: the review service must not depend on wall-clock time. */
export function __setReviewClockForTests(clock: () => Date) {
  reviewClock = clock;
}

export function __resetReviewClockForTests() {
  reviewClock = () => new Date();
}

function isCardReviewResponse(value: unknown): value is CardReviewResponse {
  return value === 'again' || value === 'hard' || value === 'good' || value === 'easy';
}

async function resolveCardStorePath(rootPath: string) {
  const config = await getCardStoreConfig(rootPath);
  return config.cardStorePath;
}

async function readScheduledCard(rootPath: string, uid: string) {
  const cardStorePath = await resolveCardStorePath(rootPath);
  const card = await readCardDocument(cardStorePath, uid);

  if (!card) {
    throw new Error(`Card ${uid} was not found.`);
  }

  return { cardStorePath, card };
}

/**
 * The card plus what each response would do, for the review surface's rating
 * buttons. Read-only; no scheduling state changes here.
 */
export async function previewCardReview(
  rootPath: string,
  uid: string,
): Promise<CardReviewSnapshot> {
  const { card } = await readScheduledCard(rootPath, uid);

  return {
    card,
    intervalDaysByResponse: previewReviewIntervals(card.metadata),
  };
}

/**
 * Records one Review and returns the stored card plus the next preview. "Again"
 * stores today as the next review, so abandoning the session leaves the card
 * due and re-entering picks it up again.
 */
export async function scheduleCardReview(
  rootPath: string,
  uid: string,
  response: CardReviewResponse,
): Promise<CardReviewSnapshot> {
  if (!isCardReviewResponse(response)) {
    throw new Error(`Unknown review response: ${String(response)}`);
  }

  const { cardStorePath, card } = await readScheduledCard(rootPath, uid);
  const metadata = scheduleCardMetadata(card.metadata, response, toCalendarDate(reviewClock()));
  const scheduledCard = await writeCardDocument(cardStorePath, { ...card, metadata });

  return {
    card: scheduledCard,
    intervalDaysByResponse: previewReviewIntervals(scheduledCard.metadata),
  };
}

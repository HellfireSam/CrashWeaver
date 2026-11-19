import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CardDocument, CardReviewResponse } from '../../electron/vault-contract';
import type { CardReviewSnapshot } from '../../electron/vault-contract';
import { getErrorMessage } from '../lib/errorUtils';
import { selectDueCards, toCalendarDate } from '../lib/reviewQueue';
import type { EditorDocumentKind } from '../state/EditorContext';
import type { WidgetTool } from '../state/UIContext';

type UseReviewSessionOptions = {
  vaultPath: string | null;
  allCards: CardDocument[];
  activeEditorKind: EditorDocumentKind;
  activeWidgetTool: WidgetTool;
  setAllCards: Dispatch<SetStateAction<CardDocument[]>>;
  setActiveEditorKind: Dispatch<SetStateAction<EditorDocumentKind>>;
  setActiveWidgetTool: Dispatch<SetStateAction<WidgetTool>>;
  setStatusMessage: (message: string | null) => void;
  setErrorMessage: (message: string | null) => void;
};

export type ReviewSession = {
  isActive: boolean;
  /** The card on screen; null while the session is loading or complete. */
  card: CardDocument | null;
  /** What each rating would do, from the card's stored schedule. */
  intervalDaysByResponse: CardReviewSnapshot['intervalDaysByResponse'] | null;
  isComplete: boolean;
  isLoadingCard: boolean;
  isRating: boolean;
  remainingCount: number;
  reviewedCount: number;
  startReview: () => void;
  rateReview: (response: CardReviewResponse) => Promise<void>;
  exitReview: () => void;
  finishReview: () => void;
};

function replaceCard(cards: CardDocument[], nextCard: CardDocument) {
  return cards.map((card) => (card.uid === nextCard.uid ? nextCard : card));
}

/**
 * The review session's state: the queue it walks, the card on screen, the
 * per-response previews and the counters. The hook owns no scheduling logic —
 * it asks the main process to preview and record each review — and it restores
 * the editor and widget tool the session was entered from when it ends.
 */
export function useReviewSession({
  vaultPath,
  allCards,
  activeEditorKind,
  activeWidgetTool,
  setAllCards,
  setActiveEditorKind,
  setActiveWidgetTool,
  setStatusMessage,
  setErrorMessage,
}: UseReviewSessionOptions): ReviewSession {
  const [isActive, setIsActive] = useState(false);
  const [queue, setQueue] = useState<CardDocument[]>([]);
  const [snapshot, setSnapshot] = useState<CardReviewSnapshot | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [isLoadingCard, setIsLoadingCard] = useState(false);
  const [isRating, setIsRating] = useState(false);
  const returnKindRef = useRef<EditorDocumentKind>('markdown');
  const returnWidgetToolRef = useRef<WidgetTool>('explorer');

  const resetSession = useCallback(() => {
    setIsActive(false);
    setQueue([]);
    setSnapshot(null);
    setReviewedCount(0);
    setIsLoadingCard(false);
    setIsRating(false);
  }, []);

  const startReview = useCallback(() => {
    if (!vaultPath) {
      setStatusMessage('Open a vault before starting a review.');
      return;
    }

    const dueCards = selectDueCards(allCards, toCalendarDate(new Date()));

    returnKindRef.current = activeEditorKind === 'review' ? 'markdown' : activeEditorKind;
    returnWidgetToolRef.current = activeWidgetTool === 'review' ? 'explorer' : activeWidgetTool;
    setQueue(dueCards);
    setSnapshot(null);
    setReviewedCount(0);
    setIsActive(true);
    setActiveEditorKind('review');
    setActiveWidgetTool('review');
    setErrorMessage(null);
    setStatusMessage(
      dueCards.length === 0
        ? 'No cards are due right now.'
        : `Reviewing ${dueCards.length} due ${dueCards.length === 1 ? 'card' : 'cards'}.`,
    );
  }, [
    activeEditorKind,
    activeWidgetTool,
    allCards,
    setActiveEditorKind,
    setActiveWidgetTool,
    setErrorMessage,
    setStatusMessage,
    vaultPath,
  ]);

  const exitReview = useCallback(() => {
    resetSession();
    setActiveEditorKind(returnKindRef.current);
    setActiveWidgetTool(returnWidgetToolRef.current);
    setStatusMessage('Review session closed.');
  }, [resetSession, setActiveEditorKind, setActiveWidgetTool, setStatusMessage]);

  const finishReview = useCallback(() => {
    const reviewedMessage = `Review complete: ${reviewedCount} ${
      reviewedCount === 1 ? 'card' : 'cards'
    } reviewed.`;
    resetSession();
    setActiveEditorKind(returnKindRef.current);
    setActiveWidgetTool(returnWidgetToolRef.current);
    setStatusMessage(reviewedMessage);
  }, [resetSession, reviewedCount, setActiveEditorKind, setActiveWidgetTool, setStatusMessage]);

  const rateReview = useCallback(
    async (response: CardReviewResponse) => {
      const currentCard = queue[0];

      if (!isActive || !vaultPath || !currentCard || isRating) {
        return;
      }

      setIsRating(true);

      try {
        const scheduled = await window.crashWeaver.scheduleCardReview(
          vaultPath,
          currentCard.uid,
          response,
        );
        setAllCards((cards) => replaceCard(cards, scheduled.card));
        setQueue((cards) => {
          const rest = cards.slice(1);

          // Again leaves the card due today, so it returns at the end of this
          // session instead of disappearing until tomorrow.
          return response === 'again' ? [...rest, scheduled.card] : rest;
        });
        // The requeued Again card becomes current again, so its fresh preview
        // is the scheduled card itself; any other card is loaded by the effect.
        setSnapshot(response === 'again' && queue.length === 1 ? scheduled : null);
        setReviewedCount((count) => count + 1);
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'Unable to schedule this review.'));
      } finally {
        setIsRating(false);
      }
    },
    [isActive, isRating, queue, setAllCards, setErrorMessage, vaultPath],
  );

  const currentUid = queue[0]?.uid ?? null;

  // Loading the preview can delete the card on screen (it disappeared from the
  // store between sessions), so a failed preview drops that card and lets the
  // session continue instead of blocking on it.
  useEffect(() => {
    if (!isActive || !vaultPath || !currentUid) {
      setSnapshot(null);
      setIsLoadingCard(false);
      return;
    }

    let cancelled = false;
    setSnapshot(null);
    setIsLoadingCard(true);

    window.crashWeaver
      .previewCardReview(vaultPath, currentUid)
      .then((preview) => {
        if (cancelled) {
          return;
        }

        setSnapshot(preview);
        setAllCards((cards) => replaceCard(cards, preview.card));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setErrorMessage(getErrorMessage(error, 'Unable to load the card for review.'));
        setQueue((cards) => cards.slice(1));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCard(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUid, isActive, setAllCards, setErrorMessage, vaultPath]);

  // Opening another surface or closing the vault ends the session without a
  // goodbye; the ratings already written are the only state that matters. The
  // widget tool returns to Explorer because the rail should not keep claiming
  // the review surface is the open tool.
  useEffect(() => {
    if (isActive && (activeEditorKind !== 'review' || !vaultPath)) {
      resetSession();
      setActiveWidgetTool('explorer');
    }
  }, [activeEditorKind, isActive, resetSession, setActiveWidgetTool, vaultPath]);

  const card = isActive ? (snapshot?.card ?? queue[0] ?? null) : null;

  return {
    isActive,
    card,
    intervalDaysByResponse: snapshot?.intervalDaysByResponse ?? null,
    isComplete: isActive && queue.length === 0,
    isLoadingCard,
    isRating,
    remainingCount: queue.length,
    reviewedCount,
    startReview,
    rateReview,
    exitReview,
    finishReview,
  };
}

import { useEffect, useRef, useState } from 'react';
import type { CardDetailTab, FocusWindow } from '../lib/cards';
import { moveStateKey } from '../lib/stateUtils';

export function useCardDetailState(
  storageKey: string | null,
  focusedCardUid: string | null,
  setFocusedWindow: React.Dispatch<React.SetStateAction<FocusWindow>>,
) {
  const [activeCardDetailTabs, setActiveCardDetailTabs] = useState<Record<string, CardDetailTab>>({});
  const [focusedCardElements, setFocusedCardElements] = useState<Record<string, string>>({});
  const [revealedQaAnswersByKey, setRevealedQaAnswersByKey] = useState<Record<string, Record<string, boolean>>>({});
  const [cardDetailScrollTops, setCardDetailScrollTops] = useState<Record<string, number>>({});
  const cardDetailPanelRef = useRef<HTMLElement>(null);
  const previousStateRef = useRef<{ storageKey: string | null; focusedCardUid: string | null }>({
    storageKey: null,
    focusedCardUid: null,
  });

  const activeCardDetailTab = storageKey ? activeCardDetailTabs[storageKey] ?? 'content' : 'content';
  const focusedCardElement = storageKey ? focusedCardElements[storageKey] ?? 'card.general' : 'card.general';
  const revealedQaAnswers = storageKey ? revealedQaAnswersByKey[storageKey] ?? {} : {};

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    const scrollTop = cardDetailScrollTops[storageKey] ?? 0;
    const frame = window.requestAnimationFrame(() => {
      if (cardDetailPanelRef.current && Math.abs(cardDetailPanelRef.current.scrollTop - scrollTop) > 1) {
        cardDetailPanelRef.current.scrollTop = scrollTop;
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeCardDetailTab, cardDetailScrollTops, storageKey]);

  useEffect(() => {
    const previousState = previousStateRef.current;
    const didFocusedCardChangeWithinTab = previousState.storageKey === storageKey && previousState.focusedCardUid !== focusedCardUid;
    previousStateRef.current = { storageKey, focusedCardUid };

    if (!storageKey || !didFocusedCardChangeWithinTab) {
      return;
    }

    if (cardDetailPanelRef.current) {
      cardDetailPanelRef.current.scrollTop = 0;
    }

    setCardDetailScrollTops((previous) => {
      if ((previous[storageKey] ?? 0) === 0) {
        return previous;
      }

      return {
        ...previous,
        [storageKey]: 0,
      };
    });
    setFocusedCardElements((previous) => {
      if ((previous[storageKey] ?? 'card.general') === 'card.general') {
        return previous;
      }

      return {
        ...previous,
        [storageKey]: 'card.general',
      };
    });
  }, [focusedCardUid, storageKey]);

  function setCardFocusElement(elementKey: string) {
    setFocusedWindow('card-detail');

    if (!storageKey) {
      return;
    }

    setFocusedCardElements((previous) => {
      if ((previous[storageKey] ?? 'card.general') === elementKey) {
        return previous;
      }

      return {
        ...previous,
        [storageKey]: elementKey,
      };
    });
  }

  function switchCardDetailTab(nextTab: CardDetailTab, focusElement: string) {
    if (!storageKey) {
      return;
    }

    if (nextTab !== activeCardDetailTab) {
      setCardDetailScrollTops((previous) => ({
        ...previous,
        [storageKey]: cardDetailPanelRef.current?.scrollTop ?? 0,
      }));
      setActiveCardDetailTabs((previous) => ({
        ...previous,
        [storageKey]: nextTab,
      }));
    }

    setCardFocusElement(focusElement);
  }

  function toggleQaAnswer(uid: string, index: number) {
    if (!storageKey) {
      return;
    }

    const answerKey = `${uid}:qa:${index}`;
    setRevealedQaAnswersByKey((previous) => ({
      ...previous,
      [storageKey]: {
        ...(previous[storageKey] ?? {}),
        [answerKey]: !(previous[storageKey] ?? {})[answerKey],
      },
    }));
  }

  function handleCardDetailScroll(scrollTop: number) {
    if (!storageKey) {
      return;
    }

    setCardDetailScrollTops((previous) => {
      if ((previous[storageKey] ?? 0) === scrollTop) {
        return previous;
      }

      return {
        ...previous,
        [storageKey]: scrollTop,
      };
    });
  }

  function renameStoredState(previousKey: string, nextKey: string) {
    setActiveCardDetailTabs((previous) => moveStateKey(previous, previousKey, nextKey));
    setFocusedCardElements((previous) => moveStateKey(previous, previousKey, nextKey));
    setRevealedQaAnswersByKey((previous) => moveStateKey(previous, previousKey, nextKey));
    setCardDetailScrollTops((previous) => moveStateKey(previous, previousKey, nextKey));
  }

  function resetStoredState() {
    setActiveCardDetailTabs({});
    setFocusedCardElements({});
    setRevealedQaAnswersByKey({});
    setCardDetailScrollTops({});
  }

  return {
    activeCardDetailTab,
    focusedCardElement,
    revealedQaAnswers,
    cardDetailPanelRef,
    handleCardDetailScroll,
    setCardFocusElement,
    switchCardDetailTab,
    toggleQaAnswer,
    renameStoredState,
    resetStoredState,
  };
}

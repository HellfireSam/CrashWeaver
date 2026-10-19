import type {
  CardDocument,
  CrashpadDocument,
  VaultNoteDocument,
} from '../../electron/vault-contract';
import {
  type CardScope,
  type CardViewRecord,
  sortCardViewRecords,
  toCardViewRecordFromCard,
  toCardViewRecordFromParsedCard,
} from './cards';

export interface CardProjectionInput {
  activeNote: VaultNoteDocument | null;
  allCards: CardDocument[];
  cardStorePath: string | undefined;
  selectedNotePath: string;
  activeCrashpad: CrashpadDocument | null;
  activeCardFileUid: string | null;
  cardScope: CardScope;
  isCrashpadEditor: boolean;
  isCardEditor: boolean;
}

interface CardProjection {
  visibleCards: CardViewRecord[];
  crashpadCards: CardViewRecord[];
}

/** The catalog and the Note whose Reference is preferred when projecting it. */
interface CardCatalogSource {
  allCards: CardDocument[];
  cardStorePath: string | undefined;
  selectedNotePath: string;
}

function projectNoteCards(activeNote: VaultNoteDocument | null): CardViewRecord[] {
  if (!activeNote) {
    return [];
  }

  // A projected note card can only come from an open note document, so its
  // note path is always the active note's path — never the unsaved draft path.
  return sortCardViewRecords(
    (activeNote.parsedCards ?? []).map((card) =>
      toCardViewRecordFromParsedCard(card, activeNote.filePath),
    ),
  );
}

function projectVaultCards({
  allCards,
  cardStorePath,
  selectedNotePath,
}: CardCatalogSource): CardViewRecord[] {
  return sortCardViewRecords(
    allCards.map((card) => toCardViewRecordFromCard(card, cardStorePath, selectedNotePath || null)),
  );
}

function projectCardFileCards(input: CardProjectionInput): CardViewRecord[] {
  return projectVaultCards({
    ...input,
    allCards: input.allCards.filter((card) => card.uid === input.activeCardFileUid),
  });
}

/**
 * A crashpad stores only card entries, so its cards are projected against the
 * catalog; an entry whose card is no longer in the catalog is dropped.
 */
function projectCrashpadCards({
  activeCrashpad,
  allCards,
  cardStorePath,
  selectedNotePath,
}: CardCatalogSource & { activeCrashpad: CrashpadDocument | null }): CardViewRecord[] {
  if (!activeCrashpad) {
    return [];
  }

  const cardByUid = new Map(allCards.map((card) => [card.uid, card]));

  return sortCardViewRecords(
    activeCrashpad.cards
      .map((entry) => {
        const card = cardByUid.get(entry.uid);

        if (!card) {
          return null;
        }

        return toCardViewRecordFromCard(
          card,
          cardStorePath,
          selectedNotePath || null,
          'crashpad',
          entry.origin,
        );
      })
      .filter((card): card is CardViewRecord => card !== null),
  );
}

function projectVisibleCards(
  input: CardProjectionInput,
  crashpadCards: CardViewRecord[],
): CardViewRecord[] {
  if (input.isCrashpadEditor) {
    return crashpadCards;
  }

  if (input.isCardEditor) {
    return projectCardFileCards(input);
  }

  return input.cardScope === 'current-vault'
    ? projectVaultCards(input)
    : projectNoteCards(input.activeNote);
}

/**
 * Projects the raw renderer state into the cards the active surface renders and
 * the crashpad's cards.
 *
 * This is pure on purpose: the root component owns React state and the preload
 * bridge, and this module owns the projection rules — which source feeds which
 * surface and scope, and how a crashpad's entries resolve against the catalog —
 * so those rules are testable without a renderer. The focused card and the
 * default weave card are derived from this projection by the selectors below,
 * so focus changes do not re-project or re-sort either card list.
 */
export function projectCards(input: CardProjectionInput): CardProjection {
  const crashpadCards = projectCrashpadCards(input);

  return {
    visibleCards: projectVisibleCards(input, crashpadCards),
    // The Weaver composer is fed from the crashpad on every surface, not only
    // while the crashpad editor is open, so these are always projected.
    crashpadCards,
  };
}

export function selectFocusedCard(
  visibleCards: CardViewRecord[],
  focusedCardUid: string | null,
): CardViewRecord | null {
  return visibleCards.find((card) => card.uid === focusedCardUid) ?? visibleCards[0] ?? null;
}

export function selectDefaultWeaveCardUid(
  crashpadCards: CardViewRecord[],
  focusedCardUid: string | null,
): string | null {
  if (focusedCardUid && crashpadCards.some((card) => card.uid === focusedCardUid)) {
    return focusedCardUid;
  }

  return crashpadCards[0]?.uid ?? null;
}

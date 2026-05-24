import { useCallback } from 'react';
import type {
  CardDocument,
  CardRenameResult,
  CardRestoreMode,
  CrashpadDeletePreferences,
  CrashpadDeletedCardSnapshot,
  CrashpadDocument,
} from '../../electron/vault-contract';
import type { CardViewRecord } from '../lib/cards';
import type { CrashpadDeleteRequest, CrashpadHistoryEntry } from '../lib/crashpadHistory';
import { getErrorMessage } from '../lib/errorUtils';

type UseCrashpadCardMutationActionsOptions = {
  vaultPath: string | null;
  activeCrashpad: CrashpadDocument | null;
  focusedCardUid: string | null;
  focusedCard: CardViewRecord | null;
  allCards: CardDocument[];
  crashpadDeletePreferences: CrashpadDeletePreferences;
  persistCrashpad: (nextCrashpad: CrashpadDocument) => Promise<CrashpadDocument | null>;
  refreshCardsCatalog: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listCards>>>;
  refreshInternalDirectories: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listInternalDirectories>>>;
  applyCardRenameResult: (rootPath: string, renameSummary: CardRenameResult) => Promise<Awaited<ReturnType<typeof window.crashWeaver.updateIndex>>>;
  pushCrashpadHistory: (entry: CrashpadHistoryEntry) => void;
  setFocusedCardUid: (uid: string | null) => void;
  setStatusMessage: (message: string | null) => void;
  setErrorMessage: (message: string | null) => void;
  formatCardRestoreStatus: (
    uid: string,
    removeNoteBoundaries: boolean,
    mode: CardRestoreMode,
    result: Awaited<ReturnType<typeof window.crashWeaver.restoreDeletedCard>>,
  ) => string;
};

export function useCrashpadCardMutationActions({
  vaultPath,
  activeCrashpad,
  focusedCardUid,
  focusedCard,
  allCards,
  crashpadDeletePreferences,
  persistCrashpad,
  refreshCardsCatalog,
  refreshInternalDirectories,
  applyCardRenameResult,
  pushCrashpadHistory,
  setFocusedCardUid,
  setStatusMessage,
  setErrorMessage,
  formatCardRestoreStatus,
}: UseCrashpadCardMutationActionsOptions) {
  const handleAttachExistingCardToCrashpad = useCallback(
    async (candidateUid: string) => {
      if (!vaultPath || !activeCrashpad) {
        setErrorMessage('Select or create a crashpad before opening existing cards.');
        return false;
      }

      const normalizedUid = candidateUid.trim();

      if (!normalizedUid) {
        setErrorMessage('Card title / ID is required.');
        return false;
      }

      if (activeCrashpad.cards.some((entry) => entry.uid === normalizedUid)) {
        setErrorMessage(`Card ${normalizedUid} is already in this crashpad.`);
        return false;
      }

      if (!allCards.some((card) => card.uid === normalizedUid)) {
        setErrorMessage(`Card ${normalizedUid} was not found in the current card store.`);
        return false;
      }

      const nextCrashpad: CrashpadDocument = {
        ...activeCrashpad,
        cards: [...activeCrashpad.cards, { uid: normalizedUid, origin: 'existing', addedAt: new Date().toISOString() }],
      };

      await persistCrashpad(nextCrashpad);
      pushCrashpadHistory({ kind: 'attach-existing', uid: normalizedUid });
      setFocusedCardUid(normalizedUid);
      setStatusMessage(`Opened existing card ${normalizedUid} in the crashpad.`);
      setErrorMessage(null);
      return true;
    },
    [
      activeCrashpad,
      allCards,
      persistCrashpad,
      pushCrashpadHistory,
      setErrorMessage,
      setFocusedCardUid,
      setStatusMessage,
      vaultPath,
    ],
  );

  const handleCreateCardFromCrashpad = useCallback(
    async (candidateUid: string) => {
      if (!vaultPath || !activeCrashpad) {
        setErrorMessage('Select or create a crashpad before creating cards.');
        return false;
      }

      const normalizedUid = candidateUid.trim();

      if (!normalizedUid) {
        setErrorMessage('Card title / ID is required.');
        return false;
      }

      if (activeCrashpad.cards.some((entry) => entry.uid === normalizedUid)) {
        setErrorMessage(`Card ${normalizedUid} is already present in this crashpad.`);
        return false;
      }

      try {
        await window.crashWeaver.createCard(vaultPath, normalizedUid);
        const nextCrashpad: CrashpadDocument = {
          ...activeCrashpad,
          cards: [...activeCrashpad.cards, { uid: normalizedUid, origin: 'new', addedAt: new Date().toISOString() }],
        };

        await refreshCardsCatalog(vaultPath);
        await refreshInternalDirectories(vaultPath);
        await persistCrashpad(nextCrashpad);
        pushCrashpadHistory({ kind: 'create-new', uid: normalizedUid });
        setFocusedCardUid(normalizedUid);
        setStatusMessage(`Created card ${normalizedUid} and added it to the crashpad.`);
        setErrorMessage(null);
        return true;
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'Unable to create card.'));
        return false;
      }
    },
    [
      activeCrashpad,
      persistCrashpad,
      pushCrashpadHistory,
      refreshCardsCatalog,
      refreshInternalDirectories,
      setErrorMessage,
      setFocusedCardUid,
      setStatusMessage,
      vaultPath,
    ],
  );

  const handleSaveCrashpadCard = useCallback(
    async (card: CardDocument) => {
      if (!vaultPath) {
        return;
      }

      const previousUid = focusedCard?.uid ?? focusedCardUid ?? card.uid;
      const previousCard = allCards.find((item) => item.uid === previousUid);
      let saved: CardDocument;
      let renameSummary: CardRenameResult | null = null;

      if (previousUid !== card.uid) {
        renameSummary = await window.crashWeaver.renameCard(vaultPath, previousUid, card);
        saved = renameSummary.card;
        await applyCardRenameResult(vaultPath, renameSummary);
      } else {
        saved = await window.crashWeaver.saveCard(vaultPath, card);
        await refreshCardsCatalog(vaultPath);
        setFocusedCardUid(saved.uid);
      }

      pushCrashpadHistory({ kind: 'update-card', before: previousCard ?? saved, after: saved });
      setStatusMessage(
        renameSummary
          ? `Renamed card ${renameSummary.previousUid} to ${saved.uid}. Updated ${renameSummary.updatedNotePaths.length} notes and ${renameSummary.updatedCrashpads} crashpads.`
          : `Saved card ${saved.uid}.`,
      );
      setErrorMessage(null);
    },
    [
      allCards,
      applyCardRenameResult,
      focusedCard?.uid,
      focusedCardUid,
      pushCrashpadHistory,
      refreshCardsCatalog,
      setErrorMessage,
      setFocusedCardUid,
      setStatusMessage,
      vaultPath,
    ],
  );

  const handleDeleteFocusedCrashpadCard = useCallback(
    async (request: CrashpadDeleteRequest) => {
      if (!vaultPath || !activeCrashpad || !focusedCardUid) {
        return false;
      }

      const crashpadEntry = activeCrashpad.cards.find((entry) => entry.uid === focusedCardUid);
      const existingCard = allCards.find((card) => card.uid === focusedCardUid);

      if (!crashpadEntry || !existingCard) {
        setErrorMessage('Focused card is no longer available. Refresh the card catalog and retry.');
        return false;
      }

      if (crashpadDeletePreferences.requireConfirmationForNewCards) {
        if (!request.confirmed) {
          setStatusMessage('Delete cancelled. Confirmation checkbox was not enabled.');
          return false;
        }
      }

      const removeNoteBoundaries = crashpadDeletePreferences.removeNoteBoundariesByDefault;

      const deleteResult = await window.crashWeaver.deleteCard(vaultPath, focusedCardUid, {
        removeNoteBoundaries,
      });
      await refreshCardsCatalog(vaultPath);
      await refreshInternalDirectories(vaultPath);

      const deletedAt = new Date().toISOString();
      const nextCrashpad: CrashpadDocument = {
        ...activeCrashpad,
        cards: activeCrashpad.cards.filter((entry) => entry.uid !== focusedCardUid),
        deletedCards: [
          {
            uid: focusedCardUid,
            origin: crashpadEntry.origin,
            deletedAt,
            removeNoteBoundaries,
            card: existingCard,
          },
          ...activeCrashpad.deletedCards,
        ],
      };

      await persistCrashpad(nextCrashpad);
      pushCrashpadHistory({
        kind: 'delete-card',
        card: existingCard,
        origin: crashpadEntry.origin,
        deletedAt,
        removeNoteBoundaries,
        deleteResult,
      });
      setFocusedCardUid(null);
      setStatusMessage(
        `Deleted card ${focusedCardUid}. Removed boundaries from ${deleteResult.removedBoundariesFrom} notes (${deleteResult.removedBoundaryLines} lines).`,
      );
      setErrorMessage(null);
      return true;
    },
    [
      activeCrashpad,
      allCards,
      crashpadDeletePreferences.removeNoteBoundariesByDefault,
      crashpadDeletePreferences.requireConfirmationForNewCards,
      focusedCardUid,
      persistCrashpad,
      pushCrashpadHistory,
      refreshCardsCatalog,
      refreshInternalDirectories,
      setErrorMessage,
      setFocusedCardUid,
      setStatusMessage,
      vaultPath,
    ],
  );

  const restoreCrashpadSnapshot = useCallback(
    async (snapshot: CrashpadDeletedCardSnapshot, mode: CardRestoreMode) => {
      if (!vaultPath) {
        throw new Error('Open a vault before restoring a card.');
      }

      return window.crashWeaver.restoreDeletedCard(vaultPath, snapshot, { mode });
    },
    [vaultPath],
  );

  const handleRestoreDeletedCard = useCallback(
    async (uid: string, deletedAt: string, mode: CardRestoreMode) => {
      if (!vaultPath || !activeCrashpad) {
        return;
      }

      const snapshot = activeCrashpad.deletedCards.find((item) => item.uid === uid && item.deletedAt === deletedAt);

      if (!snapshot) {
        setErrorMessage(`Could not find deletion snapshot for card ${uid}.`);
        return;
      }

      const restoreMode = snapshot.removeNoteBoundaries ? mode : 'reinsert-note-boundaries';
      const restoreResult = await restoreCrashpadSnapshot(snapshot, restoreMode);
      await refreshCardsCatalog(vaultPath);

      const nextCrashpad: CrashpadDocument = {
        ...activeCrashpad,
        cards: [...activeCrashpad.cards, { uid: snapshot.uid, origin: snapshot.origin, addedAt: new Date().toISOString() }],
        deletedCards: activeCrashpad.deletedCards.filter((item) => !(item.uid === uid && item.deletedAt === deletedAt)),
      };

      await persistCrashpad(nextCrashpad);
      setFocusedCardUid(snapshot.uid);
      setStatusMessage(formatCardRestoreStatus(uid, snapshot.removeNoteBoundaries, restoreMode, restoreResult));
      setErrorMessage(null);
    },
    [
      activeCrashpad,
      formatCardRestoreStatus,
      persistCrashpad,
      refreshCardsCatalog,
      restoreCrashpadSnapshot,
      setErrorMessage,
      setFocusedCardUid,
      setStatusMessage,
      vaultPath,
    ],
  );

  return {
    handleAttachExistingCardToCrashpad,
    handleCreateCardFromCrashpad,
    handleSaveCrashpadCard,
    handleDeleteFocusedCrashpadCard,
    restoreCrashpadSnapshot,
    handleRestoreDeletedCard,
  };
}

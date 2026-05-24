import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CardDocument, CardRenameResult, CrashpadDeletedCardSnapshot, CrashpadDocument } from '../../electron/vault-contract';
import type { CrashpadHistoryEntry } from '../lib/crashpadHistory';
import { getErrorMessage } from '../lib/errorUtils';

type UseCrashpadHistoryActionsOptions = {
  vaultPath: string | null;
  activeCrashpad: CrashpadDocument | null;
  crashpadPast: CrashpadHistoryEntry[];
  crashpadFuture: CrashpadHistoryEntry[];
  persistCrashpad: (nextCrashpad: CrashpadDocument) => Promise<CrashpadDocument | null>;
  refreshCardsCatalog: (rootPath: string) => Promise<Awaited<ReturnType<typeof window.crashWeaver.listCards>>>;
  applyCardRenameResult: (rootPath: string, renameSummary: CardRenameResult) => Promise<Awaited<ReturnType<typeof window.crashWeaver.updateIndex>>>;
  restoreCrashpadSnapshot: (
    snapshot: CrashpadDeletedCardSnapshot,
    mode: 'reinsert-note-boundaries' | 'forget-note-references',
  ) => Promise<Awaited<ReturnType<typeof window.crashWeaver.restoreDeletedCard>>>;
  setFocusedCardUid: (uid: string | null) => void;
  setCrashpadPast: Dispatch<SetStateAction<CrashpadHistoryEntry[]>>;
  setCrashpadFuture: Dispatch<SetStateAction<CrashpadHistoryEntry[]>>;
  setStatusMessage: (message: string | null) => void;
  setErrorMessage: (message: string | null) => void;
};

export function useCrashpadHistoryActions({
  vaultPath,
  activeCrashpad,
  crashpadPast,
  crashpadFuture,
  persistCrashpad,
  refreshCardsCatalog,
  applyCardRenameResult,
  restoreCrashpadSnapshot,
  setFocusedCardUid,
  setCrashpadPast,
  setCrashpadFuture,
  setStatusMessage,
  setErrorMessage,
}: UseCrashpadHistoryActionsOptions) {
  const handleUndoCrashpadAction = useCallback(async () => {
    if (!vaultPath || !activeCrashpad || !crashpadPast.length) {
      return;
    }

    const entry = crashpadPast[crashpadPast.length - 1];

    try {
      if (entry.kind === 'attach-existing') {
        await persistCrashpad({
          ...activeCrashpad,
          cards: activeCrashpad.cards.filter((card) => card.uid !== entry.uid),
        });
      } else if (entry.kind === 'create-new') {
        await window.crashWeaver.deleteCard(vaultPath, entry.uid, { removeNoteBoundaries: false });
        await refreshCardsCatalog(vaultPath);
        await persistCrashpad({
          ...activeCrashpad,
          cards: activeCrashpad.cards.filter((card) => card.uid !== entry.uid),
        });
      } else if (entry.kind === 'update-card') {
        if (entry.before.uid !== entry.after.uid) {
          const renameSummary = await window.crashWeaver.renameCard(vaultPath, entry.after.uid, entry.before);
          await applyCardRenameResult(vaultPath, renameSummary);
        } else {
          await window.crashWeaver.saveCard(vaultPath, entry.before);
          await refreshCardsCatalog(vaultPath);
          setFocusedCardUid(entry.before.uid);
        }
      } else if (entry.kind === 'delete-card') {
        const snapshot: CrashpadDeletedCardSnapshot = {
          uid: entry.card.uid,
          origin: entry.origin,
          deletedAt: entry.deletedAt,
          removeNoteBoundaries: entry.removeNoteBoundaries,
          card: entry.card,
        };

        await restoreCrashpadSnapshot(snapshot, 'reinsert-note-boundaries');
        await refreshCardsCatalog(vaultPath);
        await persistCrashpad({
          ...activeCrashpad,
          cards: [...activeCrashpad.cards, { uid: entry.card.uid, origin: entry.origin, addedAt: new Date().toISOString() }],
          deletedCards: activeCrashpad.deletedCards.filter(
            (deletedSnapshot) => !(deletedSnapshot.uid === entry.card.uid && deletedSnapshot.deletedAt === entry.deletedAt),
          ),
        });
      }

      setCrashpadPast((previous) => previous.slice(0, -1));
      setCrashpadFuture((previous) => [entry, ...previous]);
      setStatusMessage('Crashpad undo applied.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to undo crashpad action.'));
    }
  }, [
    activeCrashpad,
    applyCardRenameResult,
    crashpadPast,
    persistCrashpad,
    refreshCardsCatalog,
    restoreCrashpadSnapshot,
    setCrashpadFuture,
    setCrashpadPast,
    setErrorMessage,
    setFocusedCardUid,
    setStatusMessage,
    vaultPath,
  ]);

  const handleRedoCrashpadAction = useCallback(async () => {
    if (!vaultPath || !activeCrashpad || !crashpadFuture.length) {
      return;
    }

    const [entry, ...remainingFuture] = crashpadFuture;

    try {
      if (entry.kind === 'attach-existing') {
        await persistCrashpad({
          ...activeCrashpad,
          cards: [...activeCrashpad.cards, { uid: entry.uid, origin: 'existing', addedAt: new Date().toISOString() }],
        });
      } else if (entry.kind === 'create-new') {
        await window.crashWeaver.createCard(vaultPath, entry.uid);
        await refreshCardsCatalog(vaultPath);
        await persistCrashpad({
          ...activeCrashpad,
          cards: [...activeCrashpad.cards, { uid: entry.uid, origin: 'new', addedAt: new Date().toISOString() }],
        });
      } else if (entry.kind === 'update-card') {
        if (entry.before.uid !== entry.after.uid) {
          const renameSummary = await window.crashWeaver.renameCard(vaultPath, entry.before.uid, entry.after);
          await applyCardRenameResult(vaultPath, renameSummary);
        } else {
          await window.crashWeaver.saveCard(vaultPath, entry.after);
          await refreshCardsCatalog(vaultPath);
          setFocusedCardUid(entry.after.uid);
        }
      } else if (entry.kind === 'delete-card') {
        await window.crashWeaver.deleteCard(vaultPath, entry.card.uid, {
          removeNoteBoundaries: entry.removeNoteBoundaries,
        });
        await refreshCardsCatalog(vaultPath);
        await persistCrashpad({
          ...activeCrashpad,
          cards: activeCrashpad.cards.filter((card) => card.uid !== entry.card.uid),
          deletedCards: [
            {
              uid: entry.card.uid,
              origin: entry.origin,
              deletedAt: entry.deletedAt,
              removeNoteBoundaries: entry.removeNoteBoundaries,
              card: entry.card,
            },
            ...activeCrashpad.deletedCards,
          ],
        });
      }

      setCrashpadFuture(remainingFuture);
      setCrashpadPast((previous) => [...previous, entry]);
      setStatusMessage('Crashpad redo applied.');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to redo crashpad action.'));
    }
  }, [
    activeCrashpad,
    applyCardRenameResult,
    crashpadFuture,
    persistCrashpad,
    refreshCardsCatalog,
    setCrashpadFuture,
    setCrashpadPast,
    setErrorMessage,
    setFocusedCardUid,
    setStatusMessage,
    vaultPath,
  ]);

  return {
    handleUndoCrashpadAction,
    handleRedoCrashpadAction,
  };
}

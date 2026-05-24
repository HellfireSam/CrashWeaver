import { listCrashpads, readCrashpad, writeCrashpad } from '../crashpadService';

export async function renameCardUidAcrossCrashpads(rootPath: string, previousUid: string, nextUid: string) {
  const crashpadSummaries = await listCrashpads(rootPath);
  let updatedCrashpads = 0;

  for (const summary of crashpadSummaries) {
    const crashpad = await readCrashpad(rootPath, summary.id);

    if (!crashpad) {
      continue;
    }

    let didChange = false;
    const nextCards = crashpad.cards.map((entry) => {
      if (entry.uid !== previousUid) {
        return entry;
      }

      didChange = true;
      return {
        ...entry,
        uid: nextUid,
      };
    });

    const nextDeletedCards = crashpad.deletedCards.map((snapshot) => {
      if (snapshot.uid !== previousUid && snapshot.card.uid !== previousUid) {
        return snapshot;
      }

      didChange = true;
      return {
        ...snapshot,
        uid: nextUid,
        card: {
          ...snapshot.card,
          uid: nextUid,
        },
      };
    });

    if (!didChange) {
      continue;
    }

    await writeCrashpad(rootPath, {
      ...crashpad,
      cards: nextCards,
      deletedCards: nextDeletedCards,
    });
    updatedCrashpads += 1;
  }

  return updatedCrashpads;
}

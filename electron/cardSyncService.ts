import type {
  CardParseDiagnostic,
  CardRebuildSummary,
  CardSyncChange,
  CardSyncSummary,
  ParsedCrashCard,
  ParsedCrashCardsNote,
} from './vault-contract';
import { parseCrashCardsFromNote } from './cardParser';
import {
  cardDocumentExists,
  ensureCardStoreDirectory,
  readCardDocument,
  listCardDocuments,
  listCardsReferencingNote,
  removeCardReference,
  upsertCardReference,
  getCardFilePath,
} from './cardStoreService';

function createDiagnostic(
  line: number,
  uid: string,
  message: string,
): CardParseDiagnostic {
  return {
    code: 'mismatched-boundary-uid',
    line,
    message,
    severity: 'error',
    uid,
  };
}

function createChange(uid: string, action: CardSyncChange['action'], detail: string): CardSyncChange {
  return {
    uid,
    action,
    detail,
  };
}

function dedupeParsedCards(parsedNote: ParsedCrashCardsNote) {
  const seenUids = new Set<string>();
  const uniqueCards: ParsedCrashCard[] = [];
  const diagnostics: CardParseDiagnostic[] = [];

  for (const card of parsedNote.cards) {
    if (seenUids.has(card.uid)) {
      diagnostics.push(
        createDiagnostic(
          card.startLine,
          card.uid,
          `Card ${card.uid} appears more than once in ${parsedNote.notePath}. Stage 3 keeps one note reference per UID and skips duplicates.`,
        ),
      );
      continue;
    }

    seenUids.add(card.uid);
    uniqueCards.push(card);
  }

  return {
    uniqueCards,
    diagnostics,
  };
}

function hasBlockingDiagnostics(diagnostics: CardParseDiagnostic[]) {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function parseCrashCardsNote(notePath: string, content: string) {
  return parseCrashCardsFromNote(notePath, content);
}

export async function enrichParsedCardsWithStoreState(cardStorePath: string, cards: ParsedCrashCard[]) {
  return Promise.all(
    cards.map(async (card) => ({
      ...card,
      cardFilePath: getCardFilePath(cardStorePath, card.uid),
      cardExists: await cardDocumentExists(cardStorePath, card.uid),
      linkedCard: await readCardDocument(cardStorePath, card.uid),
    })),
  );
}

export async function syncParsedCrashCards(
  cardStorePath: string,
  parsedNote: ParsedCrashCardsNote,
): Promise<CardSyncSummary> {
  await ensureCardStoreDirectory(cardStorePath);

  const { uniqueCards, diagnostics: duplicateDiagnostics } = dedupeParsedCards(parsedNote);
  const diagnostics = [...parsedNote.diagnostics, ...duplicateDiagnostics];
  const changes: CardSyncChange[] = [];
  const existingCards = await listCardsReferencingNote(cardStorePath, parsedNote.notePath);
  const uniqueCardsByUid = new Map(uniqueCards.map((card) => [card.uid, card]));

  for (const card of uniqueCards) {
    const result = await upsertCardReference(cardStorePath, parsedNote.notePath, card);
    changes.push(
      createChange(
        card.uid,
        result.action,
        result.action === 'created'
          ? `Created ${result.cardFilePath}.`
          : result.action === 'updated'
            ? `Updated ${result.cardFilePath}.`
            : `No card-store changes were needed for ${result.cardFilePath}.`,
      ),
    );
  }

  if (!hasBlockingDiagnostics(diagnostics)) {
    for (const card of existingCards) {
      if (uniqueCardsByUid.has(card.uid)) {
        continue;
      }

      const result = await removeCardReference(cardStorePath, card.uid, parsedNote.notePath);

      if (result.removed) {
        changes.push(createChange(card.uid, 'removed-reference', `Removed ${parsedNote.notePath} from ${result.cardFilePath}.`));
      }
    }
  } else {
    for (const card of existingCards) {
      if (uniqueCardsByUid.has(card.uid)) {
        continue;
      }

      changes.push(
        createChange(
          card.uid,
          'skipped',
          `Skipped removing ${parsedNote.notePath} from ${getCardFilePath(cardStorePath, card.uid)} because the note still has parser errors.`,
        ),
      );
    }
  }

  return {
    notePath: parsedNote.notePath,
    cardStorePath,
    changes,
    diagnostics,
    syncedAt: new Date().toISOString(),
  };
}

export async function syncNoteToCardStore(cardStorePath: string, notePath: string, content: string) {
  const parsedNote = parseCrashCardsNote(notePath, content);
  const summary = await syncParsedCrashCards(cardStorePath, parsedNote);
  const cards = await enrichParsedCardsWithStoreState(cardStorePath, parsedNote.cards);

  return {
    parsedNote: {
      ...parsedNote,
      cards,
    },
    summary,
  };
}

export async function removeNoteReferencesFromCardStore(cardStorePath: string, notePath: string): Promise<CardSyncSummary> {
  await ensureCardStoreDirectory(cardStorePath);
  const existingCards = await listCardsReferencingNote(cardStorePath, notePath);
  const changes: CardSyncChange[] = [];

  for (const card of existingCards) {
    const result = await removeCardReference(cardStorePath, card.uid, notePath);

    if (result.removed) {
      changes.push(createChange(card.uid, 'removed-reference', `Removed ${notePath} from ${result.cardFilePath}.`));
    }
  }

  return {
    notePath,
    cardStorePath,
    changes,
    diagnostics: [],
    syncedAt: new Date().toISOString(),
  };
}

export async function rebuildCardStoreFromNotes(
  cardStorePath: string,
  notes: Array<{ filePath: string; content: string }>,
): Promise<{ summary: CardRebuildSummary; lastSync: CardSyncSummary | null }> {
  await ensureCardStoreDirectory(cardStorePath);

  let changedCards = 0;
  let removedReferences = 0;
  let diagnosticsCount = 0;
  let lastSync: CardSyncSummary | null = null;
  const activeNotePaths = new Set(notes.map((note) => note.filePath));

  for (const note of notes) {
    const sync = await syncNoteToCardStore(cardStorePath, note.filePath, note.content);
    lastSync = sync.summary;
    diagnosticsCount += sync.summary.diagnostics.length;
    changedCards += sync.summary.changes.filter((change) => change.action === 'created' || change.action === 'updated').length;
    removedReferences += sync.summary.changes.filter((change) => change.action === 'removed-reference').length;
  }

  const cards = await listCardDocuments(cardStorePath);

  for (const card of cards) {
    for (const reference of card.referenced_in) {
      if (activeNotePaths.has(reference.note_path)) {
        continue;
      }

      const result = await removeCardReference(cardStorePath, card.uid, reference.note_path);

      if (result.removed) {
        removedReferences += 1;
      }
    }
  }

  return {
    summary: {
      processedNotes: notes.length,
      changedCards,
      removedReferences,
      diagnostics: diagnosticsCount,
      syncedAt: new Date().toISOString(),
    },
    lastSync,
  };
}
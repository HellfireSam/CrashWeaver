import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { areCardUidsEqual, assertValidCardUid } from './cardUid';
import {
  CARD_EASE_FACTOR_DEFAULT,
  CARD_EASE_FACTOR_MIN,
  CARD_FAMILIARITY_MAX,
} from './services/reviewScheduling';
import { isCalendarDate } from './utils/calendarDate';
import { getFsErrorCode } from './utils/fsErrors';
import { writeJsonAtomically } from './utils/jsonFile';
import type {
  CardDocument,
  CardMetadata,
  CardNoteReference,
  CardQaPair,
  ParsedCrashCard,
} from './vault-contract';

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** The scheduling defaults every new card starts from. */
function createDefaultCardMetadata(): CardMetadata {
  return {
    familiarity: 0,
    next_review: null,
    interval_days: 0,
    ease_factor: CARD_EASE_FACTOR_DEFAULT,
  };
}

function normalizeFamiliarity(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(CARD_FAMILIARITY_MAX, Math.max(0, Math.round(value)));
}

function normalizeNextReview(value: unknown) {
  return typeof value === 'string' && isCalendarDate(value) ? value : null;
}

function normalizeIntervalDays(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeEaseFactor(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CARD_EASE_FACTOR_DEFAULT;
  }

  return Math.max(CARD_EASE_FACTOR_MIN, Math.round(value * 100) / 100);
}

function toCardReferences(value: unknown): CardNoteReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      note_path: typeof item.note_path === 'string' ? item.note_path : '',
      start_line:
        typeof item.start_line === 'number' ? Math.max(1, Math.trunc(item.start_line)) : 1,
      end_line: typeof item.end_line === 'number' ? Math.max(1, Math.trunc(item.end_line)) : 1,
    }))
    .filter((item) => item.note_path);
}

function toCardQaPairs(value: unknown): CardQaPair[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      q: typeof item.q === 'string' ? item.q : '',
      a: typeof item.a === 'string' ? item.a : '',
    }))
    .filter((item) => item.q || item.a);
}

function createDefaultCardDocument(uid: string, blockContent: string): CardDocument {
  return {
    uid,
    type: [],
    raw_content: blockContent.trim(),
    metadata: createDefaultCardMetadata(),
    memory_tricks: {
      memory_technique: '',
      qa_pairs: [],
    },
    referenced_in: [],
  };
}

function coerceCardDocument(uid: string, value: unknown, fallbackBlockContent = ''): CardDocument {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const metadata =
    data.metadata && typeof data.metadata === 'object'
      ? (data.metadata as Record<string, unknown>)
      : {};
  const memoryTricks =
    data.memory_tricks && typeof data.memory_tricks === 'object'
      ? (data.memory_tricks as Record<string, unknown>)
      : {};

  return {
    uid,
    type: toStringArray(data.type),
    raw_content:
      typeof data.raw_content === 'string' && data.raw_content.trim()
        ? data.raw_content
        : fallbackBlockContent.trim(),
    metadata: {
      familiarity: normalizeFamiliarity(metadata.familiarity),
      next_review: normalizeNextReview(metadata.next_review),
      interval_days: normalizeIntervalDays(metadata.interval_days),
      ease_factor: normalizeEaseFactor(metadata.ease_factor),
    },
    memory_tricks: {
      memory_technique:
        typeof memoryTricks.memory_technique === 'string' ? memoryTricks.memory_technique : '',
      qa_pairs: toCardQaPairs(memoryTricks.qa_pairs),
    },
    referenced_in: toCardReferences(data.referenced_in),
  };
}

/**
 * The single UID-to-path hop. Every UID-addressed read and write of a card file
 * goes through here, so validating the UID here means no caller can build a path
 * outside the card store — a weave plan or hand-edited crashpad naming `../evil`
 * fails closed instead of escaping. `listCardDocuments` is the deliberate
 * exception: it lists files by name and must tolerate a hand-dropped filename
 * outside the grammar, so it never builds a path from a UID. Callers must not
 * add a second path builder.
 */
export function getCardFilePath(cardStorePath: string, uid: string) {
  return path.join(cardStorePath, `${assertValidCardUid(uid)}.json`);
}

export async function ensureCardStoreDirectory(cardStorePath: string) {
  await fs.mkdir(cardStorePath, { recursive: true });
}

export async function readCardDocument(
  cardStorePath: string,
  uid: string,
): Promise<CardDocument | null> {
  try {
    const raw = await fs.readFile(getCardFilePath(cardStorePath, uid), 'utf8');
    return coerceCardDocument(uid, JSON.parse(raw));
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function cardDocumentExists(cardStorePath: string, uid: string) {
  try {
    await fs.stat(getCardFilePath(cardStorePath, uid));
    return true;
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

export async function listCardDocuments(cardStorePath: string): Promise<CardDocument[]> {
  try {
    const entries = await fs.readdir(cardStorePath, { withFileTypes: true });
    const files = entries.filter(
      (entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json',
    );

    const loadedCards = await Promise.all(
      files.map(async (entry) => {
        try {
          const uid = path.basename(entry.name, '.json');
          const raw = await fs.readFile(path.join(cardStorePath, entry.name), 'utf8');
          return coerceCardDocument(uid, JSON.parse(raw));
        } catch (error) {
          console.warn(`CrashWeaver: skipped unreadable card file ${entry.name}`, error);
          return null;
        }
      }),
    );

    return loadedCards.filter((card): card is CardDocument => card !== null);
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

export async function upsertCardReference(
  cardStorePath: string,
  notePath: string,
  parsedCard: ParsedCrashCard,
): Promise<{
  action: 'created' | 'updated' | 'unchanged';
  card: CardDocument;
  cardFilePath: string;
}> {
  await ensureCardStoreDirectory(cardStorePath);

  const existingCard = await readCardDocument(cardStorePath, parsedCard.uid);

  // Deep-clone via structuredClone (Node 17+) instead of JSON.stringify/parse round-trip.
  // structuredClone is ~3x faster and preserves field order without serialization overhead.
  const nextCard: CardDocument = existingCard
    ? structuredClone(existingCard)
    : createDefaultCardDocument(parsedCard.uid, parsedCard.blockContent);

  const nextReference: CardNoteReference = {
    note_path: notePath,
    start_line: parsedCard.startLine,
    end_line: parsedCard.endLine,
  };
  const referenceIndex = nextCard.referenced_in.findIndex((entry) => entry.note_path === notePath);

  if (referenceIndex === -1) {
    nextCard.referenced_in = [...nextCard.referenced_in, nextReference].sort((left, right) =>
      left.note_path.localeCompare(right.note_path),
    );
  } else {
    nextCard.referenced_in = nextCard.referenced_in.map((entry, index) =>
      index === referenceIndex ? nextReference : entry,
    );
  }

  if (!nextCard.raw_content.trim() && parsedCard.blockContent.trim()) {
    nextCard.raw_content = parsedCard.blockContent.trim();
  }

  // JSON.stringify for change detection is acceptable here — we're comparing
  // the full card payload to decide whether to skip the write.
  const serializedPreviously = existingCard ? JSON.stringify(existingCard) : null;
  const serializedNext = JSON.stringify(nextCard);
  const cardFilePath = getCardFilePath(cardStorePath, parsedCard.uid);

  if (serializedPreviously === serializedNext) {
    return {
      action: 'unchanged',
      card: nextCard,
      cardFilePath,
    };
  }

  await writeJsonAtomically(cardFilePath, nextCard);

  return {
    action: existingCard ? 'updated' : 'created',
    card: nextCard,
    cardFilePath,
  };
}

export async function removeCardReference(
  cardStorePath: string,
  uid: string,
  notePath: string,
): Promise<{ removed: boolean; card: CardDocument | null; cardFilePath: string }> {
  const existingCard = await readCardDocument(cardStorePath, uid);
  const cardFilePath = getCardFilePath(cardStorePath, uid);

  if (!existingCard) {
    return {
      removed: false,
      card: null,
      cardFilePath,
    };
  }

  const nextReferences = existingCard.referenced_in.filter((entry) => entry.note_path !== notePath);

  if (nextReferences.length === existingCard.referenced_in.length) {
    return {
      removed: false,
      card: existingCard,
      cardFilePath,
    };
  }

  const nextCard: CardDocument = {
    ...existingCard,
    referenced_in: nextReferences,
  };
  await writeJsonAtomically(cardFilePath, nextCard);

  return {
    removed: true,
    card: nextCard,
    cardFilePath,
  };
}

export async function listCardsReferencingNote(cardStorePath: string, notePath: string) {
  const cards = await listCardDocuments(cardStorePath);
  return cards.filter((card) => card.referenced_in.some((entry) => entry.note_path === notePath));
}

/**
 * The card whose stored title folds to `uid`, if any. Card identity is
 * case-insensitive, so this is the one duplicate check `createCard` and
 * `renameCard` share; a rename passes the card it is renaming as
 * `excludedUid`, so changing only the casing is not reported as a duplicate.
 *
 * The matching card is read through the guarded reader rather than the
 * tolerant listing: a corrupt case-folded match must fail the duplicate check
 * instead of being skipped, which would let a second case variant be created
 * silently. The echoed title is the filename's, because the filename is the
 * card's address when a hand-edited body disagrees with it.
 */
export async function findCardByFoldedUid(
  cardStorePath: string,
  uid: string,
  excludedUid?: string,
): Promise<CardDocument | null> {
  let entries;

  try {
    entries = await fs.readdir(cardStorePath, { withFileTypes: true });
  } catch (error) {
    if (getFsErrorCode(error) === 'ENOENT') {
      return null;
    }

    throw error;
  }

  const foldedMatch = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
    .map((entry) => path.basename(entry.name, '.json'))
    .find(
      (name) =>
        areCardUidsEqual(name, uid) &&
        (excludedUid === undefined || !areCardUidsEqual(name, excludedUid)),
    );

  if (foldedMatch === undefined) {
    return null;
  }

  return readCardDocument(cardStorePath, foldedMatch);
}

export function createCardDocument(uid: string): CardDocument {
  return createDefaultCardDocument(assertValidCardUid(uid), '');
}

export async function writeCardDocument(
  cardStorePath: string,
  card: CardDocument,
): Promise<CardDocument> {
  const uid = assertValidCardUid(card.uid);
  await ensureCardStoreDirectory(cardStorePath);
  const nextCard = coerceCardDocument(uid, card);
  await writeJsonAtomically(getCardFilePath(cardStorePath, uid), nextCard);
  return nextCard;
}

/**
 * Replaces the card file whose name differs from the previous one only by
 * letter case.
 *
 * This is the trap: on a case-insensitive filesystem (Windows, macOS) the old
 * and new names are the same file, so writing the new file and then unlinking
 * the old one destroys the card. The live file is moved to a unique backup
 * name, the freshly written temp file takes the new casing, and the backup is
 * removed only after the new name is in place. The temp and backup names never
 * end in `.json`, so the card listing cannot mistake a half-finished rename for
 * a card.
 */
async function replaceCardFileWithNewCasing(
  cardStorePath: string,
  previousUid: string,
  nextPath: string,
  nextCard: CardDocument,
) {
  const previousPath = getCardFilePath(cardStorePath, previousUid);
  const tempPath = path.join(cardStorePath, `.card-rename-${randomUUID()}.json.tmp`);
  const backupPath = path.join(cardStorePath, `.card-rename-${randomUUID()}.json.bak`);

  await writeJsonAtomically(tempPath, nextCard);

  try {
    await fs.rename(previousPath, backupPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  try {
    await fs.rename(tempPath, nextPath);
  } catch (error) {
    await fs.rename(backupPath, previousPath);
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  await fs.rm(backupPath, { force: true });
}

/**
 * Writes the card under its new UID and removes the previous file when the
 * title genuinely changed. A case-only rename goes through the guarded
 * replacement above; see it for why the file is never written and unlinked in
 * that order.
 */
export async function renameCardDocument(
  cardStorePath: string,
  previousUid: string,
  card: CardDocument,
): Promise<CardDocument> {
  const normalizedPreviousUid = assertValidCardUid(previousUid);
  const nextCard = coerceCardDocument(assertValidCardUid(card.uid), card);
  const normalizedNextUid = nextCard.uid;
  await ensureCardStoreDirectory(cardStorePath);

  const nextPath = getCardFilePath(cardStorePath, normalizedNextUid);

  if (normalizedPreviousUid === normalizedNextUid) {
    await writeJsonAtomically(nextPath, nextCard);
    return nextCard;
  }

  if (areCardUidsEqual(normalizedPreviousUid, normalizedNextUid)) {
    await replaceCardFileWithNewCasing(cardStorePath, normalizedPreviousUid, nextPath, nextCard);
    return nextCard;
  }

  await writeJsonAtomically(nextPath, nextCard);
  await deleteCardDocument(cardStorePath, normalizedPreviousUid);
  return nextCard;
}

export async function deleteCardDocument(cardStorePath: string, uid: string): Promise<boolean> {
  const normalizedUid = assertValidCardUid(uid);

  try {
    await fs.unlink(getCardFilePath(cardStorePath, normalizedUid));
    return true;
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

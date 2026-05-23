import fs from 'node:fs/promises';
import path from 'node:path';
import { getFsErrorCode } from './utils/fsErrors';
import { writeJsonAtomically } from './utils/jsonFile';
import type { CardDocument, CardNoteReference, CardQaPair, ParsedCrashCard } from './vault-contract';

const CARD_UID_PATTERN = /^[A-Za-z0-9_-]+$/;

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toCardReferences(value: unknown): CardNoteReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      note_path: typeof item.note_path === 'string' ? item.note_path : '',
      start_line: typeof item.start_line === 'number' ? Math.max(1, Math.trunc(item.start_line)) : 1,
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

function toLegacyFillQaPairs(value: unknown): CardQaPair[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      q: typeof item.sentence === 'string' ? item.sentence : '',
      a: toStringArray(item.answers).join('\n'),
    }))
    .filter((item) => item.q || item.a);
}

function createDefaultCardDocument(uid: string, blockContent: string): CardDocument {
  return {
    uid,
    type: [],
    raw_content: blockContent.trim(),
    metadata: {
      familiarity: 0,
      next_review: null,
    },
    memory_tricks: {
      memory_technique: '',
      qa_pairs: [],
    },
    referenced_in: [],
  };
}

function coerceCardDocument(uid: string, value: unknown, fallbackBlockContent = ''): CardDocument {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const metadata = data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {};
  const memoryTricks =
    data.memory_tricks && typeof data.memory_tricks === 'object'
      ? (data.memory_tricks as Record<string, unknown>)
      : {};

  return {
    uid,
    type: toStringArray(data.type),
    raw_content:
      typeof data.raw_content === 'string' && data.raw_content.trim() ? data.raw_content : fallbackBlockContent.trim(),
    metadata: {
      familiarity: typeof metadata.familiarity === 'number' ? metadata.familiarity : 0,
      next_review: typeof metadata.next_review === 'string' ? metadata.next_review : null,
    },
    memory_tricks: {
      memory_technique:
        typeof memoryTricks.memory_technique === 'string' ? memoryTricks.memory_technique : '',
      qa_pairs: [...toCardQaPairs(memoryTricks.qa_pairs), ...toLegacyFillQaPairs(memoryTricks.fill_in_the_blanks)],
    },
    referenced_in: toCardReferences(data.referenced_in),
  };
}

export function getCardFilePath(cardStorePath: string, uid: string) {
  return path.join(cardStorePath, `${uid}.json`);
}

export async function ensureCardStoreDirectory(cardStorePath: string) {
  await fs.mkdir(cardStorePath, { recursive: true });
}

export async function readCardDocument(cardStorePath: string, uid: string): Promise<CardDocument | null> {
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
    const files = entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json');

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
): Promise<{ action: 'created' | 'updated' | 'unchanged'; card: CardDocument; cardFilePath: string }> {
  await ensureCardStoreDirectory(cardStorePath);

  const existingCard = await readCardDocument(cardStorePath, parsedCard.uid);
  const serializedExisting = existingCard ? JSON.stringify(existingCard) : null;
  const nextCard = serializedExisting
    ? (JSON.parse(serializedExisting) as CardDocument)
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
    nextCard.referenced_in = nextCard.referenced_in.map((entry, index) => (index === referenceIndex ? nextReference : entry));
  }

  if (!nextCard.raw_content.trim() && parsedCard.blockContent.trim()) {
    nextCard.raw_content = parsedCard.blockContent.trim();
  }

  const serializedNext = JSON.stringify(nextCard);
  const cardFilePath = getCardFilePath(cardStorePath, parsedCard.uid);

  if (serializedExisting === serializedNext) {
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

export function assertValidCardUid(uid: string) {
  const normalizedUid = uid.trim();

  if (!normalizedUid) {
    throw new Error('Card title / ID is required.');
  }

  if (!CARD_UID_PATTERN.test(normalizedUid)) {
    throw new Error('Card title / ID must use only letters, numbers, underscores, or dashes.');
  }

  return normalizedUid;
}

export function createCardDocument(uid: string): CardDocument {
  return createDefaultCardDocument(assertValidCardUid(uid), '');
}

export async function writeCardDocument(cardStorePath: string, card: CardDocument): Promise<CardDocument> {
  const uid = assertValidCardUid(card.uid);
  await ensureCardStoreDirectory(cardStorePath);
  const nextCard = coerceCardDocument(uid, card);
  await writeJsonAtomically(getCardFilePath(cardStorePath, uid), nextCard);
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
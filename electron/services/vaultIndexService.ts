import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getFsErrorCode } from '../utils/fsErrors';
import { writeTextAtomically } from '../utils/jsonFile';
import type { ReviewMetadata, VaultIndex, VaultIndexEntry, VaultNoteDocument } from '../vault-contract';

const MARKDOWN_EXTENSION = '.md';

function createDefaultReviewMetadata(): ReviewMetadata {
  return {
    familiarity: 0,
    lastReviewedAt: null,
    nextReviewAt: null,
    intervalDays: 0,
    repetition: 0,
    easeFactor: 2.5,
  };
}

function createEntryId(filePath: string) {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function coerceStoredIndex(value: Partial<VaultIndex>): VaultIndex | null {
  if (!Array.isArray(value.entries)) {
    return null;
  }

  const entries = value.entries
    .filter((entry): entry is VaultIndexEntry => Boolean(entry && typeof entry.filePath === 'string'))
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : createEntryId(entry.filePath),
      filePath: entry.filePath,
      title: typeof entry.title === 'string' ? entry.title : path.basename(entry.filePath, MARKDOWN_EXTENSION),
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
      review: entry.review ?? createDefaultReviewMetadata(),
    }));

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    entries,
  };
}

async function readStoredIndexFile(filePath: string): Promise<VaultIndex | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return coerceStoredIndex(JSON.parse(raw) as Partial<VaultIndex>);
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return null;
    }

    console.warn(`CrashWeaver: failed to read vault index at ${filePath}.`, error);
    return null;
  }
}

async function readStoredIndex(indexFilePath: string, legacyIndexFilePath: string): Promise<VaultIndex | null> {
  const internalIndex = await readStoredIndexFile(indexFilePath);

  if (internalIndex) {
    return internalIndex;
  }

  return readStoredIndexFile(legacyIndexFilePath);
}

export async function readVaultIndex(indexFilePath: string, legacyIndexFilePath: string): Promise<VaultIndex | null> {
  return readStoredIndex(indexFilePath, legacyIndexFilePath);
}

function buildIndex(notes: VaultNoteDocument[], existingIndex: VaultIndex | null): VaultIndex {
  const previousEntries = new Map(existingIndex?.entries.map((entry) => [entry.filePath, entry]));
  const entries = notes
    .map((note) => {
      const previousEntry = previousEntries.get(note.filePath);

      return {
        id: previousEntry?.id ?? createEntryId(note.filePath),
        filePath: note.filePath,
        title: note.title,
        tags: note.tags,
        updatedAt: note.modifiedAt,
        review: previousEntry?.review ?? createDefaultReviewMetadata(),
      };
    })
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
  };
}

export async function writeVaultIndex(
  indexFilePath: string,
  legacyIndexFilePath: string,
  notes: VaultNoteDocument[],
): Promise<VaultIndex> {
  const existingIndex = await readStoredIndex(indexFilePath, legacyIndexFilePath);
  const index = buildIndex(notes, existingIndex);
  await fs.mkdir(path.dirname(indexFilePath), { recursive: true });
  await writeTextAtomically(indexFilePath, `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

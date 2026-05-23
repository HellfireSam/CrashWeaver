import fs from 'node:fs/promises';
import path from 'node:path';
import { getFsErrorCode } from './utils/fsErrors';
import { writeJsonAtomically } from './utils/jsonFile';
import type {
  CrashpadCardEntry,
  CrashpadDeletedCardSnapshot,
  CrashpadDocument,
  CrashpadSummary,
} from './vault-contract';

const CRASHPAD_DIRECTORY = path.join('.crashweaver', 'crashpads');

function nowIso() {
  return new Date().toISOString();
}

function normalizeCrashpadId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function toCrashpadSummary(document: CrashpadDocument): CrashpadSummary {
  return {
    id: document.id,
    name: document.name,
    filePath: document.filePath,
    updatedAt: document.updatedAt,
    activeCards: document.cards.length,
    deletedCards: document.deletedCards.length,
  };
}

function coerceCrashpadCardEntry(value: unknown): CrashpadCardEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<CrashpadCardEntry>;
  const uid = typeof entry.uid === 'string' ? entry.uid.trim() : '';

  if (!uid) {
    return null;
  }

  return {
    uid,
    origin: entry.origin === 'existing' ? 'existing' : 'new',
    addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : nowIso(),
  };
}

function coerceDeletedSnapshot(value: unknown): CrashpadDeletedCardSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<CrashpadDeletedCardSnapshot>;

  if (!snapshot.card || typeof snapshot.card !== 'object' || typeof snapshot.card.uid !== 'string') {
    return null;
  }

  const uid = typeof snapshot.uid === 'string' ? snapshot.uid.trim() : snapshot.card.uid.trim();

  if (!uid) {
    return null;
  }

  return {
    uid,
    origin: snapshot.origin === 'existing' ? 'existing' : 'new',
    deletedAt: typeof snapshot.deletedAt === 'string' ? snapshot.deletedAt : nowIso(),
    removeNoteBoundaries: snapshot.removeNoteBoundaries !== false,
    card: snapshot.card,
  };
}

function coerceCrashpadDocument(filePath: string, value: unknown): CrashpadDocument {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const fileName = path.basename(filePath, '.crashpad.json');
  const id = typeof data.id === 'string' && data.id.trim() ? normalizeCrashpadId(data.id) : normalizeCrashpadId(fileName);
  const createdAt = typeof data.createdAt === 'string' ? data.createdAt : nowIso();
  const cards = Array.isArray(data.cards)
    ? data.cards
        .map((entry) => coerceCrashpadCardEntry(entry))
        .filter((entry): entry is CrashpadCardEntry => entry !== null)
    : [];
  const deletedCards = Array.isArray(data.deletedCards)
    ? data.deletedCards
        .map((entry) => coerceDeletedSnapshot(entry))
        .filter((entry): entry is CrashpadDeletedCardSnapshot => entry !== null)
    : [];

  return {
    id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : id,
    filePath,
    createdAt,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowIso(),
    cards,
    deletedCards,
  };
}

function createCrashpadDocument(filePath: string, id: string, name: string): CrashpadDocument {
  const createdAt = nowIso();

  return {
    id,
    name: name.trim() || id,
    filePath,
    createdAt,
    updatedAt: createdAt,
    cards: [],
    deletedCards: [],
  };
}

export function getCrashpadDirectory(rootPath: string) {
  return path.join(path.resolve(rootPath), CRASHPAD_DIRECTORY);
}

function getCrashpadFilePath(rootPath: string, crashpadId: string) {
  const normalizedId = normalizeCrashpadId(crashpadId);

  if (!normalizedId) {
    throw new Error('Crashpad id is required.');
  }

  return path.join(getCrashpadDirectory(rootPath), `${normalizedId}.crashpad.json`);
}

export async function listCrashpads(rootPath: string): Promise<CrashpadSummary[]> {
  const crashpadDirectory = getCrashpadDirectory(rootPath);

  try {
    const entries = await fs.readdir(crashpadDirectory, { withFileTypes: true });
    const loaded = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.crashpad.json'))
        .map(async (entry) => {
          try {
            const filePath = path.join(crashpadDirectory, entry.name);
            const raw = await fs.readFile(filePath, 'utf8');
            return toCrashpadSummary(coerceCrashpadDocument(filePath, JSON.parse(raw)));
          } catch (error) {
            console.warn(`CrashWeaver: skipped unreadable crashpad file ${entry.name}`, error);
            return null;
          }
        }),
    );

    return loaded
      .filter((item): item is CrashpadSummary => item !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

export async function readCrashpad(rootPath: string, crashpadId: string): Promise<CrashpadDocument | null> {
  try {
    const filePath = getCrashpadFilePath(rootPath, crashpadId);
    const raw = await fs.readFile(filePath, 'utf8');
    return coerceCrashpadDocument(filePath, JSON.parse(raw));
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function createCrashpad(rootPath: string, name: string): Promise<CrashpadDocument> {
  const fallbackId = normalizeCrashpadId(name) || `crashpad-${Date.now().toString(36)}`;
  const crashpadDirectory = getCrashpadDirectory(rootPath);
  await fs.mkdir(crashpadDirectory, { recursive: true });

  let suffix = 0;

  while (true) {
    const candidateId = suffix ? `${fallbackId}-${suffix}` : fallbackId;
    const filePath = getCrashpadFilePath(rootPath, candidateId);

    try {
      await fs.stat(filePath);
      suffix += 1;
      continue;
    } catch (error) {
      const code = getFsErrorCode(error);

      if (code !== 'ENOENT') {
        throw error;
      }

      const document = createCrashpadDocument(filePath, candidateId, name || candidateId);
      await writeJsonAtomically(filePath, document);
      return document;
    }
  }
}

export async function writeCrashpad(rootPath: string, document: CrashpadDocument): Promise<CrashpadDocument> {
  const filePath = getCrashpadFilePath(rootPath, document.id);
  const nextDocument: CrashpadDocument = {
    ...document,
    id: normalizeCrashpadId(document.id),
    name: document.name.trim() || document.id,
    filePath,
    updatedAt: nowIso(),
    cards: document.cards,
    deletedCards: document.deletedCards,
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomically(filePath, nextDocument);

  return nextDocument;
}

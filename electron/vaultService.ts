import fs from 'node:fs/promises';
import path from 'node:path';
import { enrichParsedCardsWithStoreState, parseCrashCardsNote, rebuildCardStoreFromNotes, syncNoteToCardStore } from './cardSyncService';
import { renameCardUidAcrossCrashpads } from './services/crashpadCardMutationService';
import {
  removeCardBoundariesAcrossReferences,
  renameCardBoundariesAcrossReferences,
} from './services/cardReferenceMutationService';
import { reinsertCardBoundariesForReferences } from './services/cardRestoreMutationService';
import {
  dedupeNoteReferencesByPath,
} from './services/noteReferenceMutationService';
import { writeVaultIndex } from './services/vaultIndexService';
import {
  assertValidCardUid,
  createCardDocument,
  deleteCardDocument,
  listCardDocuments,
  readCardDocument,
  writeCardDocument,
} from './cardStoreService';
import { createCrashpad, listCrashpads, readCrashpad, writeCrashpad } from './crashpadService';
import {
  getCardStoreConfig,
  getCrashpadDeletePreferences,
  getImageDirectories,
  setCardStorePath as persistCardStorePath,
  setCrashpadDeletePreferences,
  setImageDirectories as persistImageDirectories,
} from './settingsService';
import { getFsErrorCode } from './utils/fsErrors';
import { writeTextAtomically } from './utils/jsonFile';
import { toPosixPath } from './utils/paths';
import type {
  CardDocument,
  CardDeleteOptions,
  CardDeleteResult,
  CardRenameResult,
  CardRestoreOptions,
  CardRestoreResult,
  CrashpadDeletePreferences,
  CrashpadDeletedCardSnapshot,
  CrashpadDocument,
  CrashpadSummary,
  CardRebuildSummary,
  CardStoreConfig,
  VaultDescriptor,
  VaultIndex,
  VaultNoteDocument,
  VaultNoteSummary,
  VaultWriteNoteInput,
  VaultWriteNoteResult,
} from './vault-contract';

const INTERNAL_DIRECTORY_NAME = '.crashweaver';
const INDEX_FILE_NAME = 'index.json';
const MARKDOWN_EXTENSION = '.md';

function getInternalDirectoryPath(rootPath: string) {
  return path.join(rootPath, INTERNAL_DIRECTORY_NAME);
}

function getIndexFilePath(rootPath: string) {
  return path.join(getInternalDirectoryPath(rootPath), INDEX_FILE_NAME);
}

function getLegacyIndexFilePath(rootPath: string) {
  return path.join(rootPath, INDEX_FILE_NAME);
}

function normalizeNotePath(filePath: string) {
  const normalized = toPosixPath(filePath).trim().replace(/^\/+/, '');

  if (!normalized) {
    throw new Error('A note path is required.');
  }

  return normalized.toLowerCase().endsWith(MARKDOWN_EXTENSION)
    ? normalized
    : `${normalized}${MARKDOWN_EXTENSION}`;
}

function extractTags(content: string) {
  const tags = new Set<string>();
  const matches = content.matchAll(/(^|\s)#([A-Za-z0-9/_-]+)/gm);

  for (const match of matches) {
    const [, , tagName] = match;

    if (tagName) {
      tags.add(tagName.toLowerCase());
    }
  }

  return [...tags].sort();
}

async function assertVaultRoot(rootPath: string) {
  const resolvedRoot = path.resolve(rootPath);

  let stats;

  try {
    stats = await fs.stat(resolvedRoot);
  } catch {
    throw new Error(`Vault path does not exist: ${rootPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${rootPath}`);
  }

  return resolvedRoot;
}

async function resolveVaultCardStoreContext(rootPath: string) {
  const resolvedRoot = await assertVaultRoot(rootPath);
  const cardStore = await getCardStoreConfig(resolvedRoot);

  return {
    resolvedRoot,
    cardStore,
  };
}

async function resolveVaultDescriptorContext(rootPath: string) {
  const resolvedRoot = await assertVaultRoot(rootPath);
  const [cardStore, imageDirectories] = await Promise.all([
    getCardStoreConfig(resolvedRoot),
    getImageDirectories(resolvedRoot),
  ]);

  return {
    resolvedRoot,
    cardStore,
    imageDirectories,
  };
}

function resolveNotePath(rootPath: string, filePath: string) {
  const normalizedPath = normalizeNotePath(filePath);
  const absolutePath = path.resolve(rootPath, normalizedPath);
  const relativePath = path.relative(rootPath, absolutePath);

  if (isOutsideRoot(relativePath)) {
    throw new Error('Note paths must stay inside the selected vault.');
  }

  return {
    absolutePath,
    relativePath: toPosixPath(relativePath),
  };
}

function isOutsideRoot(relativePath: string) {
  return relativePath.startsWith('..') || path.isAbsolute(relativePath);
}

async function collectMarkdownFiles(rootPath: string, currentDirectory = rootPath): Promise<string[]> {
  const directoryEntries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const markdownFiles: string[] = [];

  for (const entry of directoryEntries) {
    const absolutePath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === INTERNAL_DIRECTORY_NAME) {
        continue;
      }

      markdownFiles.push(...(await collectMarkdownFiles(rootPath, absolutePath)));
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === MARKDOWN_EXTENSION) {
      markdownFiles.push(absolutePath);
    }
  }

  return markdownFiles.sort((left, right) => left.localeCompare(right));
}

async function collectDirectoryPaths(rootPath: string, currentDirectory: string): Promise<string[]> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const directories = [currentDirectory];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    directories.push(...(await collectDirectoryPaths(rootPath, path.join(currentDirectory, entry.name))));
  }

  return directories
    .map((directoryPath) => toPosixPath(path.relative(rootPath, directoryPath)))
    .sort((left, right) => left.localeCompare(right));
}

async function readNoteDocument(
  rootPath: string,
  absolutePath: string,
  cardStorePath: string,
): Promise<VaultNoteDocument> {
  const [content, stats] = await Promise.all([fs.readFile(absolutePath, 'utf8'), fs.stat(absolutePath)]);
  const relativePath = toPosixPath(path.relative(rootPath, absolutePath));
  const parsedNote = parseCrashCardsNote(relativePath, content);
  const parsedCards = await enrichParsedCardsWithStoreState(cardStorePath, parsedNote.cards);

  return {
    filePath: relativePath,
    title: path.basename(relativePath, MARKDOWN_EXTENSION),
    size: Buffer.byteLength(content, 'utf8'),
    modifiedAt: stats.mtime.toISOString(),
    tags: extractTags(content),
    content,
    parsedCards,
    parseDiagnostics: parsedNote.diagnostics,
    cardSync: null,
  };
}

async function listVaultNotes(rootPath: string, cardStorePath: string) {
  const markdownFiles = await collectMarkdownFiles(rootPath);
  return Promise.all(markdownFiles.map((filePath) => readNoteDocument(rootPath, filePath, cardStorePath)));
}

function toSummary(note: VaultNoteDocument): VaultNoteSummary {
  const { content, parsedCards, parseDiagnostics, cardSync, ...summary } = note;
  return summary;
}

async function writeIndex(rootPath: string, notes: VaultNoteDocument[]) {
  const indexFilePath = getIndexFilePath(rootPath);
  const legacyIndexFilePath = getLegacyIndexFilePath(rootPath);
  return writeVaultIndex(indexFilePath, legacyIndexFilePath, notes);
}

function toDescriptor(
  rootPath: string,
  notes: VaultNoteDocument[],
  index: VaultIndex,
  cardStore: CardStoreConfig,
  imageDirectories: string[],
  lastCardSync: VaultDescriptor['lastCardSync'] = null,
  lastCardRebuild: CardRebuildSummary | null = null,
): VaultDescriptor {
  return {
    rootPath,
    indexFilePath: getIndexFilePath(rootPath),
    notes: notes.map(toSummary),
    index,
    cardStore,
    imageDirectories,
    lastCardSync,
    lastCardRebuild,
  };
}

export async function updateIndex(rootPath: string): Promise<VaultDescriptor> {
  const { resolvedRoot, cardStore, imageDirectories } = await resolveVaultDescriptorContext(rootPath);
  const notes = await listVaultNotes(resolvedRoot, cardStore.cardStorePath);
  const rebuild = await rebuildCardStoreFromNotes(
    cardStore.cardStorePath,
    notes.map((note) => ({ filePath: note.filePath, content: note.content })),
  );
  const index = await writeIndex(resolvedRoot, notes);

  return toDescriptor(resolvedRoot, notes, index, cardStore, imageDirectories, rebuild.lastSync, rebuild.summary);
}

export async function openVault(rootPath: string) {
  return updateIndex(rootPath);
}

export async function getVaultCardStore(rootPath: string) {
  const { cardStore } = await resolveVaultCardStoreContext(rootPath);
  return cardStore;
}

export async function listCards(rootPath: string): Promise<CardDocument[]> {
  const { cardStore } = await resolveVaultCardStoreContext(rootPath);
  return listCardDocuments(cardStore.cardStorePath);
}

export async function createCard(rootPath: string, uid: string): Promise<CardDocument> {
  const { cardStore } = await resolveVaultCardStoreContext(rootPath);
  const normalizedUid = assertValidCardUid(uid);

  if (await readCardDocument(cardStore.cardStorePath, normalizedUid)) {
    throw new Error(`Card ${normalizedUid} already exists.`);
  }

  return writeCardDocument(cardStore.cardStorePath, createCardDocument(normalizedUid));
}

export async function saveCard(rootPath: string, card: CardDocument): Promise<CardDocument> {
  const { cardStore } = await resolveVaultCardStoreContext(rootPath);
  return writeCardDocument(cardStore.cardStorePath, card);
}

export async function renameCard(rootPath: string, previousUid: string, card: CardDocument): Promise<CardRenameResult> {
  const { resolvedRoot, cardStore } = await resolveVaultCardStoreContext(rootPath);
  const normalizedPreviousUid = assertValidCardUid(previousUid);
  const normalizedNextUid = assertValidCardUid(card.uid);
  const existingCard = await readCardDocument(cardStore.cardStorePath, normalizedPreviousUid);

  if (!existingCard) {
    throw new Error(`Card ${normalizedPreviousUid} was not found.`);
  }

  if (normalizedPreviousUid === normalizedNextUid) {
    const savedCard = await writeCardDocument(cardStore.cardStorePath, {
      ...card,
      uid: normalizedNextUid,
    });

    return {
      previousUid: normalizedPreviousUid,
      card: savedCard,
      updatedNotePaths: [],
      updatedCrashpads: 0,
    };
  }

  if (await readCardDocument(cardStore.cardStorePath, normalizedNextUid)) {
    throw new Error(`Card ${normalizedNextUid} already exists.`);
  }

  const nextCard = await writeCardDocument(cardStore.cardStorePath, {
    ...card,
    uid: normalizedNextUid,
  });
  const referencedNotePaths = [...new Set(existingCard.referenced_in.map((reference) => reference.note_path))];
  const updatedNotePaths = await renameCardBoundariesAcrossReferences({
    rootPath: resolvedRoot,
    cardStorePath: cardStore.cardStorePath,
    previousUid: normalizedPreviousUid,
    nextUid: normalizedNextUid,
    notePaths: referencedNotePaths,
  });

  await deleteCardDocument(cardStore.cardStorePath, normalizedPreviousUid);
  const updatedCrashpads = await renameCardUidAcrossCrashpads(resolvedRoot, normalizedPreviousUid, normalizedNextUid);

  return {
    previousUid: normalizedPreviousUid,
    card: nextCard,
    updatedNotePaths,
    updatedCrashpads,
  };
}

export async function deleteCard(
  rootPath: string,
  uid: string,
  options: CardDeleteOptions,
): Promise<CardDeleteResult> {
  const { resolvedRoot, cardStore } = await resolveVaultCardStoreContext(rootPath);
  const normalizedUid = assertValidCardUid(uid);
  const existingCard = await readCardDocument(cardStore.cardStorePath, normalizedUid);
  let removedBoundariesFrom = 0;
  let removedBoundaryLines = 0;

  if (existingCard && options.removeNoteBoundaries) {
    const removalResult = await removeCardBoundariesAcrossReferences({
      rootPath: resolvedRoot,
      cardStorePath: cardStore.cardStorePath,
      uid: normalizedUid,
      references: existingCard.referenced_in,
    });
    removedBoundariesFrom = removalResult.removedBoundariesFrom;
    removedBoundaryLines = removalResult.removedBoundaryLines;
  }

  const removedCardFile = await deleteCardDocument(cardStore.cardStorePath, normalizedUid);

  return {
    uid: normalizedUid,
    removedCardFile,
    removedBoundariesFrom,
    removedBoundaryLines,
  };
}

export async function restoreDeletedCard(
  rootPath: string,
  snapshot: CrashpadDeletedCardSnapshot,
  options: CardRestoreOptions,
): Promise<CardRestoreResult> {
  const { resolvedRoot, cardStore } = await resolveVaultCardStoreContext(rootPath);
  const normalizedUid = assertValidCardUid(snapshot.card.uid);
  const normalizedSnapshotUid = assertValidCardUid(snapshot.uid);

  if (normalizedUid !== normalizedSnapshotUid) {
    throw new Error(`Restore snapshot for ${snapshot.uid} does not match card ${snapshot.card.uid}.`);
  }

  const shouldReinsertBoundaries = snapshot.removeNoteBoundaries && options.mode === 'reinsert-note-boundaries';
  const restoredCard: CardDocument = {
    ...snapshot.card,
    uid: normalizedUid,
    referenced_in: shouldReinsertBoundaries || snapshot.removeNoteBoundaries ? [] : snapshot.card.referenced_in,
  };

  await writeCardDocument(cardStore.cardStorePath, restoredCard);

  const skippedNotePaths: string[] = [];
  const uniqueReferences = dedupeNoteReferencesByPath(snapshot.card.referenced_in);
  let reinsertedInto = 0;
  let alreadyPresentIn = 0;

  if (shouldReinsertBoundaries) {
    const reinsertionResult = await reinsertCardBoundariesForReferences({
      rootPath: resolvedRoot,
      cardStorePath: cardStore.cardStorePath,
      uid: normalizedUid,
      rawContent: snapshot.card.raw_content,
      references: uniqueReferences,
    });
    reinsertedInto = reinsertionResult.reinsertedInto;
    alreadyPresentIn = reinsertionResult.alreadyPresentIn;
    skippedNotePaths.push(...reinsertionResult.skippedNotePaths);
  }

  return {
    uid: normalizedUid,
    reinsertedInto,
    alreadyPresentIn,
    forgottenReferences: snapshot.removeNoteBoundaries && options.mode === 'forget-note-references'
      ? uniqueReferences.length
      : 0,
    skippedNotePaths,
  };
}

export async function listVaultCrashpads(rootPath: string): Promise<CrashpadSummary[]> {
  const resolvedRoot = await assertVaultRoot(rootPath);
  return listCrashpads(resolvedRoot);
}

export async function listInternalDirectories(rootPath: string): Promise<string[]> {
  const resolvedRoot = await assertVaultRoot(rootPath);
  const internalRoot = getInternalDirectoryPath(resolvedRoot);

  try {
    const stats = await fs.stat(internalRoot);

    if (!stats.isDirectory()) {
      return [];
    }

    return collectDirectoryPaths(resolvedRoot, internalRoot);
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

export async function openCrashpad(rootPath: string, crashpadId: string): Promise<CrashpadDocument | null> {
  const resolvedRoot = await assertVaultRoot(rootPath);
  return readCrashpad(resolvedRoot, crashpadId);
}

export async function createVaultCrashpad(rootPath: string, name: string): Promise<CrashpadDocument> {
  const resolvedRoot = await assertVaultRoot(rootPath);
  return createCrashpad(resolvedRoot, name);
}

export async function saveCrashpad(rootPath: string, crashpad: CrashpadDocument): Promise<CrashpadDocument> {
  const resolvedRoot = await assertVaultRoot(rootPath);
  return writeCrashpad(resolvedRoot, crashpad);
}

export async function getVaultCrashpadDeletePreferences(rootPath: string): Promise<CrashpadDeletePreferences> {
  await assertVaultRoot(rootPath);
  return getCrashpadDeletePreferences();
}

export async function updateVaultCrashpadDeletePreferences(
  rootPath: string,
  preferences: CrashpadDeletePreferences,
): Promise<CrashpadDeletePreferences> {
  await assertVaultRoot(rootPath);
  return setCrashpadDeletePreferences(preferences);
}

export async function updateVaultCardStore(rootPath: string, cardStorePath: string) {
  const resolvedRoot = await assertVaultRoot(rootPath);
  await persistCardStorePath(resolvedRoot, cardStorePath);
  return updateIndex(resolvedRoot);
}

export async function getVaultImageDirectories(rootPath: string) {
  const resolvedRoot = await assertVaultRoot(rootPath);
  return getImageDirectories(resolvedRoot);
}

export async function updateVaultImageDirectories(rootPath: string, imageDirectories: string[]) {
  const resolvedRoot = await assertVaultRoot(rootPath);
  await persistImageDirectories(resolvedRoot, imageDirectories);
  return updateIndex(resolvedRoot);
}

export async function readNote(rootPath: string, filePath: string) {
  const { resolvedRoot, cardStore } = await resolveVaultCardStoreContext(rootPath);
  const notePath = resolveNotePath(resolvedRoot, filePath);
  return readNoteDocument(resolvedRoot, notePath.absolutePath, cardStore.cardStorePath);
}

export async function writeNote(rootPath: string, input: VaultWriteNoteInput): Promise<VaultWriteNoteResult> {
  const { resolvedRoot, cardStore, imageDirectories } = await resolveVaultDescriptorContext(rootPath);
  const notePath = resolveNotePath(resolvedRoot, input.filePath);
  await fs.mkdir(path.dirname(notePath.absolutePath), { recursive: true });
  await writeTextAtomically(notePath.absolutePath, input.content);

  const sync = await syncNoteToCardStore(cardStore.cardStorePath, notePath.relativePath, input.content);
  const note = await readNoteDocument(resolvedRoot, notePath.absolutePath, cardStore.cardStorePath);
  note.cardSync = sync.summary;

  const notes = await listVaultNotes(resolvedRoot, cardStore.cardStorePath);
  const index = await writeIndex(resolvedRoot, notes);
  const vault = toDescriptor(resolvedRoot, notes, index, cardStore, imageDirectories, sync.summary, null);

  return {
    note,
    vault,
  };
}
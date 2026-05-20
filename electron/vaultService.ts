import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ReviewMetadata,
  VaultDescriptor,
  VaultIndex,
  VaultIndexEntry,
  VaultNoteDocument,
  VaultNoteSummary,
  VaultWriteNoteInput,
  VaultWriteNoteResult,
} from './vault-contract';

const INDEX_FILE_NAME = 'index.json';
const MARKDOWN_EXTENSION = '.md';

function toPosixPath(value: string) {
  return value.replace(/\\/g, '/');
}

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

function createEntryId(filePath: string) {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16);
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

function resolveNotePath(rootPath: string, filePath: string) {
  const normalizedPath = normalizeNotePath(filePath);
  const absolutePath = path.resolve(rootPath, normalizedPath);
  const relativePath = path.relative(rootPath, absolutePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Note paths must stay inside the selected vault.');
  }

  return {
    absolutePath,
    relativePath: toPosixPath(relativePath),
  };
}

async function collectMarkdownFiles(rootPath: string, currentDirectory = rootPath): Promise<string[]> {
  const directoryEntries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const markdownFiles: string[] = [];

  for (const entry of directoryEntries) {
    const absolutePath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      markdownFiles.push(...(await collectMarkdownFiles(rootPath, absolutePath)));
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === MARKDOWN_EXTENSION) {
      markdownFiles.push(absolutePath);
    }
  }

  return markdownFiles.sort((left, right) => left.localeCompare(right));
}

async function readNoteDocument(rootPath: string, absolutePath: string): Promise<VaultNoteDocument> {
  const [content, stats] = await Promise.all([fs.readFile(absolutePath, 'utf8'), fs.stat(absolutePath)]);
  const relativePath = toPosixPath(path.relative(rootPath, absolutePath));

  return {
    filePath: relativePath,
    title: path.basename(relativePath, MARKDOWN_EXTENSION),
    size: Buffer.byteLength(content, 'utf8'),
    modifiedAt: stats.mtime.toISOString(),
    tags: extractTags(content),
    content,
  };
}

async function listVaultNotes(rootPath: string) {
  const markdownFiles = await collectMarkdownFiles(rootPath);
  return Promise.all(markdownFiles.map((filePath) => readNoteDocument(rootPath, filePath)));
}

function toSummary(note: VaultNoteDocument): VaultNoteSummary {
  const { content, ...summary } = note;
  return summary;
}

async function readStoredIndex(rootPath: string): Promise<VaultIndex | null> {
  try {
    const raw = await fs.readFile(path.join(rootPath, INDEX_FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw) as Partial<VaultIndex>;

    if (!Array.isArray(parsed.entries)) {
      return null;
    }

    const entries = parsed.entries
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
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      entries,
    };
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;

    if (code === 'ENOENT') {
      return null;
    }

    return null;
  }
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

async function writeIndex(rootPath: string, notes: VaultNoteDocument[]) {
  const existingIndex = await readStoredIndex(rootPath);
  const index = buildIndex(notes, existingIndex);
  await fs.writeFile(path.join(rootPath, INDEX_FILE_NAME), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}

function toDescriptor(rootPath: string, notes: VaultNoteDocument[], index: VaultIndex): VaultDescriptor {
  return {
    rootPath,
    indexFilePath: path.join(rootPath, INDEX_FILE_NAME),
    notes: notes.map(toSummary),
    index,
  };
}

export async function updateIndex(rootPath: string): Promise<VaultDescriptor> {
  const resolvedRoot = await assertVaultRoot(rootPath);
  const notes = await listVaultNotes(resolvedRoot);
  const index = await writeIndex(resolvedRoot, notes);

  return toDescriptor(resolvedRoot, notes, index);
}

export async function openVault(rootPath: string) {
  return updateIndex(rootPath);
}

export async function readNote(rootPath: string, filePath: string) {
  const resolvedRoot = await assertVaultRoot(rootPath);
  const notePath = resolveNotePath(resolvedRoot, filePath);
  return readNoteDocument(resolvedRoot, notePath.absolutePath);
}

export async function writeNote(rootPath: string, input: VaultWriteNoteInput): Promise<VaultWriteNoteResult> {
  const resolvedRoot = await assertVaultRoot(rootPath);
  const notePath = resolveNotePath(resolvedRoot, input.filePath);
  await fs.mkdir(path.dirname(notePath.absolutePath), { recursive: true });
  await fs.writeFile(notePath.absolutePath, input.content, 'utf8');

  const note = await readNoteDocument(resolvedRoot, notePath.absolutePath);
  const vault = await updateIndex(resolvedRoot);

  return {
    note,
    vault,
  };
}
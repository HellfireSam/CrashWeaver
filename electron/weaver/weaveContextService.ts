import path from 'node:path';
import { readCardDocument } from '../cardStoreService';
import { readVaultIndex } from '../services/vaultIndexService';
import type {
  CardDocument,
  CardNoteReference,
  VaultIndexEntry,
  WeavePlanRequest,
  WeaveStrength,
} from '../vault-contract';
import { getVaultCardStore, readNote } from '../vaultService';
import { toPosixPath } from '../utils/paths';

const INTERNAL_DIRECTORY_NAME = '.crashweaver';
const INDEX_FILE_NAME = 'index.json';
const CARD_RAW_CONTENT_EXCERPT_CHARS = 600;
const SELECTED_TEXT_EXCERPT_CHARS = 600;
const REFERENCE_EXCERPT_PADDING_LINES = 4;

const STOP_WORDS = new Set([
  'a',
  'about',
  'after',
  'all',
  'and',
  'are',
  'around',
  'be',
  'by',
  'card',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'it',
  'near',
  'note',
  'of',
  'on',
  'or',
  'place',
  'that',
  'the',
  'this',
  'to',
  'vault',
  'weaver',
  'with',
]);

export interface WeaveRetrievalBudget {
  maxCandidateNotes: number;
  maxDirectorySummaries: number;
  maxNoteReads: number;
  maxExcerptChars: number;
  maxFullNoteChars: number;
  maxRetrievedChars: number;
}

export interface WeaveContextCardSummary {
  uid: string;
  type: string[];
  rawContentExcerpt: string;
  memoryTechnique: string;
  qaPairs: Array<{ q: string; a: string }>;
  referencedIn: Array<{
    notePath: string;
    startLine: number;
    endLine: number;
  }>;
}

export interface WeaveCandidateNoteSummary {
  filePath: string;
  title: string;
  tags: string[];
  updatedAt: string;
  directoryPath: string;
  score: number;
  reasons: string[];
}

export interface WeaveDirectorySummary {
  directoryPath: string;
  noteCount: number;
  candidateCount: number;
  sampleNotes: string[];
  score: number;
  reasons: string[];
}

export interface WeaveContextSnapshot {
  rootPath: string;
  requestKind: WeavePlanRequest['kind'];
  intent: string;
  activeNotePath?: string;
  selectedText?: string;
  card: WeaveContextCardSummary;
  candidateNotes: WeaveCandidateNoteSummary[];
  directorySummaries: WeaveDirectorySummary[];
  retrievalBudget: WeaveRetrievalBudget;
  warnings: string[];
}

export interface WeaveToolRuntimeUsage {
  noteReads: number;
  retrievedChars: number;
  remainingNoteReads: number;
  remainingChars: number;
}

interface WeaveStoredNoteSummary {
  filePath: string;
  title: string;
  tags: string[];
  updatedAt: string;
}

interface WeaveToolSuccessResult {
  ok: true;
  toolName: string;
  usage: WeaveToolRuntimeUsage;
  data: Record<string, unknown>;
}

interface WeaveToolErrorResult {
  ok: false;
  toolName: string;
  usage: WeaveToolRuntimeUsage;
  error: string;
  diagnostics?: {
    code:
      | 'budget-note-reads-exhausted'
      | 'budget-chars-exhausted'
      | 'note-outside-candidates'
      | 'invalid-arguments'
      | 'unsupported-tool'
      | 'runtime-error';
    recoverable: boolean;
  };
}

export type WeaveToolResult = WeaveToolSuccessResult | WeaveToolErrorResult;

function getInternalDirectoryPath(rootPath: string) {
  return path.join(rootPath, INTERNAL_DIRECTORY_NAME);
}

function getIndexFilePath(rootPath: string) {
  return path.join(getInternalDirectoryPath(rootPath), INDEX_FILE_NAME);
}

function getLegacyIndexFilePath(rootPath: string) {
  return path.join(rootPath, INDEX_FILE_NAME);
}

function getDirectoryPath(filePath: string) {
  const directoryPath = path.posix.dirname(toPosixPath(filePath));
  return directoryPath === '.' ? '.' : directoryPath;
}

function trimExcerpt(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  const suffix = '\n[...truncated]';
  return `${value.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

function extractNoteSearchTokens(card: CardDocument, intent: string) {
  const buckets = [
    intent,
    ...card.type,
    card.raw_content,
    card.memory_tricks.memory_technique,
    ...card.memory_tricks.qa_pairs.flatMap((pair) => [pair.q, pair.a]),
  ];
  const uniqueTokens = new Set<string>();

  for (const bucket of buckets) {
    for (const rawToken of bucket.toLowerCase().split(/[^a-z0-9/_-]+/g)) {
      const token = rawToken.trim();

      if (token.length < 3 || STOP_WORDS.has(token)) {
        continue;
      }

      uniqueTokens.add(token);

      if (uniqueTokens.size >= 24) {
        return [...uniqueTokens];
      }
    }
  }

  return [...uniqueTokens];
}

function countTokenMatches(source: string, tokens: string[]) {
  if (!source) {
    return 0;
  }

  const normalizedSource = source.toLowerCase();
  let matches = 0;

  for (const token of tokens) {
    if (normalizedSource.includes(token)) {
      matches += 1;
    }
  }

  return matches;
}

function getCommonDirectorySegments(leftPath: string, rightPath: string) {
  const leftSegments = getDirectoryPath(leftPath).split('/').filter(Boolean);
  const rightSegments = getDirectoryPath(rightPath).split('/').filter(Boolean);
  const length = Math.min(leftSegments.length, rightSegments.length);
  let commonSegments = 0;

  for (let index = 0; index < length; index += 1) {
    if (leftSegments[index] !== rightSegments[index]) {
      break;
    }

    commonSegments += 1;
  }

  return commonSegments;
}

function getPathProximityScore(filePath: string, anchorPaths: string[]) {
  let bestScore = 0;

  for (const anchorPath of anchorPaths) {
    if (!anchorPath || anchorPath === filePath) {
      continue;
    }

    const commonSegments = getCommonDirectorySegments(filePath, anchorPath);

    if (!commonSegments) {
      continue;
    }

    const directoryMatchBoost = getDirectoryPath(filePath) === getDirectoryPath(anchorPath) ? 18 : 0;
    bestScore = Math.max(bestScore, commonSegments * 10 + directoryMatchBoost);
  }

  return bestScore;
}

function buildStoredNoteSummary(entry: VaultIndexEntry): WeaveStoredNoteSummary {
  return {
    filePath: toPosixPath(entry.filePath),
    title: entry.title,
    tags: [...entry.tags],
    updatedAt: entry.updatedAt,
  };
}

function buildFallbackNoteSummary(filePath: string): WeaveStoredNoteSummary {
  const normalizedPath = toPosixPath(filePath);

  return {
    filePath: normalizedPath,
    title: path.posix.basename(normalizedPath, path.posix.extname(normalizedPath)),
    tags: [],
    updatedAt: '',
  };
}

function getReferenceMap(card: CardDocument) {
  return new Map(card.referenced_in.map((reference) => [toPosixPath(reference.note_path), reference]));
}

function getCandidateReasonFragments(
  summary: WeaveStoredNoteSummary,
  tokens: string[],
  request: WeavePlanRequest,
  referenceMap: Map<string, CardNoteReference>,
) {
  const reasons: string[] = [];
  const normalizedPath = toPosixPath(summary.filePath);
  const titleMatches = countTokenMatches(summary.title, tokens);
  const tagMatches = countTokenMatches(summary.tags.join(' '), tokens);
  const pathMatches = countTokenMatches(normalizedPath, tokens);

  if (referenceMap.has(normalizedPath)) {
    reasons.push('Card already references this note.');
  }

  if (request.activeNotePath && normalizedPath === toPosixPath(request.activeNotePath)) {
    reasons.push('Matches the active note context.');
  }

  if (titleMatches > 0) {
    reasons.push(`Title overlaps ${titleMatches} card or intent keyword${titleMatches === 1 ? '' : 's'}.`);
  }

  if (tagMatches > 0) {
    reasons.push(`Tags overlap ${tagMatches} card or intent keyword${tagMatches === 1 ? '' : 's'}.`);
  }

  if (pathMatches > 0) {
    reasons.push(`Path overlaps ${pathMatches} card or intent keyword${pathMatches === 1 ? '' : 's'}.`);
  }

  return reasons;
}

function scoreCandidateNote(
  summary: WeaveStoredNoteSummary,
  tokens: string[],
  request: WeavePlanRequest,
  referenceMap: Map<string, CardNoteReference>,
  anchorPaths: string[],
) {
  const normalizedPath = toPosixPath(summary.filePath);
  const titleMatches = countTokenMatches(summary.title, tokens);
  const tagMatches = countTokenMatches(summary.tags.join(' '), tokens);
  const pathMatches = countTokenMatches(normalizedPath, tokens);
  let score = 0;

  if (referenceMap.has(normalizedPath)) {
    score += 220;
  }

  if (request.activeNotePath && normalizedPath === toPosixPath(request.activeNotePath)) {
    score += 150;
  }

  score += titleMatches * 20;
  score += tagMatches * 15;
  score += pathMatches * 8;
  score += getPathProximityScore(normalizedPath, anchorPaths);

  return score;
}

function resolveRetrievalBudget(request: WeavePlanRequest): WeaveRetrievalBudget {
  if (request.kind === 'guided-insert') {
    const expanded = request.permissions.editContent || request.permissions.createNote;

    return {
      maxCandidateNotes: expanded ? 12 : 8,
      maxDirectorySummaries: expanded ? 8 : 6,
      maxNoteReads: expanded ? 2 : 1,
      maxExcerptChars: expanded ? 1500 : 1200,
      maxFullNoteChars: expanded ? 5000 : 3200,
      maxRetrievedChars: expanded ? 7000 : 3600,
    };
  }

  const byStrength: Record<WeaveStrength, WeaveRetrievalBudget> = {
    light: {
      maxCandidateNotes: 10,
      maxDirectorySummaries: 8,
      maxNoteReads: 2,
      maxExcerptChars: 1400,
      maxFullNoteChars: 4200,
      maxRetrievedChars: 7000,
    },
    standard: {
      maxCandidateNotes: 14,
      maxDirectorySummaries: 10,
      maxNoteReads: 4,
      maxExcerptChars: 1800,
      maxFullNoteChars: 6000,
      maxRetrievedChars: 12000,
    },
    'go-ham': {
      maxCandidateNotes: 18,
      maxDirectorySummaries: 12,
      maxNoteReads: 6,
      maxExcerptChars: 2200,
      maxFullNoteChars: 8000,
      maxRetrievedChars: 18000,
    },
  };

  return byStrength[request.strength];
}

function buildCandidateNotes(
  notes: WeaveStoredNoteSummary[],
  card: CardDocument,
  request: WeavePlanRequest,
  budget: WeaveRetrievalBudget,
) {
  const referenceMap = getReferenceMap(card);
  const tokens = extractNoteSearchTokens(card, request.intent ?? '');
  const anchorPaths = [
    ...(request.activeNotePath ? [toPosixPath(request.activeNotePath)] : []),
    ...card.referenced_in.map((reference) => toPosixPath(reference.note_path)),
  ];

  return notes
    .map((summary) => ({
      filePath: toPosixPath(summary.filePath),
      title: summary.title,
      tags: [...summary.tags],
      updatedAt: summary.updatedAt,
      directoryPath: getDirectoryPath(summary.filePath),
      score: scoreCandidateNote(summary, tokens, request, referenceMap, anchorPaths),
      reasons: getCandidateReasonFragments(summary, tokens, request, referenceMap),
    }))
    .filter((summary) => summary.score > 0)
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
    .slice(0, budget.maxCandidateNotes);
}

function buildDirectorySummaries(
  notes: WeaveStoredNoteSummary[],
  candidateNotes: WeaveCandidateNoteSummary[],
  request: WeavePlanRequest,
  card: CardDocument,
  budget: WeaveRetrievalBudget,
) {
  const directoryStats = new Map<string, {
    noteCount: number;
    candidateCount: number;
    sampleNotes: string[];
    score: number;
    reasons: Set<string>;
  }>();
  const referencedDirectories = new Set(card.referenced_in.map((reference) => getDirectoryPath(reference.note_path)));
  const activeDirectory = request.activeNotePath ? getDirectoryPath(request.activeNotePath) : null;

  for (const note of notes) {
    const directoryPath = getDirectoryPath(note.filePath);
    const stat = directoryStats.get(directoryPath) ?? {
      noteCount: 0,
      candidateCount: 0,
      sampleNotes: [],
      score: 0,
      reasons: new Set<string>(),
    };

    stat.noteCount += 1;
    directoryStats.set(directoryPath, stat);
  }

  for (const note of candidateNotes) {
    const stat = directoryStats.get(note.directoryPath) ?? {
      noteCount: 0,
      candidateCount: 0,
      sampleNotes: [],
      score: 0,
      reasons: new Set<string>(),
    };

    stat.candidateCount += 1;
    stat.score += note.score;

    if (stat.sampleNotes.length < 3) {
      stat.sampleNotes.push(note.filePath);
    }

    if (referencedDirectories.has(note.directoryPath)) {
      stat.reasons.add('Contains existing card references.');
    }

    if (activeDirectory && note.directoryPath === activeDirectory) {
      stat.reasons.add('Contains the active note directory.');
    }

    if (note.reasons.length > 0) {
      stat.reasons.add('Contains top-ranked candidate notes.');
    }

    directoryStats.set(note.directoryPath, stat);
  }

  return [...directoryStats.entries()]
    .filter(([, stat]) => stat.candidateCount > 0)
    .map(([directoryPath, stat]) => ({
      directoryPath,
      noteCount: stat.noteCount,
      candidateCount: stat.candidateCount,
      sampleNotes: stat.sampleNotes,
      score: stat.score,
      reasons: [...stat.reasons],
    }))
    .sort((left, right) => right.score - left.score || left.directoryPath.localeCompare(right.directoryPath))
    .slice(0, budget.maxDirectorySummaries);
}

function buildCardSummary(card: CardDocument): WeaveContextCardSummary {
  return {
    uid: card.uid,
    type: [...card.type],
    rawContentExcerpt: trimExcerpt(card.raw_content.trim(), CARD_RAW_CONTENT_EXCERPT_CHARS),
    memoryTechnique: card.memory_tricks.memory_technique.trim(),
    qaPairs: card.memory_tricks.qa_pairs.slice(0, 3).map((pair) => ({ q: pair.q, a: pair.a })),
    referencedIn: card.referenced_in.map((reference) => ({
      notePath: toPosixPath(reference.note_path),
      startLine: reference.start_line,
      endLine: reference.end_line,
    })),
  };
}

function buildInitialNoteCatalog(
  request: WeavePlanRequest,
  storedIndexEntries: VaultIndexEntry[],
  card: CardDocument,
  warnings: string[],
) {
  const noteLookup = new Map<string, WeaveStoredNoteSummary>();

  for (const entry of storedIndexEntries) {
    const summary = buildStoredNoteSummary(entry);
    noteLookup.set(summary.filePath, summary);
  }

  const supplementalPaths = new Set<string>();

  if (request.activeNotePath) {
    supplementalPaths.add(toPosixPath(request.activeNotePath));
  }

  for (const reference of card.referenced_in) {
    supplementalPaths.add(toPosixPath(reference.note_path));
  }

  for (const notePath of supplementalPaths) {
    if (noteLookup.has(notePath)) {
      continue;
    }

    noteLookup.set(notePath, buildFallbackNoteSummary(notePath));
  }

  if (noteLookup.size === 0) {
    warnings.push('No stored vault index was available, so note retrieval will stay conservative.');
  }

  return [...noteLookup.values()];
}

function normalizeLimit(value: unknown, fallbackValue: number, maxValue: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallbackValue;
  }

  const normalized = Math.trunc(value);

  if (normalized <= 0) {
    return fallbackValue;
  }

  return Math.min(normalized, maxValue);
}

function normalizeOptionalPath(value: unknown) {
  return typeof value === 'string' && value.trim() ? toPosixPath(value.trim()) : undefined;
}

function classifyToolError(errorMessage: string): WeaveToolErrorResult['diagnostics'] {
  const msg = errorMessage.toLowerCase();
  if (msg.includes('note-read budget is exhausted')) {
    return { code: 'budget-note-reads-exhausted', recoverable: true };
  }
  if (msg.includes('character budget is exhausted')) {
    return { code: 'budget-chars-exhausted', recoverable: true };
  }
  if (msg.includes('outside the ranked candidate set')) {
    return { code: 'note-outside-candidates', recoverable: true };
  }
  if (msg.includes('requires')) {
    return { code: 'invalid-arguments', recoverable: true };
  }
  if (msg.includes('unsupported read-only tool')) {
    return { code: 'unsupported-tool', recoverable: true };
  }
  return { code: 'runtime-error', recoverable: false };
}

export async function buildWeaveContextSnapshot(request: WeavePlanRequest): Promise<WeaveContextSnapshot> {
  const warnings: string[] = [];
  const retrievalBudget = resolveRetrievalBudget(request);
  const cardStore = await getVaultCardStore(request.rootPath);
  const card = await readCardDocument(cardStore.cardStorePath, request.cardUid);

  if (!card) {
    throw new Error(`Focused card ${request.cardUid} was not found in the card store.`);
  }

  const storedIndex = await readVaultIndex(getIndexFilePath(request.rootPath), getLegacyIndexFilePath(request.rootPath));
  const noteCatalog = buildInitialNoteCatalog(request, storedIndex?.entries ?? [], card, warnings);
  const candidateNotes = buildCandidateNotes(noteCatalog, card, request, retrievalBudget);
  const directorySummaries = buildDirectorySummaries(noteCatalog, candidateNotes, request, card, retrievalBudget);

  if (candidateNotes.length === 0) {
    warnings.push('No candidate notes ranked above zero. Intelligent mode should stay conservative unless the active note is enough.');
  }

  return {
    rootPath: request.rootPath,
    requestKind: request.kind,
    intent: request.intent.trim(),
    activeNotePath: request.activeNotePath ? toPosixPath(request.activeNotePath) : undefined,
    selectedText: request.selectedText?.trim()
      ? trimExcerpt(request.selectedText.trim(), SELECTED_TEXT_EXCERPT_CHARS)
      : undefined,
    card: buildCardSummary(card),
    candidateNotes,
    directorySummaries,
    retrievalBudget,
    warnings,
  };
}

export class WeaveContextToolRuntime {
  private readonly candidateLookup: Map<string, WeaveCandidateNoteSummary>;
  private readonly referenceLookup: Map<string, CardNoteReference>;
  private readonly retrievalBudget: WeaveRetrievalBudget;
  private noteReads = 0;
  private retrievedChars = 0;

  /** Registry of all read-only tool handlers keyed by tool name. */
  private readonly toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<WeaveToolResult>>;

  constructor(
    private readonly snapshot: WeaveContextSnapshot,
    budgetOverrides?: Partial<WeaveRetrievalBudget>,
  ) {
    this.candidateLookup = new Map(snapshot.candidateNotes.map((note) => [note.filePath, note]));
    this.referenceLookup = new Map(snapshot.card.referencedIn.map((reference) => [reference.notePath, {
      note_path: reference.notePath,
      start_line: reference.startLine,
      end_line: reference.endLine,
    }]));
    this.retrievalBudget = {
      ...snapshot.retrievalBudget,
      ...budgetOverrides,
    };

    // ── Tool registry ────────────────────────────────────────────────────────
    // Each tool is a private method below; the registry maps names → bound handlers.
    this.toolHandlers = {
      list_candidate_notes: this.toolListCandidateNotes.bind(this),
      list_directory_summary: this.toolListDirectorySummary.bind(this),
      search_notes: this.toolSearchNotes.bind(this),
      read_note_excerpt: this.toolReadNoteExcerpt.bind(this),
      read_note_full: this.toolReadNoteFull.bind(this),
      read_note_span: this.toolReadNoteSpan.bind(this),
    };
  }

  private getUsage(): WeaveToolRuntimeUsage {
    return {
      noteReads: this.noteReads,
      retrievedChars: this.retrievedChars,
      remainingNoteReads: Math.max(0, this.retrievalBudget.maxNoteReads - this.noteReads),
      remainingChars: Math.max(0, this.retrievalBudget.maxRetrievedChars - this.retrievedChars),
    };
  }

  private resolveRequestedChars(requestedChars: unknown, maxChars: number) {
    const cappedRequest = normalizeLimit(requestedChars, maxChars, maxChars);
    const remainingChars = this.retrievalBudget.maxRetrievedChars - this.retrievedChars;

    if (remainingChars <= 0) {
      throw new Error('Weaver retrieval character budget is exhausted. Finalize with the context already retrieved.');
    }

    return Math.min(cappedRequest, remainingChars);
  }

  private assertNoteReadBudget() {
    if (this.noteReads >= this.retrievalBudget.maxNoteReads) {
      throw new Error('Weaver retrieval note-read budget is exhausted. Finalize with the current evidence.');
    }
  }

  private findNoteSpan(content: string, startAnchor: string, endAnchor: string) {
    const startIndex = content.indexOf(startAnchor);
    if (startIndex < 0) {
      throw new Error('read_note_span startAnchor was not found in the note content.');
    }

    const endSearchStart = startIndex + startAnchor.length;
    const endIndex = content.indexOf(endAnchor, endSearchStart);
    if (endIndex < 0) {
      throw new Error('read_note_span endAnchor was not found after startAnchor in the note content.');
    }

    const spanStart = startIndex;
    const spanEnd = endIndex + endAnchor.length;
    const before = content.slice(0, spanStart);
    const lineStart = before.split(/\r?\n/g).length;
    const lineEnd = before.concat(content.slice(spanStart, spanEnd)).split(/\r?\n/g).length;

    return {
      spanText: content.slice(spanStart, spanEnd),
      lineStart,
      lineEnd,
    };
  }

  private async readNoteSlice(filePath: string, mode: 'excerpt' | 'full', requestedChars: unknown) {
    const normalizedPath = toPosixPath(filePath);

    if (!this.candidateLookup.has(normalizedPath)) {
      throw new Error(`Note ${normalizedPath} is outside the ranked candidate set.`);
    }

    this.assertNoteReadBudget();

    const maxChars = mode === 'excerpt' ? this.retrievalBudget.maxExcerptChars : this.retrievalBudget.maxFullNoteChars;
    const allowedChars = this.resolveRequestedChars(requestedChars, maxChars);
    const note = await readNote(this.snapshot.rootPath, normalizedPath);
    const selectedText = this.snapshot.selectedText?.trim();
    const noteReference = this.referenceLookup.get(normalizedPath);
    let excerpt = note.content;
    let lineStart = 1;
    let lineEnd = note.content.split(/\r?\n/g).length;

    if (mode === 'excerpt') {
      if (noteReference) {
        const lines = note.content.split(/\r?\n/g);
        lineStart = Math.max(1, noteReference.start_line - REFERENCE_EXCERPT_PADDING_LINES);
        lineEnd = Math.min(lines.length, noteReference.end_line + REFERENCE_EXCERPT_PADDING_LINES);
        excerpt = lines.slice(lineStart - 1, lineEnd).join('\n');
      } else if (selectedText && this.snapshot.activeNotePath === normalizedPath) {
        const selectionIndex = note.content.indexOf(selectedText);

        if (selectionIndex >= 0) {
          const halfWindow = Math.max(120, Math.trunc(allowedChars / 2));
          const sliceStart = Math.max(0, selectionIndex - halfWindow);
          const sliceEnd = Math.min(note.content.length, selectionIndex + selectedText.length + halfWindow);
          excerpt = note.content.slice(sliceStart, sliceEnd);
        }
      }
    }

    const truncatedContent = trimExcerpt(excerpt, allowedChars);
    this.noteReads += 1;
    this.retrievedChars += truncatedContent.length;

    return {
      ok: true as const,
      toolName: mode === 'excerpt' ? 'read_note_excerpt' : 'read_note_full',
      usage: this.getUsage(),
      data: {
        filePath: normalizedPath,
        title: note.title,
        mode,
        lineStart,
        lineEnd,
        truncated: truncatedContent.length < excerpt.length,
        content: truncatedContent,
      },
    };
  }

  // ── Individual tool handlers ────────────────────────────────────────────────

  private async toolListCandidateNotes(args: Record<string, unknown>): Promise<WeaveToolResult> {
    const limit = normalizeLimit(args.limit, this.retrievalBudget.maxCandidateNotes, this.retrievalBudget.maxCandidateNotes);
    const directoryPath = normalizeOptionalPath(args.directoryPath);
    const notes = this.snapshot.candidateNotes
      .filter((note) => !directoryPath || note.directoryPath === directoryPath)
      .slice(0, limit);

    return {
      ok: true,
      toolName: 'list_candidate_notes',
      usage: this.getUsage(),
      data: { notes, directoryPath },
    };
  }

  private async toolListDirectorySummary(args: Record<string, unknown>): Promise<WeaveToolResult> {
    const limit = normalizeLimit(args.limit, this.retrievalBudget.maxDirectorySummaries, this.retrievalBudget.maxDirectorySummaries);
    return {
      ok: true,
      toolName: 'list_directory_summary',
      usage: this.getUsage(),
      data: { directories: this.snapshot.directorySummaries.slice(0, limit) },
    };
  }

  private async toolSearchNotes(args: Record<string, unknown>): Promise<WeaveToolResult> {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    if (!query) throw new Error('search_notes requires a non-empty query.');

    const limit = normalizeLimit(args.limit, this.retrievalBudget.maxCandidateNotes, this.retrievalBudget.maxCandidateNotes);
    const directoryPath = normalizeOptionalPath(args.directoryPath);

    const notes = this.snapshot.candidateNotes
      .filter((note) => !directoryPath || note.directoryPath === directoryPath)
      .filter((note) => {
        const haystack = `${note.filePath}\n${note.title}\n${note.tags.join(' ')}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, limit);

    return {
      ok: true,
      toolName: 'search_notes',
      usage: this.getUsage(),
      data: { query, directoryPath, notes },
    };
  }

  private async toolReadNoteExcerpt(args: Record<string, unknown>): Promise<WeaveToolResult> {
    const filePath = normalizeOptionalPath(args.filePath);
    if (!filePath) throw new Error('read_note_excerpt requires a candidate filePath.');
    return this.readNoteSlice(filePath, 'excerpt', args.maxChars);
  }

  private async toolReadNoteFull(args: Record<string, unknown>): Promise<WeaveToolResult> {
    const filePath = normalizeOptionalPath(args.filePath);
    if (!filePath) throw new Error('read_note_full requires a candidate filePath.');
    return this.readNoteSlice(filePath, 'full', args.maxChars);
  }

  private async toolReadNoteSpan(args: Record<string, unknown>): Promise<WeaveToolResult> {
    const filePath = normalizeOptionalPath(args.filePath);
    const startAnchor = args.startAnchor;
    const endAnchor = args.endAnchor;

    if (!filePath) throw new Error('read_note_span requires a candidate filePath.');
    if (typeof startAnchor !== 'string' || !startAnchor.trim()) throw new Error('read_note_span requires a non-empty startAnchor.');
    if (typeof endAnchor !== 'string' || !endAnchor.trim()) throw new Error('read_note_span requires a non-empty endAnchor.');

    const normalizedPath = toPosixPath(filePath);
    if (!this.candidateLookup.has(normalizedPath)) {
      throw new Error(`Note ${normalizedPath} is outside the ranked candidate set.`);
    }

    this.assertNoteReadBudget();
    const allowedChars = this.resolveRequestedChars(args.maxChars, this.retrievalBudget.maxFullNoteChars);

    const note = await readNote(this.snapshot.rootPath, normalizedPath);
    const span = this.findNoteSpan(note.content, startAnchor.trim(), endAnchor.trim());
    const truncated = trimExcerpt(span.spanText, allowedChars);
    this.noteReads += 1;
    this.retrievedChars += truncated.length;

    return {
      ok: true,
      toolName: 'read_note_span',
      usage: this.getUsage(),
      data: {
        filePath: normalizedPath,
        title: note.title,
        lineStart: span.lineStart,
        lineEnd: span.lineEnd,
        truncated: truncated.length < span.spanText.length,
        content: truncated,
      },
    };
  }

  // ── Public dispatcher ───────────────────────────────────────────────────────

  /**
   * Dispatches a tool call by name.  Each tool handler throws on validation
   * errors; the dispatcher catches all throws and converts them to a
   * structured WeaveToolErrorResult so the caller never deals with raw
   * exceptions.
   */
  async execute(toolName: string, args: unknown): Promise<WeaveToolResult> {
    const toolArgs: Record<string, unknown> =
      args && typeof args === 'object' && !Array.isArray(args)
        ? args as Record<string, unknown>
        : {};

    const handler = this.toolHandlers[toolName];

    if (!handler) {
      return {
        ok: false,
        toolName,
        usage: this.getUsage(),
        error: `Unsupported read-only tool: ${toolName}.`,
        diagnostics: classifyToolError(`Unsupported read-only tool: ${toolName}.`),
      };
    }

    try {
      return await handler(toolArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        toolName,
        usage: this.getUsage(),
        error: message,
        diagnostics: classifyToolError(message),
      };
    }
  }
}

export function createWeaveContextToolRuntime(
  snapshot: WeaveContextSnapshot,
  budgetOverrides?: Partial<WeaveRetrievalBudget>,
) {
  return new WeaveContextToolRuntime(snapshot, budgetOverrides);
}
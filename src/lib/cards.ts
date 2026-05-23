import type {
  CardDocument,
  CardMemoryTricks,
  CardMetadata,
  CardNoteReference,
  CardRebuildSummary,
  CardSyncSummary,
  CrashpadCardOrigin,
  ParsedCrashCard,
} from '../../electron/vault-contract';

export type CardScope = 'current-note' | 'current-vault';
export type FocusWindow = 'explorer' | 'source-editor' | 'preview' | 'cards-list' | 'card-detail' | 'assistant-panel' | 'settings';
export type CardDetailTab = 'content' | 'memory-technique' | 'qna' | 'metadata';

export type CardViewRecord = {
  uid: string;
  type: string[];
  rawContent: string;
  metadata: CardMetadata;
  memoryTricks: CardMemoryTricks;
  references: CardNoteReference[];
  currentReference: CardNoteReference | null;
  cardFilePath?: string;
  cardExists: boolean;
  source: 'current-note' | 'current-vault' | 'crashpad';
  origin?: CrashpadCardOrigin;
};

export function formatCardSyncSummary(summary: CardSyncSummary | null | undefined) {
  if (!summary) {
    return null;
  }

  const created = summary.changes.filter((change) => change.action === 'created').length;
  const updated = summary.changes.filter((change) => change.action === 'updated').length;
  const removed = summary.changes.filter((change) => change.action === 'removed-reference').length;
  const skipped = summary.changes.filter((change) => change.action === 'skipped').length;
  const parts = [`${created} created`, `${updated} updated`, `${removed} removed`];

  if (skipped) {
    parts.push(`${skipped} skipped`);
  }

  if (summary.diagnostics.length) {
    parts.push(`${summary.diagnostics.length} diagnostics`);
  }

  return `Card sync: ${parts.join(', ')}.`;
}

export function formatCardRebuildSummary(summary: CardRebuildSummary | null | undefined) {
  if (!summary) {
    return null;
  }

  return `Card rebuild: ${summary.processedNotes} notes, ${summary.changedCards} card updates, ${summary.removedReferences} stale references removed, ${summary.diagnostics} diagnostics.`;
}

export function getPreferredReference(card: CardDocument, preferredNotePath: string | null) {
  if (!preferredNotePath) {
    return card.referenced_in[0] ?? null;
  }

  return card.referenced_in.find((reference) => reference.note_path === preferredNotePath) ?? card.referenced_in[0] ?? null;
}

export function getFileName(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] ?? filePath;

  return fileName.replace(/\.crashpad\.json$/i, '').replace(/\.md$/i, '').replace(/\.json$/i, '');
}

export function formatFocusWindow(windowName: FocusWindow) {
  switch (windowName) {
    case 'assistant-panel':
      return 'Assistant Panel';
    case 'card-detail':
      return 'Card Detail';
    case 'cards-list':
      return 'Cards List';
    case 'preview':
      return 'Preview';
    case 'settings':
      return 'Settings';
    case 'source-editor':
      return 'Source Editor';
    default:
      return 'Explorer';
  }
}

export function formatNextReview(value: string | null) {
  return value ?? 'Not scheduled';
}

export function createFallbackCard(parsedCard: ParsedCrashCard, notePath: string): CardDocument {
  return {
    uid: parsedCard.uid,
    type: [],
    raw_content: parsedCard.blockContent.trim(),
    metadata: {
      familiarity: 0,
      next_review: null,
    },
    memory_tricks: {
      memory_technique: '',
      qa_pairs: [],
    },
    referenced_in: [
      {
        note_path: notePath,
        start_line: parsedCard.startLine,
        end_line: parsedCard.endLine,
      },
    ],
  };
}

export function toCardViewRecordFromParsedCard(parsedCard: ParsedCrashCard, notePath: string): CardViewRecord {
  const linkedCard = parsedCard.linkedCard ?? createFallbackCard(parsedCard, notePath);
  const currentReference = linkedCard.referenced_in.find((reference) => reference.note_path === notePath) ?? {
    note_path: notePath,
    start_line: parsedCard.startLine,
    end_line: parsedCard.endLine,
  };

  return {
    uid: linkedCard.uid,
    type: linkedCard.type,
    rawContent: linkedCard.raw_content || parsedCard.blockContent,
    metadata: linkedCard.metadata,
    memoryTricks: linkedCard.memory_tricks,
    references: linkedCard.referenced_in,
    currentReference,
    cardFilePath: parsedCard.cardFilePath,
    cardExists: parsedCard.cardExists ?? Boolean(parsedCard.linkedCard),
    source: 'current-note',
  };
}

export function toCardViewRecordFromCard(
  card: CardDocument,
  cardStorePath: string | undefined,
  preferredNotePath: string | null,
  source: 'current-vault' | 'crashpad' = 'current-vault',
  origin?: CrashpadCardOrigin,
): CardViewRecord {
  const currentReference = getPreferredReference(card, preferredNotePath);

  return {
    uid: card.uid,
    type: card.type,
    rawContent: card.raw_content,
    metadata: card.metadata,
    memoryTricks: card.memory_tricks,
    references: card.referenced_in,
    currentReference,
    cardFilePath: cardStorePath ? `${cardStorePath.replace(/\\/g, '/')}/${card.uid}.json` : undefined,
    cardExists: true,
    source,
    origin,
  };
}

export function sortCardViewRecords(cards: CardViewRecord[]) {
  return [...cards].sort((left, right) => left.uid.localeCompare(right.uid));
}

export interface ReviewMetadata {
  familiarity: number;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  intervalDays: number;
  repetition: number;
  easeFactor: number;
}

export interface CardMetadata {
  familiarity: number;
  next_review: string | null;
}

export interface CardQaPair {
  q: string;
  a: string;
}

export interface CardMemoryTricks {
  memory_technique: string;
  qa_pairs: CardQaPair[];
}

export interface CardNoteReference {
  note_path: string;
  start_line: number;
  end_line: number;
}

export interface CardDocument {
  uid: string;
  type: string[];
  raw_content: string;
  metadata: CardMetadata;
  memory_tricks: CardMemoryTricks;
  referenced_in: CardNoteReference[];
}

export type CrashpadCardOrigin = 'existing' | 'new';

export interface CrashpadCardEntry {
  uid: string;
  origin: CrashpadCardOrigin;
  addedAt: string;
}

export interface CrashpadDeletedCardSnapshot {
  uid: string;
  origin: CrashpadCardOrigin;
  deletedAt: string;
  removeNoteBoundaries: boolean;
  card: CardDocument;
}

export interface CrashpadDocument {
  id: string;
  name: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  cards: CrashpadCardEntry[];
  deletedCards: CrashpadDeletedCardSnapshot[];
}

export interface CrashpadSummary {
  id: string;
  name: string;
  filePath: string;
  updatedAt: string;
  activeCards: number;
  deletedCards: number;
}

export interface CrashpadDeletePreferences {
  removeNoteBoundariesByDefault: boolean;
  requireConfirmationForNewCards: boolean;
  requireStrictConfirmationForExistingCards: boolean;
}

export interface CardDeleteOptions {
  removeNoteBoundaries: boolean;
}

export interface CardDeleteResult {
  uid: string;
  removedCardFile: boolean;
  removedBoundariesFrom: number;
  removedBoundaryLines: number;
}

export type CardRestoreMode = 'reinsert-note-boundaries' | 'forget-note-references';

export interface CardRestoreOptions {
  mode: CardRestoreMode;
}

export interface CardRestoreResult {
  uid: string;
  reinsertedInto: number;
  alreadyPresentIn: number;
  forgottenReferences: number;
  skippedNotePaths: string[];
}

export interface CardRenameResult {
  previousUid: string;
  card: CardDocument;
  updatedNotePaths: string[];
  updatedCrashpads: number;
}

export type CardParseDiagnosticCode =
  | 'invalid-start-boundary'
  | 'invalid-end-boundary'
  | 'nested-start-boundary'
  | 'unmatched-start-boundary'
  | 'unmatched-end-boundary'
  | 'mismatched-boundary-uid';

export interface CardParseDiagnostic {
  code: CardParseDiagnosticCode;
  line: number;
  message: string;
  severity: 'warning' | 'error';
  uid?: string;
}

export interface ParsedCrashCard {
  uid: string;
  startLine: number;
  endLine: number;
  blockContent: string;
  cardFilePath?: string;
  cardExists?: boolean;
  linkedCard?: CardDocument | null;
}

export interface ParsedCrashCardsNote {
  notePath: string;
  cards: ParsedCrashCard[];
  diagnostics: CardParseDiagnostic[];
}

export interface CardStoreConfig {
  cardStorePath: string;
  isDefaultPath: boolean;
}

export interface CardSyncChange {
  uid: string;
  action: 'created' | 'updated' | 'removed-reference' | 'unchanged' | 'skipped';
  detail: string;
}

export interface CardSyncSummary {
  notePath: string;
  cardStorePath: string;
  changes: CardSyncChange[];
  diagnostics: CardParseDiagnostic[];
  syncedAt: string;
}

export interface CardRebuildSummary {
  processedNotes: number;
  changedCards: number;
  removedReferences: number;
  diagnostics: number;
  syncedAt: string;
}

export interface VaultIndexEntry {
  id: string;
  filePath: string;
  title: string;
  tags: string[];
  updatedAt: string;
  review: ReviewMetadata;
}

export interface VaultIndex {
  version: 1;
  updatedAt: string;
  entries: VaultIndexEntry[];
}

export interface VaultNoteSummary {
  filePath: string;
  title: string;
  size: number;
  modifiedAt: string;
  tags: string[];
}

export interface VaultNoteDocument extends VaultNoteSummary {
  content: string;
  parsedCards?: ParsedCrashCard[];
  parseDiagnostics?: CardParseDiagnostic[];
  cardSync?: CardSyncSummary | null;
}

export interface VaultDescriptor {
  rootPath: string;
  indexFilePath: string;
  notes: VaultNoteSummary[];
  index: VaultIndex;
  cardStore?: CardStoreConfig;
  imageDirectories: string[];
  lastCardSync?: CardSyncSummary | null;
  lastCardRebuild?: CardRebuildSummary | null;
}

export interface VaultWriteNoteInput {
  filePath: string;
  content: string;
}

export interface VaultWriteNoteResult {
  note: VaultNoteDocument;
  vault: VaultDescriptor;
}
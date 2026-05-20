export interface ReviewMetadata {
  familiarity: number;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  intervalDays: number;
  repetition: number;
  easeFactor: number;
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
}

export interface VaultDescriptor {
  rootPath: string;
  indexFilePath: string;
  notes: VaultNoteSummary[];
  index: VaultIndex;
}

export interface VaultWriteNoteInput {
  filePath: string;
  content: string;
}

export interface VaultWriteNoteResult {
  note: VaultNoteDocument;
  vault: VaultDescriptor;
}
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

export type WeaveKind = 'guided-insert' | 'intelligent';

export type WeaveStrength = 'light' | 'standard' | 'go-ham';

export interface GuidedInsertPermissions {
  editContent: boolean;
  createNote: boolean;
}

export type WeavePlanOperationKind =
  | 'insert-boundary-pair'
  | 'edit-note-content'
  | 'create-note'
  | 'rename-note'
  | 'move-note'
  | 'delete-note'
  | 'create-directory'
  | 'rename-directory'
  | 'move-directory'
  | 'delete-directory';

export type WeaveErrorCategory =
  | 'config-error'
  | 'auth-error'
  | 'rate-limit'
  | 'provider-timeout'
  | 'provider-error'
  | 'schema-error'
  | 'safety-error';

export type WeaveProviderName = 'stub' | 'openrouter';

export type WeaveInsertPlacement =
  | 'append-to-note'
  | 'prepend-to-note'
  | 'after-heading'
  | 'before-heading'
  | 'after-selection';

export type WeaveNoteEditAction =
  | 'replace-selection'
  | 'replace-heading-section'
  | 'insert-before-heading'
  | 'insert-after-heading';

export interface InsertBoundaryPairPayload {
  cardUid: string;
  placement: WeaveInsertPlacement;
  boundaryBlock: string;
  headingText?: string;
  selectedText?: string;
}

export interface EditNoteContentPayload {
  action: WeaveNoteEditAction;
  targetText: string;
  replacementMarkdown: string;
}

export interface CreateNotePayload {
  cardUid: string;
  title: string;
  content: string;
}

export interface RenameNotePayload {
  fromPath: string;
  toPath: string;
  renameReason: string;
}

export interface MoveNotePayload {
  fromPath: string;
  toPath: string;
  moveReason: string;
}

export interface DeleteNotePayload {
  deleteReason: string;
}

export interface CreateDirectoryPayload {
  purpose: string;
}

export interface RenameDirectoryPayload {
  fromPath: string;
  toPath: string;
  renameReason: string;
}

export interface MoveDirectoryPayload {
  fromPath: string;
  toPath: string;
  moveReason: string;
}

export interface DeleteDirectoryPayload {
  deleteReason: string;
}

interface WeavePlanRequestBase {
  rootPath: string;
  kind: WeaveKind;
  preferredModel?: string;
  intent: string;
  cardUid: string;
  activeNotePath?: string;
  activeCrashpadId: string;
  activeCrashpadPath: string;
  selectedText?: string;
  maxOperations?: number;
}

export interface GuidedInsertWeavePlanRequest extends WeavePlanRequestBase {
  kind: 'guided-insert';
  permissions: GuidedInsertPermissions;
}

export interface IntelligentWeavePlanRequest extends WeavePlanRequestBase {
  kind: 'intelligent';
  strength: WeaveStrength;
}

export type WeavePlanRequest = GuidedInsertWeavePlanRequest | IntelligentWeavePlanRequest;

interface WeavePlanOperationBase<K extends WeavePlanOperationKind, P> {
  kind: K;
  targetPath: string;
  payload: P;
  rationale: string;
}

export type InsertBoundaryPairOperation = WeavePlanOperationBase<'insert-boundary-pair', InsertBoundaryPairPayload>;
export type EditNoteContentOperation = WeavePlanOperationBase<'edit-note-content', EditNoteContentPayload>;
export type CreateNoteOperation = WeavePlanOperationBase<'create-note', CreateNotePayload>;
export type RenameNoteOperation = WeavePlanOperationBase<'rename-note', RenameNotePayload>;
export type MoveNoteOperation = WeavePlanOperationBase<'move-note', MoveNotePayload>;
export type DeleteNoteOperation = WeavePlanOperationBase<'delete-note', DeleteNotePayload>;
export type CreateDirectoryOperation = WeavePlanOperationBase<'create-directory', CreateDirectoryPayload>;
export type RenameDirectoryOperation = WeavePlanOperationBase<'rename-directory', RenameDirectoryPayload>;
export type MoveDirectoryOperation = WeavePlanOperationBase<'move-directory', MoveDirectoryPayload>;
export type DeleteDirectoryOperation = WeavePlanOperationBase<'delete-directory', DeleteDirectoryPayload>;

export type WeavePlanOperation =
  | InsertBoundaryPairOperation
  | EditNoteContentOperation
  | CreateNoteOperation
  | RenameNoteOperation
  | MoveNoteOperation
  | DeleteNoteOperation
  | CreateDirectoryOperation
  | RenameDirectoryOperation
  | MoveDirectoryOperation
  | DeleteDirectoryOperation;

interface WeavePlanBase {
  summary: string;
  operations: WeavePlanOperation[];
  warnings: string[];
  referencedCards: string[];
}

export interface GuidedInsertWeavePlan extends WeavePlanBase {
  kind: 'guided-insert';
  permissions: GuidedInsertPermissions;
}

export interface IntelligentWeavePlan extends WeavePlanBase {
  kind: 'intelligent';
  strength: WeaveStrength;
}

export type WeavePlan = GuidedInsertWeavePlan | IntelligentWeavePlan;

export interface WeaveReActStep {
  thought?: string;
  action?: string;
  observation?: string;
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

export interface WeavePlanResult {
  plan: WeavePlan;
  model: string;
  provider: WeaveProviderName;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
  trace?: WeaveReActStep[];
}

export interface WeaveProviderHealth {
  ok: boolean;
  provider: WeaveProviderName;
  configured: boolean;
  model: string;
  message: string;
  errorCategory?: WeaveErrorCategory;
}

export interface WeaveModelInfo {
  id: string;
  name: string;
  costLabel: string;
  isFree: boolean;
  contextLength?: number;
}

export interface WeaveModelProvider {
  generatePlan(request: WeavePlanRequest): Promise<WeavePlanResult>;
  healthCheck(): Promise<WeaveProviderHealth>;
  listModels(): Promise<WeaveModelInfo[]>;
}

export interface WeaverSettings {
  configured: boolean;
  preferredModel: string | null;
  disableBudgetRestrictions?: boolean;
  guidedInsertBaseMaxTokens?: number;
  guidedInsertBaseTimeoutMs?: number;
  guidedInsertExpandedMaxTokens?: number;
  guidedInsertExpandedTimeoutMs?: number;
  intelligentLightMaxTokens?: number;
  intelligentLightTimeoutMs?: number;
  intelligentLightIterationLimit?: number;
  intelligentStandardMaxTokens?: number;
  intelligentStandardTimeoutMs?: number;
  intelligentStandardIterationLimit?: number;
  intelligentGoHamMaxTokens?: number;
  intelligentGoHamTimeoutMs?: number;
  intelligentGoHamIterationLimit?: number;
  guidedInsertMaxOperations?: number;
  intelligentLightMaxOperations?: number;
  intelligentStandardMaxOperations?: number;
  intelligentGoHamMaxOperations?: number;
}

export interface WeaverKeyStatus {
  configured: boolean;
}

// ── Stage 6: Apply result types ───────────────────────────────────────────

export interface WeaveApplyOperationResult {
  operationIndex: number;
  kind: WeavePlanOperationKind;
  targetPath: string;
  ok: boolean;
  error?: string;
  warning?: string;
  affectedPaths?: string[];
}

export interface WeaveApplyResult {
  results: WeaveApplyOperationResult[];
  allOk: boolean;
  appliedCount: number;
  failedCount: number;
  warnings: string[];
}
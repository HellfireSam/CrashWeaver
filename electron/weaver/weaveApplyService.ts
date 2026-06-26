import fs from 'node:fs/promises';
import path from 'node:path';
import { formatCardStartBoundary, formatCardEndBoundary } from '../cardParser';
import { readCardDocument, cardDocumentExists, upsertCardReference } from '../cardStoreService';
import { syncNoteToCardStore } from '../cardSyncService';
import { removeCardBoundariesAcrossReferences, renameCardBoundariesAcrossReferences } from '../services/cardReferenceMutationService';
import { readReferenceNoteContent, resolveReferenceNotePath } from '../services/noteReferenceMutationService';
import { writeTextAtomically } from '../utils/jsonFile';
import { toPosixPath } from '../utils/paths';
import { writeJsonAtomically } from '../utils/jsonFile';
import { getCardFilePath } from '../cardStoreService';
import { getFsErrorCode } from '../utils/fsErrors';
import { parseCrashCardsFromNote } from '../cardParser';
import type {
  WeavePlanOperation,
  WeavePlanOperationKind,
  InsertBoundaryPairPayload,
  EditNoteContentPayload,
  CreateNotePayload,
  RenameNotePayload,
  MoveNotePayload,
  DeleteNotePayload,
  CreateDirectoryPayload,
  RenameDirectoryPayload,
  MoveDirectoryPayload,
  DeleteDirectoryPayload,
} from '../vault-contract';

// ── Result types (mirrored in vault-contract.ts) ─────────────────────────────

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

export interface WeaveApplyOptions {
  /** If true, validate operations but don't write anything. Default false. */
  dryRun?: boolean;
  /** If true, stop executing on the first failure. Default true. */
  stopOnError?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function assertWithinVault(resolvedRoot: string, targetPath: string): string {
  const absolute = path.resolve(resolvedRoot, targetPath);
  const relative = path.relative(resolvedRoot, absolute);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes vault root: ${targetPath}`);
  }

  return absolute;
}

async function assertNoteExists(absolutePath: string): Promise<void> {
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${absolutePath}`);
    }
  } catch (error) {
    if (getFsErrorCode(error) === 'ENOENT') {
      throw new Error(`Note not found: ${absolutePath}`);
    }
    throw error;
  }
}

/**
 * Verifies that all %%CW_CARD_START/END%% pairs in the content are balanced.
 * Throws if any diagnostic with severity 'error' is found.
 */
function verifyBoundaryIntegrity(content: string, label: string): void {
  const parsed = parseCrashCardsFromNote(label, content);

  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    const messages = errors.map((d) => `[${d.code}] ${d.message}${d.uid ? ` (uid: ${d.uid})` : ''}`);
    throw new Error(
      `Boundary integrity check failed for ${label}: ${messages.join('; ')}`,
    );
  }
}

function buildOperationWarning(operation: WeavePlanOperation, message: string): string {
  return `[${operation.kind}] ${operation.targetPath}: ${message}`;
}

// ── Per-operation handlers ──────────────────────────────────────────────────

async function applyInsertBoundaryPair(
  resolvedRoot: string,
  cardStorePath: string,
  targetPath: string,
  payload: InsertBoundaryPairPayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  const absolutePath = assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  await assertNoteExists(absolutePath);
  const noteContent = await fs.readFile(absolutePath, 'utf8');
  const lines = noteContent.replace(/\r\n/g, '\n').split('\n');

  const boundaryBlock = payload.boundaryBlock ?? '';

  // The LLM already includes %%CW_CARD_START/END%% markers in boundaryBlock
  // per the prompt contract. Do NOT re-wrap — use the block as-is.
  const blockLines = boundaryBlock.trim()
    ? boundaryBlock.replace(/\r\n/g, '\n').split('\n')
    : [formatCardStartBoundary(payload.cardUid), formatCardEndBoundary(payload.cardUid)];

  let insertIndex: number;
  const placement = payload.placement;

  switch (placement) {
    case 'prepend-to-note': {
      insertIndex = 0;
      break;
    }
    case 'append-to-note': {
      insertIndex = lines.length;
      break;
    }
    case 'after-heading': {
      const headingText = payload.headingText ?? '';
      const headingRegex = new RegExp(`^#{1,6}\\s+${headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      const headingIndex = lines.findIndex((line) => headingRegex.test(line));
      if (headingIndex === -1) {
        // Fallback: append to end if heading not found
        insertIndex = lines.length;
        return {
          ok: true,
          warning: buildOperationWarning(
            { kind: 'insert-boundary-pair', targetPath, payload, rationale: '' } as WeavePlanOperation,
            `Heading "${headingText}" not found; appended to end of note.`,
          ),
          affectedPaths: [targetPath],
        };
      }
      // Insert after the heading line (and its following blank line if present)
      insertIndex = headingIndex + 1;
      if (insertIndex < lines.length && lines[insertIndex].trim() === '') {
        insertIndex += 1;
      }
      break;
    }
    case 'before-heading': {
      const headingText = payload.headingText ?? '';
      const headingRegex = new RegExp(`^#{1,6}\\s+${headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      const headingIndex = lines.findIndex((line) => headingRegex.test(line));
      if (headingIndex === -1) {
        insertIndex = 0;
        return {
          ok: true,
          warning: buildOperationWarning(
            { kind: 'insert-boundary-pair', targetPath, payload, rationale: '' } as WeavePlanOperation,
            `Heading "${headingText}" not found; prepended to note.`,
          ),
          affectedPaths: [targetPath],
        };
      }
      insertIndex = headingIndex;
      break;
    }
    case 'after-selection': {
      const selectedText = payload.selectedText ?? '';
      if (!selectedText.trim()) {
        insertIndex = lines.length;
        break;
      }
      const selectionLines = selectedText.replace(/\r\n/g, '\n').split('\n');
      // Find the last line of the selection in the note
      let foundIndex = -1;
      for (let i = 0; i <= lines.length - selectionLines.length; i += 1) {
        let matches = true;
        for (let j = 0; j < selectionLines.length; j += 1) {
          if (lines[i + j] !== selectionLines[j]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          foundIndex = i + selectionLines.length;
          break;
        }
      }
      if (foundIndex === -1) {
        insertIndex = lines.length;
        return {
          ok: true,
          warning: buildOperationWarning(
            { kind: 'insert-boundary-pair', targetPath, payload, rationale: '' } as WeavePlanOperation,
            'Selected text not found in note; appended to end.',
          ),
          affectedPaths: [targetPath],
        };
      }
      insertIndex = foundIndex;
      break;
    }
    default: {
      insertIndex = lines.length;
      break;
    }
  }

  // Insert the block lines at the computed position
  const nextLines = [...lines];
  nextLines.splice(insertIndex, 0, ...blockLines);
  const nextContent = nextLines.join('\n');

  // Verify boundary integrity after insertion
  verifyBoundaryIntegrity(nextContent, targetPath);

  await writeTextAtomically(absolutePath, nextContent);
  await syncNoteToCardStore(cardStorePath, targetPath, nextContent);

  return { ok: true, affectedPaths: [targetPath] };
}

async function applyEditNoteContent(
  resolvedRoot: string,
  cardStorePath: string,
  targetPath: string,
  payload: EditNoteContentPayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  const absolutePath = assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  await assertNoteExists(absolutePath);
  const noteContent = await fs.readFile(absolutePath, 'utf8');

  const targetText = payload.targetText;
  const replacement = payload.replacementMarkdown;

  if (!noteContent.includes(targetText)) {
    // Try normalized comparison (normalize line endings)
    const normalizedContent = noteContent.replace(/\r\n/g, '\n');
    const normalizedTarget = targetText.replace(/\r\n/g, '\n');
    if (!normalizedContent.includes(normalizedTarget)) {
      throw new Error(
        `Target text not found in note "${targetPath}". The note may have been modified since the plan was generated.`,
      );
    }
    // Use normalized versions
    const escapedTarget = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nextContent = normalizedContent.replace(new RegExp(escapedTarget, 'g'), replacement);
    verifyBoundaryIntegrity(nextContent, targetPath);
    await writeTextAtomically(absolutePath, nextContent);
    await syncNoteToCardStore(cardStorePath, targetPath, nextContent);
    return { ok: true, affectedPaths: [targetPath] };
  }

  const escapedTarget = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nextContent = noteContent.replace(new RegExp(escapedTarget, 'g'), replacement);

  verifyBoundaryIntegrity(nextContent, targetPath);

  await writeTextAtomically(absolutePath, nextContent);
  await syncNoteToCardStore(cardStorePath, targetPath, nextContent);

  return { ok: true, affectedPaths: [targetPath] };
}

async function applyCreateNote(
  resolvedRoot: string,
  cardStorePath: string,
  targetPath: string,
  payload: CreateNotePayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  const absolutePath = assertWithinVault(resolvedRoot, targetPath);
  const affectedPaths = [targetPath];

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  // Check if note already exists
  let noteExists = false;
  try {
    await fs.stat(absolutePath);
    noteExists = true;
  } catch (error) {
    if (getFsErrorCode(error) !== 'ENOENT') throw error;
  }

  if (noteExists) {
    throw new Error(`Note already exists: ${targetPath}`);
  }

  // Build note content — no forced boundary injection.
  // The LLM may choose to include boundary markers in payload.content,
  // but they are never appended by the system.
  const noteLines = [
    `# ${payload.title}`,
    '',
    payload.content,
  ];
  const noteContent = noteLines.join('\n');

  // Create parent directories
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  // Write the note
  await writeTextAtomically(absolutePath, noteContent);
  await syncNoteToCardStore(cardStorePath, targetPath, noteContent);

  // Auto-create the card JSON if it doesn't exist
  const cardExists = await cardDocumentExists(cardStorePath, payload.cardUid);
  if (!cardExists) {
    const cardFilePath = getCardFilePath(cardStorePath, payload.cardUid);
    const defaultCard = {
      uid: payload.cardUid,
      type: [] as string[],
      raw_content: '',
      metadata: {
        familiarity: 0,
        next_review: null as string | null,
      },
      memory_tricks: {
        memory_technique: '',
        qa_pairs: [] as { q: string; a: string }[],
      },
      referenced_in: [
        {
          note_path: targetPath,
          start_line: 1,
          end_line: noteLines.length,
        },
      ],
    };
    await writeJsonAtomically(cardFilePath, defaultCard);
    affectedPaths.push(toPosixPath(path.relative(resolvedRoot, cardFilePath)));
  }

  return { ok: true, affectedPaths };
}

async function applyRenameNote(
  resolvedRoot: string,
  cardStorePath: string,
  _targetPath: string,
  payload: RenameNotePayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  const fromAbsolute = assertWithinVault(resolvedRoot, payload.fromPath);
  const toAbsolute = assertWithinVault(resolvedRoot, payload.toPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [payload.fromPath, payload.toPath] };
  }

  await assertNoteExists(fromAbsolute);

  // Check that target doesn't already exist
  try {
    await fs.stat(toAbsolute);
    throw new Error(`Target path already exists: ${payload.toPath}`);
  } catch (error) {
    if (getFsErrorCode(error) !== 'ENOENT') throw error;
  }

  // Create target directory if needed
  await fs.mkdir(path.dirname(toAbsolute), { recursive: true });

  // Read the note content before moving (needed for card UID extraction)
  const noteContent = await fs.readFile(fromAbsolute, 'utf8');
  const parsedNote = parseCrashCardsFromNote(payload.fromPath, noteContent);
  const cardUidsInNote = parsedNote.cards.map((c) => c.uid);

  // Rename the file
  await fs.rename(fromAbsolute, toAbsolute);

  const fromRelative = payload.fromPath;
  const toRelative = payload.toPath;

  // Update referenced_in paths in all cards that reference the old note path.
  // Use readCardDocument to preserve ALL card fields (type, raw_content, etc.).
  for (const uid of cardUidsInNote) {
    const card = await readCardDocument(cardStorePath, uid);
    if (!card) continue;

    const refIndex = card.referenced_in.findIndex((r) => r.note_path === fromRelative);
    if (refIndex === -1) continue;

    card.referenced_in[refIndex] = {
      ...card.referenced_in[refIndex],
      note_path: toRelative,
    };
    await writeJsonAtomically(getCardFilePath(cardStorePath, uid), card);
  }

  return { ok: true, affectedPaths: [payload.fromPath, payload.toPath] };
}

async function applyMoveNote(
  resolvedRoot: string,
  cardStorePath: string,
  targetPath: string,
  payload: MoveNotePayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  // Move is functionally the same as rename (both are path changes)
  return applyRenameNote(
    resolvedRoot,
    cardStorePath,
    targetPath,
    {
      fromPath: payload.fromPath,
      toPath: payload.toPath,
      renameReason: payload.moveReason,
    },
    dryRun,
  );
}

async function applyDeleteNote(
  resolvedRoot: string,
  cardStorePath: string,
  targetPath: string,
  payload: DeleteNotePayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  const absolutePath = assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  await assertNoteExists(absolutePath);

  // Read the note to find all card UIDs referenced within it
  let noteContent: string;
  try {
    noteContent = await fs.readFile(absolutePath, 'utf8');
  } catch {
    throw new Error(`Cannot read note for boundary removal: ${targetPath}`);
  }

  const parsedNote = parseCrashCardsFromNote(targetPath, noteContent);
  const cardUids = parsedNote.cards.map((c) => c.uid);

  // Remove this note's references from all referenced cards
  for (const uid of cardUids) {
    const card = await readCardDocument(cardStorePath, uid);
    if (card) {
      const nextReferences = card.referenced_in.filter((r) => r.note_path !== targetPath);
      if (nextReferences.length !== card.referenced_in.length) {
        card.referenced_in = nextReferences;
        await writeJsonAtomically(getCardFilePath(cardStorePath, uid), card);
      }
    }
  }

  // Delete the note file
  await fs.rm(absolutePath, { force: true });

  return { ok: true, affectedPaths: [targetPath] };
}

async function applyCreateDirectory(
  resolvedRoot: string,
  _cardStorePath: string,
  targetPath: string,
  payload: CreateDirectoryPayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  const absolutePath = assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  await fs.mkdir(absolutePath, { recursive: true });

  return { ok: true, affectedPaths: [targetPath] };
}

async function applyRenameDirectory(
  resolvedRoot: string,
  _cardStorePath: string,
  targetPath: string,
  payload: RenameDirectoryPayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  const fromAbsolute = assertWithinVault(resolvedRoot, payload.fromPath);
  const toAbsolute = assertWithinVault(resolvedRoot, payload.toPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [payload.fromPath, payload.toPath] };
  }

  try {
    await fs.stat(fromAbsolute);
  } catch (error) {
    if (getFsErrorCode(error) === 'ENOENT') {
      throw new Error(`Directory not found: ${payload.fromPath}`);
    }
    throw error;
  }

  // Check target doesn't exist
  try {
    await fs.stat(toAbsolute);
    throw new Error(`Target directory already exists: ${payload.toPath}`);
  } catch (error) {
    if (getFsErrorCode(error) !== 'ENOENT') throw error;
  }

  // Create parent of target if needed
  await fs.mkdir(path.dirname(toAbsolute), { recursive: true });

  await fs.rename(fromAbsolute, toAbsolute);

  return { ok: true, affectedPaths: [payload.fromPath, payload.toPath] };
}

async function applyMoveDirectory(
  resolvedRoot: string,
  cardStorePath: string,
  targetPath: string,
  payload: MoveDirectoryPayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  return applyRenameDirectory(
    resolvedRoot,
    cardStorePath,
    targetPath,
    {
      fromPath: payload.fromPath,
      toPath: payload.toPath,
      renameReason: payload.moveReason,
    },
    dryRun,
  );
}

async function applyDeleteDirectory(
  resolvedRoot: string,
  _cardStorePath: string,
  targetPath: string,
  payload: DeleteDirectoryPayload,
  dryRun: boolean,
): Promise<Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>> {
  const absolutePath = assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  try {
    await fs.stat(absolutePath);
  } catch (error) {
    if (getFsErrorCode(error) === 'ENOENT') {
      throw new Error(`Directory not found: ${targetPath}`);
    }
    throw error;
  }

  // Check if directory is non-empty and warn
  const entries = await fs.readdir(absolutePath);
  const warning = entries.length > 0
    ? buildOperationWarning(
        { kind: 'delete-directory', targetPath, payload, rationale: '' } as WeavePlanOperation,
        `Directory contains ${entries.length} item(s); they will be permanently deleted.`,
      )
    : undefined;

  await fs.rm(absolutePath, { recursive: true, force: true });

  return { ok: true, warning, affectedPaths: [targetPath] };
}

// ── Main apply orchestration ────────────────────────────────────────────────

export async function applyWeaveOperations(
  resolvedRoot: string,
  cardStorePath: string,
  operations: WeavePlanOperation[],
  options: WeaveApplyOptions = {},
): Promise<WeaveApplyResult> {
  const { dryRun = false, stopOnError = true } = options;
  const results: WeaveApplyOperationResult[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < operations.length; i += 1) {
    const operation = operations[i];
    const targetPath = operation.targetPath;

    try {
      let result: Pick<WeaveApplyOperationResult, 'ok' | 'error' | 'warning' | 'affectedPaths'>;

      switch (operation.kind) {
        case 'insert-boundary-pair':
          result = await applyInsertBoundaryPair(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as InsertBoundaryPairPayload, dryRun,
          );
          break;
        case 'edit-note-content':
          result = await applyEditNoteContent(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as EditNoteContentPayload, dryRun,
          );
          break;
        case 'create-note':
          result = await applyCreateNote(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as CreateNotePayload, dryRun,
          );
          break;
        case 'rename-note':
          result = await applyRenameNote(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as RenameNotePayload, dryRun,
          );
          break;
        case 'move-note':
          result = await applyMoveNote(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as MoveNotePayload, dryRun,
          );
          break;
        case 'delete-note':
          result = await applyDeleteNote(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as DeleteNotePayload, dryRun,
          );
          break;
        case 'create-directory':
          result = await applyCreateDirectory(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as CreateDirectoryPayload, dryRun,
          );
          break;
        case 'rename-directory':
          result = await applyRenameDirectory(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as RenameDirectoryPayload, dryRun,
          );
          break;
        case 'move-directory':
          result = await applyMoveDirectory(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as MoveDirectoryPayload, dryRun,
          );
          break;
        case 'delete-directory':
          result = await applyDeleteDirectory(
            resolvedRoot, cardStorePath, targetPath,
            operation.payload as DeleteDirectoryPayload, dryRun,
          );
          break;
        default:
          result = {
            ok: false,
            error: `Unknown operation kind: ${(operation as WeavePlanOperation).kind}`,
          };
      }

      if (result.warning) {
        warnings.push(result.warning);
      }

      results.push({
        operationIndex: i,
        kind: operation.kind,
        targetPath,
        ok: result.ok,
        error: result.error,
        warning: result.warning,
        affectedPaths: result.affectedPaths,
      });

      if (!result.ok && stopOnError) {
        // Mark remaining operations as skipped
        for (let j = i + 1; j < operations.length; j += 1) {
          results.push({
            operationIndex: j,
            kind: operations[j].kind,
            targetPath: operations[j].targetPath,
            ok: false,
            error: 'Skipped due to previous failure.',
          });
        }
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during apply.';
      results.push({
        operationIndex: i,
        kind: operation.kind,
        targetPath,
        ok: false,
        error: message,
      });

      if (stopOnError) {
        for (let j = i + 1; j < operations.length; j += 1) {
          results.push({
            operationIndex: j,
            kind: operations[j].kind,
            targetPath: operations[j].targetPath,
            ok: false,
            error: 'Skipped due to previous failure.',
          });
        }
        break;
      }
    }
  }

  const appliedCount = results.filter((r) => r.ok).length;
  const failedCount = results.filter((r) => !r.ok).length;

  return {
    results,
    allOk: failedCount === 0,
    appliedCount,
    failedCount,
    warnings,
  };
}

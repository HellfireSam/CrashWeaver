import fs from 'node:fs/promises';
import path from 'node:path';
import { formatCardEndBoundary, formatCardStartBoundary } from '../cardParser';
import { assertValidCardUid, cardDocumentExists, getCardFilePath } from '../cardStoreService';
import { syncNoteToCardStore } from '../cardSyncService';
import { getFsErrorCode } from '../utils/fsErrors';
import { writeJsonAtomically, writeTextAtomically } from '../utils/jsonFile';
import { toPosixPath } from '../utils/paths';
import type {
  CreateNoteOperation,
  EditNoteContentOperation,
  InsertBoundaryPairOperation,
} from '../vault-contract';
import {
  buildOperationWarning,
  type WeaveApplyContext,
  type WeaveApplyHandlerResult,
} from './weaveApplyHandlerContract';
import { assertNoteExists, assertWithinVault, verifyBoundaryIntegrity } from './weaveApplyGuards';

// ── Note-content handlers ───────────────────────────────────────────────────
//
// These handlers change what a note says: they splice or replace text and then
// sync the note to the card store. Insert and edit check boundary integrity
// through `verifyBoundaryIntegrity` before writing, so a weave cannot leave a
// malformed pair behind; create writes the note content the plan authored.

/**
 * Verifies boundary integrity, writes the note and syncs it to the card store.
 * Insert and edit share this tail, so neither can write a note without running
 * the integrity check first.
 */
async function writeNoteAndSync(
  cardStorePath: string,
  targetPath: string,
  absolutePath: string,
  nextContent: string,
): Promise<void> {
  verifyBoundaryIntegrity(nextContent, targetPath);
  await writeTextAtomically(absolutePath, nextContent);
  await syncNoteToCardStore(cardStorePath, targetPath, nextContent);
}

export async function applyInsertBoundaryPair(
  context: WeaveApplyContext,
  operation: InsertBoundaryPairOperation,
): Promise<WeaveApplyHandlerResult> {
  const { resolvedRoot, cardStorePath, dryRun } = context;
  const targetPath = operation.targetPath;
  const payload = operation.payload;
  const absolutePath = await assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  // Fail closed on a UID the card store would reject: the boundary formatter
  // would otherwise write a traversal UID into the note before the store's
  // path guard could stop the write.
  const cardUid = assertValidCardUid(payload.cardUid);

  await assertNoteExists(absolutePath);
  const noteContent = await fs.readFile(absolutePath, 'utf8');
  const lines = noteContent.replace(/\r\n/g, '\n').split('\n');

  const boundaryBlock = payload.boundaryBlock ?? '';

  // The LLM already includes %%CW_CARD_START/END%% markers in boundaryBlock
  // per the prompt contract. Do NOT re-wrap — use the block as-is.
  const blockLines = boundaryBlock.trim()
    ? boundaryBlock.replace(/\r\n/g, '\n').split('\n')
    : [formatCardStartBoundary(cardUid), formatCardEndBoundary(cardUid)];

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
      const headingRegex = new RegExp(
        `^#{1,6}\\s+${headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      );
      const headingIndex = lines.findIndex((line) => headingRegex.test(line));
      if (headingIndex === -1) {
        // Fallback: append to end if heading not found
        return {
          ok: true,
          warning: buildOperationWarning(
            operation,
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
      const headingRegex = new RegExp(
        `^#{1,6}\\s+${headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      );
      const headingIndex = lines.findIndex((line) => headingRegex.test(line));
      if (headingIndex === -1) {
        return {
          ok: true,
          warning: buildOperationWarning(
            operation,
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
        return {
          ok: true,
          warning: buildOperationWarning(
            operation,
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

  await writeNoteAndSync(cardStorePath, targetPath, absolutePath, nextContent);

  return { ok: true, affectedPaths: [targetPath] };
}

export async function applyEditNoteContent(
  context: WeaveApplyContext,
  operation: EditNoteContentOperation,
): Promise<WeaveApplyHandlerResult> {
  const { resolvedRoot, cardStorePath, dryRun } = context;
  const targetPath = operation.targetPath;
  const payload = operation.payload;
  const absolutePath = await assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  await assertNoteExists(absolutePath);
  const noteContent = await fs.readFile(absolutePath, 'utf8');

  const targetText = payload.targetText;
  const replacement = payload.replacementMarkdown;

  // A note written on another platform may not match the planned target text
  // byte for byte. Fall back to the line-ending-normalised copy, and fail rather
  // than clobber the note when neither contains the target.
  const hasRawTarget = noteContent.includes(targetText);
  const normalizedTarget = targetText.replace(/\r\n/g, '\n');
  const contentToEdit = hasRawTarget ? noteContent : noteContent.replace(/\r\n/g, '\n');

  if (!hasRawTarget && !contentToEdit.includes(normalizedTarget)) {
    throw new Error(
      `Target text not found in note "${targetPath}". The note may have been modified since the plan was generated.`,
    );
  }

  const textToReplace = hasRawTarget ? targetText : normalizedTarget;
  const escapedTarget = textToReplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nextContent = contentToEdit.replace(new RegExp(escapedTarget, 'g'), replacement);

  await writeNoteAndSync(cardStorePath, targetPath, absolutePath, nextContent);

  return { ok: true, affectedPaths: [targetPath] };
}

export async function applyCreateNote(
  context: WeaveApplyContext,
  operation: CreateNoteOperation,
): Promise<WeaveApplyHandlerResult> {
  const { resolvedRoot, cardStorePath, dryRun } = context;
  const targetPath = operation.targetPath;
  const payload = operation.payload;
  const absolutePath = await assertWithinVault(resolvedRoot, targetPath);
  const affectedPaths = [targetPath];

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  // Fail closed before the note write and the store sync can touch anything:
  // the card this note is created for must be a UID the card store accepts.
  const cardUid = assertValidCardUid(payload.cardUid);

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
  const noteLines = [`# ${payload.title}`, '', payload.content];
  const noteContent = noteLines.join('\n');

  // Create parent directories
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  // Write the note
  await writeTextAtomically(absolutePath, noteContent);
  await syncNoteToCardStore(cardStorePath, targetPath, noteContent);

  // Auto-create the card JSON if it doesn't exist
  const cardExists = await cardDocumentExists(cardStorePath, cardUid);
  if (!cardExists) {
    const cardFilePath = getCardFilePath(cardStorePath, cardUid);
    const defaultCard = {
      uid: cardUid,
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

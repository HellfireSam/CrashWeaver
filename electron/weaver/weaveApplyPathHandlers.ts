import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCrashCardsFromNote } from '../cardParser';
import { getCardFilePath, readCardDocument } from '../cardStoreService';
import { getFsErrorCode } from '../utils/fsErrors';
import { writeJsonAtomically } from '../utils/jsonFile';
import type {
  CreateDirectoryOperation,
  DeleteDirectoryOperation,
  DeleteNoteOperation,
  MoveDirectoryOperation,
  MoveNoteOperation,
  RenameDirectoryOperation,
  RenameDirectoryPayload,
  RenameNoteOperation,
  RenameNotePayload,
} from '../vault-contract';
import {
  buildOperationWarning,
  type WeaveApplyContext,
  type WeaveApplyHandlerResult,
} from './weaveApplyHandlerContract';
import { assertNoteExists, assertWithinVault, verifyBoundaryIntegrity } from './weaveApplyGuards';

// The card-to-note mutation services in `services/` are deliberately not imported
// here. They look like the obvious de-duplication of the note-to-card delete and
// rename paths below, but wiring them in would be destructive: those services
// walk card -> references, while the paths here walk note -> cards, so swapping
// them would strip a deleted card's boundaries from every *other* note and drop
// all reference pruning. Reconciling the two directions is ticket #22, not a
// tidy-up.

// ── Path-mutation handlers ──────────────────────────────────────────────────
//
// These handlers move or remove paths and prune the card references that point
// at them. They read notes directly and never rewrite note prose, which is the
// direction that distinguishes them from the `services/` mutations named above.

/**
 * Renames a note and rewrites `referenced_in` paths on the cards whose boundary
 * UIDs appear in the renamed note. A rename and a move differ only in intent and
 * the reason they record, so both go through this function.
 */
async function renameNoteAtPath(
  context: WeaveApplyContext,
  payload: RenameNotePayload,
): Promise<WeaveApplyHandlerResult> {
  const { resolvedRoot, cardStorePath, dryRun } = context;
  const fromAbsolute = await assertWithinVault(resolvedRoot, payload.fromPath);
  const toAbsolute = await assertWithinVault(resolvedRoot, payload.toPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [payload.fromPath, payload.toPath] };
  }

  await assertNoteExists(fromAbsolute);

  // Read and verify the source before touching the destination, so a malformed
  // note is reported instead of moved. The other path mutations need the note
  // content anyway, so integrity is checked on the content this handler reads.
  const noteContent = await fs.readFile(fromAbsolute, 'utf8');
  verifyBoundaryIntegrity(noteContent, payload.fromPath);

  // Check that target doesn't already exist
  try {
    await fs.stat(toAbsolute);
    throw new Error(`Target path already exists: ${payload.toPath}`);
  } catch (error) {
    if (getFsErrorCode(error) !== 'ENOENT') throw error;
  }

  // Create target directory if needed
  await fs.mkdir(path.dirname(toAbsolute), { recursive: true });

  // Card UIDs are extracted from the content read before the rename.
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

    // A card is meant to hold at most one reference per note path, but the
    // field is user-editable JSON and nothing enforces that invariant. Rewrite
    // every matching entry: leaving a duplicate behind would point half the
    // card at a path that no longer exists.
    let updatedReference = false;
    card.referenced_in = card.referenced_in.map((reference) => {
      if (reference.note_path !== fromRelative) {
        return reference;
      }

      updatedReference = true;
      return { ...reference, note_path: toRelative };
    });

    if (!updatedReference) continue;

    await writeJsonAtomically(getCardFilePath(cardStorePath, uid), card);
  }

  return { ok: true, affectedPaths: [payload.fromPath, payload.toPath] };
}

export async function applyRenameNote(
  context: WeaveApplyContext,
  operation: RenameNoteOperation,
): Promise<WeaveApplyHandlerResult> {
  return renameNoteAtPath(context, operation.payload);
}

export async function applyMoveNote(
  context: WeaveApplyContext,
  operation: MoveNoteOperation,
): Promise<WeaveApplyHandlerResult> {
  // Move is functionally the same as rename (both are path changes)
  return renameNoteAtPath(context, {
    fromPath: operation.payload.fromPath,
    toPath: operation.payload.toPath,
    renameReason: operation.payload.moveReason,
  });
}

export async function applyDeleteNote(
  context: WeaveApplyContext,
  operation: DeleteNoteOperation,
): Promise<WeaveApplyHandlerResult> {
  const { resolvedRoot, cardStorePath, dryRun } = context;
  const targetPath = operation.targetPath;
  const absolutePath = await assertWithinVault(resolvedRoot, targetPath);

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

  // The note is about to be removed, so a malformed boundary must be reported
  // before any reference is pruned; otherwise the malformed note would be
  // deleted without ever telling the user what was wrong with it.
  verifyBoundaryIntegrity(noteContent, targetPath);

  const parsedNote = parseCrashCardsFromNote(targetPath, noteContent);
  const cardUids = parsedNote.cards.map((c) => c.uid);

  // Remove this note's references from all referenced cards
  const orphanedCardUids: string[] = [];
  for (const uid of cardUids) {
    const card = await readCardDocument(cardStorePath, uid);
    if (card) {
      const nextReferences = card.referenced_in.filter((r) => r.note_path !== targetPath);
      if (nextReferences.length !== card.referenced_in.length) {
        card.referenced_in = nextReferences;
        await writeJsonAtomically(getCardFilePath(cardStorePath, uid), card);
      }
      if (nextReferences.length === 0) {
        orphanedCardUids.push(uid);
      }
    }
  }

  // Delete the note file
  await fs.rm(absolutePath, { force: true });

  const warning =
    orphanedCardUids.length > 0
      ? buildOperationWarning(
          operation,
          `Card(s) ${orphanedCardUids.join(', ')} no longer referenced in any note. Card JSON file(s) preserved in card store — delete manually if no longer needed.`,
        )
      : undefined;

  return { ok: true, warning, affectedPaths: [targetPath] };
}

export async function applyCreateDirectory(
  context: WeaveApplyContext,
  operation: CreateDirectoryOperation,
): Promise<WeaveApplyHandlerResult> {
  const { resolvedRoot, dryRun } = context;
  const targetPath = operation.targetPath;
  const absolutePath = await assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  await fs.mkdir(absolutePath, { recursive: true });

  return { ok: true, affectedPaths: [targetPath] };
}

/** Renames a directory; a directory move differs only in intent and reason. */
async function renameDirectoryAtPath(
  context: WeaveApplyContext,
  payload: RenameDirectoryPayload,
): Promise<WeaveApplyHandlerResult> {
  const { resolvedRoot, dryRun } = context;
  const fromAbsolute = await assertWithinVault(resolvedRoot, payload.fromPath);
  const toAbsolute = await assertWithinVault(resolvedRoot, payload.toPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [payload.fromPath, payload.toPath] };
  }

  try {
    await fs.stat(fromAbsolute);
  } catch (error) {
    if (getFsErrorCode(error) === 'ENOENT') {
      throw new Error(`Directory not found: ${payload.fromPath}`, { cause: error });
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

export async function applyRenameDirectory(
  context: WeaveApplyContext,
  operation: RenameDirectoryOperation,
): Promise<WeaveApplyHandlerResult> {
  return renameDirectoryAtPath(context, operation.payload);
}

export async function applyMoveDirectory(
  context: WeaveApplyContext,
  operation: MoveDirectoryOperation,
): Promise<WeaveApplyHandlerResult> {
  return renameDirectoryAtPath(context, {
    fromPath: operation.payload.fromPath,
    toPath: operation.payload.toPath,
    renameReason: operation.payload.moveReason,
  });
}

export async function applyDeleteDirectory(
  context: WeaveApplyContext,
  operation: DeleteDirectoryOperation,
): Promise<WeaveApplyHandlerResult> {
  const { resolvedRoot, dryRun } = context;
  const targetPath = operation.targetPath;
  const absolutePath = await assertWithinVault(resolvedRoot, targetPath);

  if (dryRun) {
    return { ok: true, affectedPaths: [targetPath] };
  }

  try {
    await fs.stat(absolutePath);
  } catch (error) {
    if (getFsErrorCode(error) === 'ENOENT') {
      throw new Error(`Directory not found: ${targetPath}`, { cause: error });
    }
    throw error;
  }

  // Safety: refuse to delete the vault root itself
  if (absolutePath === path.resolve(resolvedRoot)) {
    throw new Error('Refusing to delete the vault root directory.');
  }

  // Check if directory is non-empty and warn
  const entries = await fs.readdir(absolutePath);
  const warning =
    entries.length > 0
      ? buildOperationWarning(
          operation,
          `Directory contains ${entries.length} item(s); they will be permanently deleted.`,
        )
      : undefined;

  await fs.rm(absolutePath, { recursive: true, force: true });

  return { ok: true, warning, affectedPaths: [targetPath] };
}

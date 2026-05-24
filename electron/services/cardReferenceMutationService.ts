import { syncNoteToCardStore } from '../cardSyncService';
import { writeTextAtomically } from '../utils/jsonFile';
import { removeCardBoundaryLines, replaceCardBoundaryUids } from './cardBoundaryService';
import { readReferenceNoteContent } from './noteReferenceMutationService';
import type { CardNoteReference } from '../vault-contract';

type RenameCardBoundariesOptions = {
  rootPath: string;
  cardStorePath: string;
  previousUid: string;
  nextUid: string;
  notePaths: string[];
};

export async function renameCardBoundariesAcrossReferences({
  rootPath,
  cardStorePath,
  previousUid,
  nextUid,
  notePaths,
}: RenameCardBoundariesOptions) {
  const updatedNotePaths: string[] = [];

  for (const notePath of notePaths) {
    const resolvedReferenceNote = await readReferenceNoteContent(rootPath, notePath);

    if (!resolvedReferenceNote) {
      continue;
    }

    const result = replaceCardBoundaryUids(resolvedReferenceNote.content, previousUid, nextUid);

    if (!result.replaced) {
      continue;
    }

    await writeTextAtomically(resolvedReferenceNote.absolutePath, result.content);
    await syncNoteToCardStore(cardStorePath, resolvedReferenceNote.relativePath, result.content);
    updatedNotePaths.push(resolvedReferenceNote.relativePath);
  }

  return updatedNotePaths;
}

type RemoveCardBoundariesOptions = {
  rootPath: string;
  cardStorePath: string;
  uid: string;
  references: CardNoteReference[];
};

export async function removeCardBoundariesAcrossReferences({
  rootPath,
  cardStorePath,
  uid,
  references,
}: RemoveCardBoundariesOptions) {
  let removedBoundariesFrom = 0;
  let removedBoundaryLines = 0;

  for (const reference of references) {
    const resolvedReferenceNote = await readReferenceNoteContent(rootPath, reference.note_path);

    if (!resolvedReferenceNote) {
      continue;
    }

    const result = removeCardBoundaryLines(resolvedReferenceNote.content, uid);

    if (result.removedBoundaryLines === 0) {
      continue;
    }

    await writeTextAtomically(resolvedReferenceNote.absolutePath, result.content);
    await syncNoteToCardStore(cardStorePath, resolvedReferenceNote.relativePath, result.content);
    removedBoundariesFrom += 1;
    removedBoundaryLines += result.removedBoundaryLines;
  }

  return {
    removedBoundariesFrom,
    removedBoundaryLines,
  };
}

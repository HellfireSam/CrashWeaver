import fs from 'node:fs/promises';
import { syncNoteToCardStore } from '../cardSyncService';
import { writeTextAtomically } from '../utils/jsonFile';
import { restoreCardBoundaryLines } from './cardBoundaryService';
import { isMissingReferenceNoteError, resolveReferenceNotePath } from './noteReferenceMutationService';
import type { CardNoteReference } from '../vault-contract';

type ReinsertCardBoundariesOptions = {
  rootPath: string;
  cardStorePath: string;
  uid: string;
  rawContent: string;
  references: CardNoteReference[];
};

export async function reinsertCardBoundariesForReferences({
  rootPath,
  cardStorePath,
  uid,
  rawContent,
  references,
}: ReinsertCardBoundariesOptions) {
  let reinsertedInto = 0;
  let alreadyPresentIn = 0;
  const skippedNotePaths: string[] = [];

  for (const reference of references) {
    const resolvedNotePath = resolveReferenceNotePath(rootPath, reference.note_path);

    if (!resolvedNotePath) {
      skippedNotePaths.push(reference.note_path);
      continue;
    }

    try {
      const existingContent = await fs.readFile(resolvedNotePath.absolutePath, 'utf8');
      const result = restoreCardBoundaryLines(
        existingContent,
        uid,
        rawContent,
        reference.start_line,
        reference.end_line,
      );
      const normalizedNotePath = resolvedNotePath.relativePath;

      if (result.alreadyPresent) {
        await syncNoteToCardStore(cardStorePath, normalizedNotePath, existingContent);
        alreadyPresentIn += 1;
        continue;
      }

      if (!result.inserted) {
        skippedNotePaths.push(normalizedNotePath);
        continue;
      }

      await writeTextAtomically(resolvedNotePath.absolutePath, result.content);
      await syncNoteToCardStore(cardStorePath, normalizedNotePath, result.content);
      reinsertedInto += 1;
    } catch (error) {
      if (isMissingReferenceNoteError(error)) {
        skippedNotePaths.push(resolvedNotePath.relativePath);
        continue;
      }

      throw error;
    }
  }

  return {
    reinsertedInto,
    alreadyPresentIn,
    skippedNotePaths,
  };
}

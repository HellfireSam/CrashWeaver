import type { CardRestoreMode, CardRestoreResult } from '../../electron/vault-contract';

export function formatCardRestoreStatus(
  uid: string,
  removeNoteBoundaries: boolean,
  mode: CardRestoreMode,
  result: CardRestoreResult,
) {
  const messages = [`Restored card ${uid}.`];

  if (!removeNoteBoundaries) {
    return messages.join(' ');
  }

  if (mode === 'forget-note-references') {
    messages.push(`Forgot ${result.forgottenReferences} saved note references.`);
    return messages.join(' ');
  }

  const linkedNoteCount = result.reinsertedInto + result.alreadyPresentIn;

  if (linkedNoteCount > 0) {
    const linkedParts: string[] = [];

    if (result.reinsertedInto > 0) {
      linkedParts.push(`${result.reinsertedInto} reinserted`);
    }

    if (result.alreadyPresentIn > 0) {
      linkedParts.push(`${result.alreadyPresentIn} already present`);
    }

    messages.push(`Linked it back into ${linkedNoteCount} notes (${linkedParts.join(', ')}).`);
  } else {
    messages.push('No saved note boundaries could be reinserted automatically.');
  }

  if (result.skippedNotePaths.length > 0) {
    messages.push(`Skipped ${result.skippedNotePaths.length} notes whose saved card block could no longer be matched.`);
  }

  return messages.join(' ');
}

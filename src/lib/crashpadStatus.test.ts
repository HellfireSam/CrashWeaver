import { describe, expect, it } from 'vitest';
import { formatCardRestoreStatus } from './crashpadStatus';

describe('formatCardRestoreStatus', () => {
  it('returns a simple message when note boundaries are not being restored', () => {
    const message = formatCardRestoreStatus('alpha', false, 'reinsert-note-boundaries', {
      uid: 'alpha',
      reinsertedInto: 0,
      alreadyPresentIn: 0,
      forgottenReferences: 0,
      skippedNotePaths: [],
    });

    expect(message).toBe('Restored card alpha.');
  });

  it('includes forgotten reference count when mode is forget-note-references', () => {
    const message = formatCardRestoreStatus('beta', true, 'forget-note-references', {
      uid: 'beta',
      reinsertedInto: 0,
      alreadyPresentIn: 0,
      forgottenReferences: 3,
      skippedNotePaths: [],
    });

    expect(message).toContain('Forgot 3 saved note references.');
  });

  it('includes linked and skipped note summaries for reinsert mode', () => {
    const message = formatCardRestoreStatus('gamma', true, 'reinsert-note-boundaries', {
      uid: 'gamma',
      reinsertedInto: 2,
      alreadyPresentIn: 1,
      forgottenReferences: 0,
      skippedNotePaths: ['a.md', 'b.md'],
    });

    expect(message).toContain('Linked it back into 3 notes (2 reinserted, 1 already present).');
    expect(message).toContain('Skipped 2 notes whose saved card block could no longer be matched.');
  });
});

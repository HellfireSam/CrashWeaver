/**
 * The one card-UID grammar.
 *
 * A card's UID is its title: the field the UI labels "Card title / ID", the
 * `<uid>.json` filename in the card store, and the literal inside the
 * `%%CW_CARD_START uid:<UID>%%` boundary markers. The alphabet is the
 * Windows-filename-safe character rule — ASCII letters, digits, spaces,
 * underscores and hyphens — so a title can be a phrase. Niche Windows name
 * handling (reserved device names, trailing-dot normalisation and the like) is
 * deliberately not enforced beyond that alphabet.
 *
 * This module is dependency-free so both the card store and the boundary parser
 * read the same definition; neither keeps a copy of the rule.
 */

/** The character set, used to build both the anchored UID pattern and the boundary patterns. */
export const CARD_UID_ALPHABET = 'A-Za-z0-9_\\- ';

/** The UID grammar after trimming: at least one character from the alphabet. */
export const CARD_UID_PATTERN = new RegExp(`^[${CARD_UID_ALPHABET}]+$`);

/** The longest title the card store accepts, in characters after trimming. */
export const CARD_UID_MAX_LENGTH = 100;

/** Trims a title/UID by its leading and trailing whitespace, preserving interior runs. */
export function normalizeCardUid(uid: string) {
  return uid.trim();
}

/**
 * Returns the normalised UID, or throws the user-facing reason it is unusable.
 * The store calls this before building any path from a UID; the boundary parser
 * trims with `normalizeCardUid` instead because a malformed marker is a
 * diagnostic, not an error.
 */
export function assertValidCardUid(uid: string) {
  const normalizedUid = normalizeCardUid(uid);

  if (!normalizedUid) {
    throw new Error('Card title / ID is required.');
  }

  if (!CARD_UID_PATTERN.test(normalizedUid)) {
    throw new Error(
      'Card title / ID must use only letters, numbers, spaces, underscores, or dashes.',
    );
  }

  if (normalizedUid.length > CARD_UID_MAX_LENGTH) {
    throw new Error(`Card title / ID must be ${CARD_UID_MAX_LENGTH} characters or fewer.`);
  }

  return normalizedUid;
}

/**
 * True when the UID can be addressed through the guarded card path builder. A
 * hand-dropped card file can have any basename; callers that enumerate such
 * files use this to skip the ones the path builder would refuse rather than
 * failing the whole operation.
 */
export function isValidCardUid(uid: string): boolean {
  try {
    assertValidCardUid(uid);
    return true;
  } catch {
    return false;
  }
}

/**
 * Two titles that differ only in ASCII letter case are the same card. The store
 * enforces that fold on create and rename; the renderer repeats it to pick the
 * stored title when attaching an existing card.
 */
export function areCardUidsEqual(left: string, right: string) {
  return normalizeCardUid(left).toLowerCase() === normalizeCardUid(right).toLowerCase();
}

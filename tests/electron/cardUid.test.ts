import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  CARD_UID_MAX_LENGTH,
  CARD_UID_PATTERN,
  areCardUidsEqual,
  assertValidCardUid,
  isValidCardUid,
  normalizeCardUid,
} = require('../../dist-electron/cardUid.js');

describe('cardUid', () => {
  it('accepts letters, digits, spaces, underscores and hyphens', () => {
    for (const uid of [
      'Three-way handshake',
      'CW-001',
      'card_title',
      'My Card',
      ' spaced ',
      'A  B',
    ]) {
      expect(assertValidCardUid(uid)).toBe(uid.trim());
      expect(isValidCardUid(uid)).toBe(true);
    }
  });

  it('rejects characters outside the Windows-filename-safe alphabet', () => {
    for (const uid of [
      'TCP: handshake',
      'my%card',
      '../evil',
      'card.',
      'card/',
      'card\\',
      'card*',
      'café',
      'card\tname',
    ]) {
      expect(() => assertValidCardUid(uid)).toThrow(
        'Card title / ID must use only letters, numbers, spaces, underscores, or dashes.',
      );
      expect(isValidCardUid(uid)).toBe(false);
    }
  });

  it('rejects an empty or whitespace-only title as required', () => {
    for (const uid of ['', '   ', '\t']) {
      expect(() => assertValidCardUid(uid)).toThrow('Card title / ID is required.');
      expect(isValidCardUid(uid)).toBe(false);
    }
  });

  it('accepts exactly 100 characters and rejects 101', () => {
    expect(CARD_UID_MAX_LENGTH).toBe(100);
    expect(assertValidCardUid('a'.repeat(100))).toHaveLength(100);
    expect(() => assertValidCardUid('a'.repeat(101))).toThrow(
      'Card title / ID must be 100 characters or fewer.',
    );
  });

  it('trims leading and trailing whitespace and preserves internal runs', () => {
    expect(normalizeCardUid('  My   Card  ')).toBe('My   Card');
    expect(assertValidCardUid('  My   Card  ')).toBe('My   Card');
  });

  it('compares titles case-insensitively', () => {
    expect(areCardUidsEqual('My Card', 'my card')).toBe(true);
    expect(areCardUidsEqual('  My Card  ', 'MY CARD')).toBe(true);
    expect(areCardUidsEqual('My Card', 'My  Card')).toBe(false);
    expect(areCardUidsEqual('My Card', 'My Cards')).toBe(false);
  });

  it('exposes the alphabet as the one pattern the grammar is built from', () => {
    expect(CARD_UID_PATTERN.test('Three-way handshake')).toBe(true);
    expect(CARD_UID_PATTERN.test('Three-way_handshake')).toBe(true);
    expect(CARD_UID_PATTERN.test('TCP: handshake')).toBe(false);
  });
});

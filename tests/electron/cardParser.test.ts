import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  formatCardEndBoundary,
  formatCardStartBoundary,
  parseCrashCardsFromNote,
} = require('../../dist-electron/cardParser.js');

describe('cardParser', () => {
  it('parses a boundary pair whose UID contains spaces', () => {
    const note = [
      '# TCP notes',
      '',
      '%%CW_CARD_START uid:Three-way handshake%%',
      'SYN, SYN-ACK, ACK.',
      '%%CW_CARD_END uid:Three-way handshake%%',
      '',
      'Trailing prose.',
    ].join('\n');

    const result = parseCrashCardsFromNote('notes/tcp.md', note);

    expect(result.diagnostics).toEqual([]);
    expect(result.cards).toEqual([
      {
        uid: 'Three-way handshake',
        startLine: 3,
        endLine: 5,
        blockContent: 'SYN, SYN-ACK, ACK.',
      },
    ]);
  });

  it('preserves internal runs of spaces in the captured UID', () => {
    const note = ['%%CW_CARD_START uid:My  Card%%', 'Prose.', '%%CW_CARD_END uid:My  Card%%'].join(
      '\n',
    );

    const result = parseCrashCardsFromNote('notes/spaced.md', note);

    expect(result.diagnostics).toEqual([]);
    expect(result.cards.map((card: { uid: string }) => card.uid)).toEqual(['My  Card']);
  });

  it('trims trailing spaces before the terminator from the captured UID', () => {
    const note = ['%%CW_CARD_START uid:My Card %%', 'Prose.', '%%CW_CARD_END uid:My Card  %%'].join(
      '\n',
    );

    const result = parseCrashCardsFromNote('notes/trailing.md', note);

    expect(result.diagnostics).toEqual([]);
    expect(result.cards.map((card: { uid: string }) => card.uid)).toEqual(['My Card']);
  });

  it('round-trips a spaced UID through the canonical formatters', () => {
    expect(formatCardStartBoundary('Three-way handshake')).toBe(
      '%%CW_CARD_START uid:Three-way handshake%%',
    );
    expect(formatCardEndBoundary('Three-way handshake')).toBe(
      '%%CW_CARD_END uid:Three-way handshake%%',
    );

    const note = [
      formatCardStartBoundary('Three-way handshake'),
      'SYN, SYN-ACK, ACK.',
      formatCardEndBoundary('Three-way handshake'),
    ].join('\n');
    const result = parseCrashCardsFromNote('notes/tcp.md', note);

    expect(result.diagnostics).toEqual([]);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].uid).toBe('Three-way handshake');
  });

  it('reports a marker whose UID is only whitespace as an invalid boundary', () => {
    const result = parseCrashCardsFromNote('notes/blank.md', '%%CW_CARD_START uid:   %%');

    expect(result.cards).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'invalid-start-boundary',
      line: 1,
      message: 'Card start boundary must follow the format %%CW_CARD_START uid:<UID>%%.',
      severity: 'error',
    });
  });

  it('keeps the existing marker diagnostics unchanged', () => {
    const invalidStart = parseCrashCardsFromNote('notes/invalid.md', '%%CW_CARD_START CW-001%%');
    expect(invalidStart.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toEqual(
      ['invalid-start-boundary'],
    );

    const mismatched = parseCrashCardsFromNote(
      'notes/mismatched.md',
      ['%%CW_CARD_START uid:CW-001%%', 'Prose.', '%%CW_CARD_END uid:CW-002%%'].join('\n'),
    );
    expect(mismatched.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toEqual([
      'mismatched-boundary-uid',
      'unmatched-start-boundary',
    ]);

    const nested = parseCrashCardsFromNote(
      'notes/nested.md',
      [
        '%%CW_CARD_START uid:Outer card%%',
        '%%CW_CARD_START uid:Inner card%%',
        'Prose.',
        '%%CW_CARD_END uid:Outer card%%',
      ].join('\n'),
    );
    expect(nested.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toEqual([
      'nested-start-boundary',
    ]);
  });
});

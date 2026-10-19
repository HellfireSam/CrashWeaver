import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  removeCardBoundaryLines,
  replaceCardBoundaryUids,
  restoreCardBoundaryLines,
} = require('../../dist-electron/services/cardBoundaryService.js');
const {
  formatCardStartBoundary,
  formatCardEndBoundary,
} = require('../../dist-electron/cardParser.js');

describe('cardBoundaryService', () => {
  it('removeCardBoundaryLines strips matching start and end boundaries', () => {
    const uid = 'abc123';
    const start = formatCardStartBoundary(uid);
    const end = formatCardEndBoundary(uid);
    const content = ['before', start, 'inside', end, 'after'].join('\n');

    const result = removeCardBoundaryLines(content, uid);

    expect(result.removedBoundaryLines).toBe(2);
    expect(result.content).toBe(['before', 'inside', 'after'].join('\n'));
  });

  it('replaceCardBoundaryUids rewrites both boundary lines for the card uid', () => {
    const previousUid = 'old_uid';
    const nextUid = 'new_uid';
    const previousStart = formatCardStartBoundary(previousUid);
    const previousEnd = formatCardEndBoundary(previousUid);
    const nextStart = formatCardStartBoundary(nextUid);
    const nextEnd = formatCardEndBoundary(nextUid);
    const content = ['preamble', previousStart, 'body', previousEnd, 'tail'].join('\n');

    const result = replaceCardBoundaryUids(content, previousUid, nextUid);

    expect(result.replaced).toBe(true);
    expect(result.content).toBe(['preamble', nextStart, 'body', nextEnd, 'tail'].join('\n'));
  });

  it('restoreCardBoundaryLines reinserts boundaries around matched raw content', () => {
    const uid = 'restore-1';
    const start = formatCardStartBoundary(uid);
    const end = formatCardEndBoundary(uid);
    const rawContent = ['question', 'answer'].join('\n');
    const content = ['top', 'question', 'answer', 'bottom'].join('\n');

    const result = restoreCardBoundaryLines(content, uid, rawContent, 2, 5);

    expect(result.inserted).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    expect(result.content).toBe(['top', start, 'question', 'answer', end, 'bottom'].join('\n'));
  });
});

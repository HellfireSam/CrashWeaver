const test = require('node:test');
const assert = require('node:assert/strict');

const {
  removeCardBoundaryLines,
  replaceCardBoundaryUids,
  restoreCardBoundaryLines,
} = require('../../dist-electron/services/cardBoundaryService.js');
const {
  formatCardStartBoundary,
  formatCardEndBoundary,
} = require('../../dist-electron/cardParser.js');

test('removeCardBoundaryLines strips matching start and end boundaries', () => {
  const uid = 'abc123';
  const start = formatCardStartBoundary(uid);
  const end = formatCardEndBoundary(uid);
  const content = ['before', start, 'inside', end, 'after'].join('\n');

  const result = removeCardBoundaryLines(content, uid);

  assert.equal(result.removedBoundaryLines, 2);
  assert.equal(result.content, ['before', 'inside', 'after'].join('\n'));
});

test('replaceCardBoundaryUids rewrites both boundary lines for the card uid', () => {
  const previousUid = 'old_uid';
  const nextUid = 'new_uid';
  const previousStart = formatCardStartBoundary(previousUid);
  const previousEnd = formatCardEndBoundary(previousUid);
  const nextStart = formatCardStartBoundary(nextUid);
  const nextEnd = formatCardEndBoundary(nextUid);
  const content = ['preamble', previousStart, 'body', previousEnd, 'tail'].join('\n');

  const result = replaceCardBoundaryUids(content, previousUid, nextUid);

  assert.equal(result.replaced, true);
  assert.equal(result.content, ['preamble', nextStart, 'body', nextEnd, 'tail'].join('\n'));
});

test('restoreCardBoundaryLines reinserts boundaries around matched raw content', () => {
  const uid = 'restore-1';
  const start = formatCardStartBoundary(uid);
  const end = formatCardEndBoundary(uid);
  const rawContent = ['question', 'answer'].join('\n');
  const content = ['top', 'question', 'answer', 'bottom'].join('\n');

  const result = restoreCardBoundaryLines(content, uid, rawContent, 2, 5);

  assert.equal(result.inserted, true);
  assert.equal(result.alreadyPresent, false);
  assert.equal(result.content, ['top', start, 'question', 'answer', end, 'bottom'].join('\n'));
});

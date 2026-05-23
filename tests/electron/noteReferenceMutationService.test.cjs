const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  dedupeNoteReferencesByPath,
  isMissingReferenceNoteError,
  resolveReferenceNotePath,
} = require('../../dist-electron/services/noteReferenceMutationService.js');

test('resolveReferenceNotePath resolves safe note paths inside root', () => {
  const result = resolveReferenceNotePath('/vault/root', 'notes/topic.md');
  assert.ok(result);
  assert.equal(result.relativePath, 'notes/topic.md');
  assert.equal(
    result.absolutePath,
    path.resolve('/vault/root', 'notes/topic.md'),
  );
});

test('resolveReferenceNotePath blocks outside-root traversal', () => {
  const result = resolveReferenceNotePath('/vault/root', '../escape.md');
  assert.equal(result, null);
});

test('dedupeNoteReferencesByPath preserves first entry per note_path', () => {
  const deduped = dedupeNoteReferencesByPath([
    { note_path: 'a.md', start_line: 1 },
    { note_path: 'b.md', start_line: 2 },
    { note_path: 'a.md', start_line: 99 },
  ]);

  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped[0], { note_path: 'a.md', start_line: 1 });
  assert.deepEqual(deduped[1], { note_path: 'b.md', start_line: 2 });
});

test('isMissingReferenceNoteError matches ENOENT only', () => {
  const missingError = Object.assign(new Error('missing file'), { code: 'ENOENT' });
  const otherError = Object.assign(new Error('permission denied'), { code: 'EACCES' });

  assert.equal(isMissingReferenceNoteError(missingError), true);
  assert.equal(isMissingReferenceNoteError(otherError), false);
  assert.equal(isMissingReferenceNoteError(new Error('unknown')), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  dedupeNoteReferencesByPath,
  isMissingReferenceNoteError,
  readReferenceNoteContent,
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

test('readReferenceNoteContent returns content for an in-root note', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-note-ref-read-'));
  const rootPath = path.join(tempDir, 'vault-root');
  const notePath = path.join(rootPath, 'notes', 'topic.md');

  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.writeFile(notePath, 'hello world', 'utf8');

  const result = await readReferenceNoteContent(rootPath, 'notes/topic.md');

  assert.ok(result);
  assert.equal(result.relativePath, 'notes/topic.md');
  assert.equal(result.content, 'hello world');
});

test('readReferenceNoteContent returns null for missing or outside-root notes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-note-ref-null-'));
  const rootPath = path.join(tempDir, 'vault-root');

  await fs.mkdir(rootPath, { recursive: true });

  const missing = await readReferenceNoteContent(rootPath, 'missing.md');
  const outside = await readReferenceNoteContent(rootPath, '../escape.md');

  assert.equal(missing, null);
  assert.equal(outside, null);
});

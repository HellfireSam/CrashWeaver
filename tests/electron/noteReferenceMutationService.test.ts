import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const {
  dedupeNoteReferencesByPath,
  isMissingReferenceNoteError,
  readReferenceNoteContent,
  resolveReferenceNotePath,
} = require('../../dist-electron/services/noteReferenceMutationService.js');

describe('noteReferenceMutationService', () => {
  it('resolveReferenceNotePath resolves safe note paths inside root', () => {
    const result = resolveReferenceNotePath('/vault/root', 'notes/topic.md');

    expect(result).toBeTruthy();
    expect(result.relativePath).toBe('notes/topic.md');
    expect(result.absolutePath).toBe(path.resolve('/vault/root', 'notes/topic.md'));
  });

  it('resolveReferenceNotePath blocks outside-root traversal', () => {
    const result = resolveReferenceNotePath('/vault/root', '../escape.md');

    expect(result).toBeNull();
  });

  it('dedupeNoteReferencesByPath preserves first entry per note_path', () => {
    const deduped = dedupeNoteReferencesByPath([
      { note_path: 'a.md', start_line: 1 },
      { note_path: 'b.md', start_line: 2 },
      { note_path: 'a.md', start_line: 99 },
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toEqual({ note_path: 'a.md', start_line: 1 });
    expect(deduped[1]).toEqual({ note_path: 'b.md', start_line: 2 });
  });

  it('isMissingReferenceNoteError matches ENOENT only', () => {
    const missingError = Object.assign(new Error('missing file'), { code: 'ENOENT' });
    const otherError = Object.assign(new Error('permission denied'), { code: 'EACCES' });

    expect(isMissingReferenceNoteError(missingError)).toBe(true);
    expect(isMissingReferenceNoteError(otherError)).toBe(false);
    expect(isMissingReferenceNoteError(new Error('unknown'))).toBe(false);
  });

  it('readReferenceNoteContent returns content for an in-root note', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-note-ref-read-'));
    const rootPath = path.join(tempDir, 'vault-root');
    const notePath = path.join(rootPath, 'notes', 'topic.md');

    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(notePath, 'hello world', 'utf8');

    const result = await readReferenceNoteContent(rootPath, 'notes/topic.md');

    expect(result).toBeTruthy();
    expect(result.relativePath).toBe('notes/topic.md');
    expect(result.content).toBe('hello world');
  });

  it('readReferenceNoteContent returns null for missing or outside-root notes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-note-ref-null-'));
    const rootPath = path.join(tempDir, 'vault-root');

    await fs.mkdir(rootPath, { recursive: true });

    const missing = await readReferenceNoteContent(rootPath, 'missing.md');
    const outside = await readReferenceNoteContent(rootPath, '../escape.md');

    expect(missing).toBeNull();
    expect(outside).toBeNull();
  });
});

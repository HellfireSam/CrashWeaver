import path from 'node:path';
import { getFsErrorCode } from '../utils/fsErrors';
import { toPosixPath } from '../utils/paths';

function isOutsideRoot(relativePath: string) {
  return relativePath.startsWith('..') || path.isAbsolute(relativePath);
}

export function resolveReferenceNotePath(rootPath: string, notePath: string) {
  const absolutePath = path.resolve(rootPath, notePath);
  const relativePath = path.relative(rootPath, absolutePath);

  if (isOutsideRoot(relativePath)) {
    return null;
  }

  return {
    absolutePath,
    relativePath: toPosixPath(relativePath),
  };
}

export function isMissingReferenceNoteError(error: unknown) {
  return getFsErrorCode(error) === 'ENOENT';
}

export function dedupeNoteReferencesByPath<T extends { note_path: string }>(references: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const reference of references) {
    if (seen.has(reference.note_path)) {
      continue;
    }

    seen.add(reference.note_path);
    deduped.push(reference);
  }

  return deduped;
}

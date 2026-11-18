import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCrashCardsFromNote } from '../cardParser';
import { getFsErrorCode } from '../utils/fsErrors';

// ── Guards ──────────────────────────────────────────────────────────────────
//
// The guards run before a handler mutates anything. Vault containment runs
// first in every handler, so a path that escapes the vault is refused even by a
// dry run; the remaining guards are skipped by a dry run, whose contract is
// containment only.

/**
 * Resolves a vault-relative path to an absolute filesystem path, verifying
 * it stays within the vault root.  Symlinks are resolved so that a symlink
 * inside the vault pointing outside cannot be used to escape.
 *
 * For paths that don't exist yet (create operations), the nearest existing
 * ancestor is resolved and the missing tail is re-joined.
 */
export async function assertWithinVault(resolvedRoot: string, targetPath: string): Promise<string> {
  const naiveAbsolute = path.resolve(resolvedRoot, targetPath);

  // Resolve the vault root itself through any symlinks
  let realRoot: string;
  try {
    realRoot = await fs.realpath(resolvedRoot);
  } catch {
    throw new Error(`Vault root is not accessible: ${resolvedRoot}`);
  }

  // Resolve the target through symlinks if the path exists;
  // otherwise walk up to the nearest existing ancestor.
  let realAbsolute: string;
  try {
    realAbsolute = await fs.realpath(naiveAbsolute);
  } catch (error) {
    if (getFsErrorCode(error) === 'ENOENT') {
      // Path doesn't exist yet — walk up to find nearest existing ancestor
      let ancestor = path.dirname(naiveAbsolute);
      const missingParts: string[] = [path.basename(naiveAbsolute)];
      while (true) {
        try {
          const realAncestor = await fs.realpath(ancestor);
          realAbsolute = path.join(realAncestor, ...missingParts);
          break;
        } catch (innerError) {
          if (getFsErrorCode(innerError) === 'ENOENT') {
            const parent = path.dirname(ancestor);
            if (parent === ancestor) {
              // Reached filesystem root — fall back to naive resolution
              realAbsolute = naiveAbsolute;
              break;
            }
            missingParts.unshift(path.basename(ancestor));
            ancestor = parent;
          } else {
            throw innerError;
          }
        }
      }
    } else {
      throw error;
    }
  }

  const relative = path.relative(realRoot, realAbsolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes vault root: ${targetPath}`);
  }

  // Return the naive (path.resolve) path so that file operations use
  // consistent casing with the rest of the codebase.  The realpath
  // resolution above is purely for the security boundary check.
  return naiveAbsolute;
}

/** Requires the target to be an existing file, so a missing note fails loudly. */
export async function assertNoteExists(absolutePath: string): Promise<void> {
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${absolutePath}`);
    }
  } catch (error) {
    if (getFsErrorCode(error) === 'ENOENT') {
      throw new Error(`Note not found: ${absolutePath}`, { cause: error });
    }
    throw error;
  }
}

/**
 * Verifies that all %%CW_CARD_START/END%% pairs in the content are balanced.
 * Throws if any diagnostic with severity 'error' is found.
 */
export function verifyBoundaryIntegrity(content: string, label: string): void {
  const parsed = parseCrashCardsFromNote(label, content);

  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    const messages = errors.map(
      (d) => `[${d.code}] ${d.message}${d.uid ? ` (uid: ${d.uid})` : ''}`,
    );
    throw new Error(`Boundary integrity check failed for ${label}: ${messages.join('; ')}`);
  }
}

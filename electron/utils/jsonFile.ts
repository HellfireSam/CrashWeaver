import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getFsErrorCode } from './fsErrors';

/**
 * Writes content to filePath atomically.
 *
 * Strategy:
 *  1. Write content to a temp file named with a random UUID (no collision risk).
 *  2. Rename temp → target. On Unix this is atomic. On Windows it fails if
 *     the target already exists.
 *  3. On Windows: rename target → backup first, then temp → target, then
 *     remove backup. If temp → target fails, restore from backup.
 *     This avoids the data-loss gap present in a naive rm+rename approach.
 */
export async function writeTextAtomically(filePath: string, content: string) {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');

  try {
    // Unix / first-write-on-Windows: atomic rename.
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    const code = getFsErrorCode(error);

    // Non-Windows or unexpected error — clean up and rethrow.
    if (code !== 'EEXIST' && code !== 'EPERM') {
      await fs.rm(tmpPath, { force: true });
      throw error;
    }

    // Windows path: target exists, use backup-then-replace strategy.
    const bakPath = `${filePath}.${randomUUID()}.bak`;

    // Move existing file to backup. If the process crashes here, the
    // backup preserves the previous state — no data is lost.
    try {
      await fs.rename(filePath, bakPath);
    } catch {
      // Target may have been deleted by another process — try a direct
      // remove + rename fallback.
      await fs.rm(filePath, { force: true });
      await fs.rename(tmpPath, filePath);
      return;
    }

    try {
      await fs.rename(tmpPath, filePath);
    } catch (renameError) {
      // Restore backup on failure so the original data is preserved.
      await fs.rename(bakPath, filePath).catch(() => {});
      await fs.rm(tmpPath, { force: true });
      throw renameError;
    }

    // Success — clean up the backup.
    await fs.rm(bakPath, { force: true });
  }
}

export async function writeJsonAtomically(filePath: string, value: unknown) {
  await writeTextAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

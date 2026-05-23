import fs from 'node:fs/promises';
import { getFsErrorCode } from './fsErrors';

export async function writeTextAtomically(filePath: string, content: string) {
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFilePath, content, 'utf8');

  try {
    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code !== 'EEXIST' && code !== 'EPERM') {
      await fs.rm(tempFilePath, { force: true });
      throw error;
    }

    await fs.rm(filePath, { force: true });
    await fs.rename(tempFilePath, filePath);
  }
}

export async function writeJsonAtomically(filePath: string, value: unknown) {
  await writeTextAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

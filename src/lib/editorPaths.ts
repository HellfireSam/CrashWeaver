export function normalizeRelativePath(rootPath: string | null, filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedRoot = rootPath?.replace(/\\/g, '/').replace(/\/+$/, '') ?? '';

  if (normalizedRoot && normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath;
}

export function isCrashpadFilePath(filePath: string) {
  return filePath.toLowerCase().endsWith('.crashpad.json');
}

export function isCardJsonFilePath(filePath: string) {
  return filePath.toLowerCase().endsWith('.json') && !isCrashpadFilePath(filePath);
}

export function getCrashpadIdFromPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
  return fileName.replace(/\.crashpad\.json$/i, '');
}

export function getCardUidFromPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath;
  return fileName.replace(/\.json$/i, '');
}

export function isPathInsideVault(relativePath: string) {
  return !/^[A-Za-z]:\//i.test(relativePath) && !relativePath.startsWith('../') && relativePath !== '..';
}

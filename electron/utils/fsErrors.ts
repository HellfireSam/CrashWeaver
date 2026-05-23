export function getFsErrorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined;
}

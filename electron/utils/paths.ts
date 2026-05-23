export function toPosixPath(value: string) {
  return value.replace(/\\/g, '/');
}

export function moveStateKey<T>(state: Record<string, T>, previousKey: string, nextKey: string) {
  if (previousKey === nextKey || !(previousKey in state)) {
    return state;
  }

  const { [previousKey]: previousValue, ...remaining } = state;
  return {
    ...remaining,
    [nextKey]: previousValue,
  };
}

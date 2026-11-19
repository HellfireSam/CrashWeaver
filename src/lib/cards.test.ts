import { describe, expect, it } from 'vitest';
import { areCardUidsEqual } from './cards';

describe('cards', () => {
  it('treats card titles that differ only in letter case as the same card', () => {
    expect(areCardUidsEqual('My Card', 'my card')).toBe(true);
    expect(areCardUidsEqual('  My Card  ', 'MY CARD')).toBe(true);
  });

  it('does not fold anything except letter case and the surrounding whitespace', () => {
    expect(areCardUidsEqual('My Card', 'My  Card')).toBe(false);
    expect(areCardUidsEqual('My Card', 'My Cards')).toBe(false);
  });
});

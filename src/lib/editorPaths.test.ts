import { describe, expect, it } from 'vitest';
import {
  getCardUidFromPath,
  getCrashpadIdFromPath,
  isCardJsonFilePath,
  isCrashpadFilePath,
  isPathInsideVault,
  normalizeRelativePath,
} from './editorPaths';

describe('editorPaths', () => {
  it('normalizes file paths relative to vault root', () => {
    expect(normalizeRelativePath('C:/vault', 'C:/vault/notes/topic.md')).toBe('notes/topic.md');
    expect(normalizeRelativePath('C:/vault/', 'C:/other/topic.md')).toBe('C:/other/topic.md');
    expect(normalizeRelativePath(null, 'notes\\topic.md')).toBe('notes/topic.md');
  });

  it('classifies crashpad and card json paths', () => {
    expect(isCrashpadFilePath('daily.crashpad.json')).toBe(true);
    expect(isCrashpadFilePath('card.json')).toBe(false);
    expect(isCardJsonFilePath('card.json')).toBe(true);
    expect(isCardJsonFilePath('daily.crashpad.json')).toBe(false);
  });

  it('extracts crashpad id and card uid from paths', () => {
    expect(getCrashpadIdFromPath('folder/daily.crashpad.json')).toBe('daily');
    expect(getCardUidFromPath('folder/topic-card.json')).toBe('topic-card');
  });

  it('guards whether paths stay inside the vault', () => {
    expect(isPathInsideVault('notes/topic.md')).toBe(true);
    expect(isPathInsideVault('../notes/topic.md')).toBe(false);
    expect(isPathInsideVault('C:/notes/topic.md')).toBe(false);
    expect(isPathInsideVault('..')).toBe(false);
  });
});

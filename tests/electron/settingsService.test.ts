import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const settingsService = require('../../dist-electron/settingsService.js');

describe('settingsService', () => {
  it('settings mutations are serialized and do not clobber independent keys', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-settings-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const rootPath = path.join(tempDir, 'vault-root');

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      await Promise.all([
        settingsService.setCardStorePath(rootPath, path.join(tempDir, 'cards')),
        settingsService.setImageDirectories(rootPath, [
          path.join(tempDir, 'images'),
          ` ${path.join(tempDir, 'images')} `,
        ]),
        settingsService.setWeaverPreferredModel('openai/gpt-4o'),
        settingsService.setCrashpadDeletePreferences({
          removeNoteBoundariesByDefault: false,
          requireConfirmationForNewCards: true,
          requireStrictConfirmationForExistingCards: false,
        }),
      ]);

      const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      const vaultKey = path.resolve(rootPath);

      expect(parsed.cardStoreByVault[vaultKey]).toBe(path.resolve(path.join(tempDir, 'cards')));
      expect(parsed.imageDirectoriesByVault[vaultKey]).toEqual([
        path.resolve(path.join(tempDir, 'images')),
      ]);
      expect(parsed.weaverPreferredModel).toBe('openai/gpt-4o');
      expect(parsed.crashpadDeletePreferences).toEqual({
        removeNoteBoundariesByDefault: false,
        requireConfirmationForNewCards: true,
        requireStrictConfirmationForExistingCards: false,
      });

      const config = await settingsService.getCardStoreConfig(rootPath);
      expect(config.cardStorePath).toBe(path.resolve(path.join(tempDir, 'cards')));
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('setWeaverPreferredModel persists and clears the preferred model field', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-settings-model-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const stored = await settingsService.setWeaverPreferredModel('anthropic/claude-sonnet-4-5');
      expect(stored).toEqual({
        configured: false,
        preferredModel: 'anthropic/claude-sonnet-4-5',
      });

      const parsedAfterSet = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      expect(parsedAfterSet.weaverPreferredModel).toBe('anthropic/claude-sonnet-4-5');

      const cleared = await settingsService.setWeaverPreferredModel(null);
      expect(cleared).toEqual({
        configured: false,
        preferredModel: null,
      });

      const parsedAfterClear = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      expect('weaverPreferredModel' in parsedAfterClear).toBe(false);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('setWeaverRequestLogsDirectory persists and clears the configured log directory', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-settings-logdir-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
    const configuredLogsDir = path.join(tempDir, 'weaver-logs');

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const stored = await settingsService.setWeaverRequestLogsDirectory(configuredLogsDir);
      expect(stored).toBe(path.resolve(configuredLogsDir));

      const readBack = await settingsService.getWeaverRequestLogsDirectory();
      expect(readBack).toBe(path.resolve(configuredLogsDir));

      const parsedAfterSet = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      expect(parsedAfterSet.weaverRequestLogsDirectory).toBe(path.resolve(configuredLogsDir));

      const cleared = await settingsService.setWeaverRequestLogsDirectory(null);
      expect(cleared).toBe(null);

      const parsedAfterClear = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      expect('weaverRequestLogsDirectory' in parsedAfterClear).toBe(false);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });

  it('updateWeaverSettings persists user-defined budget and limits settings', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-settings-budgets-'));
    const settingsPath = path.join(tempDir, 'crashweaver-settings.json');

    settingsService.__resetSettingsMutationQueueForTests();
    settingsService.__setSettingsFilePathForTests(settingsPath);

    try {
      const originalSettings = await settingsService.getWeaverSettings();
      expect(originalSettings.disableBudgetRestrictions).toBe(undefined);

      const updated = await settingsService.updateWeaverSettings({
        disableBudgetRestrictions: true,
        intelligentLightMaxTokens: 2500,
        intelligentStandardTimeoutMs: 90000,
      });

      expect(updated.disableBudgetRestrictions).toBe(true);
      expect(updated.intelligentLightMaxTokens).toBe(2500);
      expect(updated.intelligentStandardTimeoutMs).toBe(90000);

      const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      expect(parsed.weaverDisableBudgetRestrictions).toBe(true);
      expect(parsed.weaverIntelligentLightMaxTokens).toBe(2500);
      expect(parsed.weaverIntelligentStandardTimeoutMs).toBe(90000);
    } finally {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    }
  });
});

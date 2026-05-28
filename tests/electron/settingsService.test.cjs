const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const settingsService = require('../../dist-electron/settingsService.js');

test('settings mutations are serialized and do not clobber independent keys', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-settings-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    await Promise.all([
      settingsService.setCardStorePath(rootPath, path.join(tempDir, 'cards')),
      settingsService.setImageDirectories(rootPath, [path.join(tempDir, 'images'), ` ${path.join(tempDir, 'images')} `]),
      settingsService.setWeaverPreferredModel('openai/gpt-4o'),
      settingsService.setCrashpadDeletePreferences({
        removeNoteBoundariesByDefault: false,
        requireConfirmationForNewCards: true,
        requireStrictConfirmationForExistingCards: false,
      }),
    ]);

    const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    const vaultKey = path.resolve(rootPath);

    assert.equal(parsed.cardStoreByVault[vaultKey], path.resolve(path.join(tempDir, 'cards')));
    assert.deepEqual(parsed.imageDirectoriesByVault[vaultKey], [path.resolve(path.join(tempDir, 'images'))]);
    assert.equal(parsed.weaverPreferredModel, 'openai/gpt-4o');
    assert.deepEqual(parsed.crashpadDeletePreferences, {
      removeNoteBoundariesByDefault: false,
      requireConfirmationForNewCards: true,
      requireStrictConfirmationForExistingCards: false,
    });

    const config = await settingsService.getCardStoreConfig(rootPath);
    assert.equal(config.cardStorePath, path.resolve(path.join(tempDir, 'cards')));
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('setWeaverPreferredModel persists and clears the preferred model field', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-settings-model-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const stored = await settingsService.setWeaverPreferredModel('anthropic/claude-sonnet-4-5');
    assert.deepEqual(stored, {
      configured: false,
      preferredModel: 'anthropic/claude-sonnet-4-5',
    });

    const parsedAfterSet = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    assert.equal(parsedAfterSet.weaverPreferredModel, 'anthropic/claude-sonnet-4-5');

    const cleared = await settingsService.setWeaverPreferredModel(null);
    assert.deepEqual(cleared, {
      configured: false,
      preferredModel: null,
    });

    const parsedAfterClear = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    assert.equal('weaverPreferredModel' in parsedAfterClear, false);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('setWeaverRequestLogsDirectory persists and clears the configured log directory', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-settings-logdir-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const configuredLogsDir = path.join(tempDir, 'weaver-logs');

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const stored = await settingsService.setWeaverRequestLogsDirectory(configuredLogsDir);
    assert.equal(stored, path.resolve(configuredLogsDir));

    const readBack = await settingsService.getWeaverRequestLogsDirectory();
    assert.equal(readBack, path.resolve(configuredLogsDir));

    const parsedAfterSet = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    assert.equal(parsedAfterSet.weaverRequestLogsDirectory, path.resolve(configuredLogsDir));

    const cleared = await settingsService.setWeaverRequestLogsDirectory(null);
    assert.equal(cleared, null);

    const parsedAfterClear = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    assert.equal('weaverRequestLogsDirectory' in parsedAfterClear, false);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

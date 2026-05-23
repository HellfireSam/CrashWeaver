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

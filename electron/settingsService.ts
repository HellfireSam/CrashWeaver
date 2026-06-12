import fs from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { getFsErrorCode } from './utils/fsErrors';
import { writeJsonAtomically } from './utils/jsonFile';
import type { CardStoreConfig, CrashpadDeletePreferences, WeaverSettings } from './vault-contract';

interface PersistedSettings {
  version: 1;
  cardStoreByVault: Record<string, string>;
  openrouterApiKeyEncrypted?: string;
  weaverPreferredModel?: string;
  weaverRequestLogsDirectory?: string;
  imageDirectoriesByVault: Record<string, string[]>;
  crashpadDeletePreferences: CrashpadDeletePreferences;
  weaverDisableBudgetRestrictions?: boolean;
  weaverGuidedInsertBaseMaxTokens?: number;
  weaverGuidedInsertBaseTimeoutMs?: number;
  weaverGuidedInsertExpandedMaxTokens?: number;
  weaverGuidedInsertExpandedTimeoutMs?: number;
  weaverIntelligentLightMaxTokens?: number;
  weaverIntelligentLightTimeoutMs?: number;
  weaverIntelligentLightIterationLimit?: number;
  weaverIntelligentStandardMaxTokens?: number;
  weaverIntelligentStandardTimeoutMs?: number;
  weaverIntelligentStandardIterationLimit?: number;
  weaverIntelligentGoHamMaxTokens?: number;
  weaverIntelligentGoHamTimeoutMs?: number;
  weaverIntelligentGoHamIterationLimit?: number;
  weaverGuidedInsertMaxOperations?: number;
  weaverIntelligentLightMaxOperations?: number;
  weaverIntelligentStandardMaxOperations?: number;
  weaverIntelligentGoHamMaxOperations?: number;
}

const WEAVER_BUDGET_BOUNDS = {
  minTokens: 100,
  maxTokens: 32_000,
  minTimeoutMs: 5_000,
  maxTimeoutMs: 600_000,
  minIterations: 1,
  maxIterations: 20,
  minOperations: 1,
  maxOperations: 20,
} as const;

function normalizeBoundedNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid ${label}: value must be finite.`);
  }
  if (num < min || num > max) {
    throw new Error(`Invalid ${label}: must be between ${min} and ${max}.`);
  }
  return Math.trunc(num);
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeDirectoryList(directories: string[]) {
  const seen = new Set<string>();
  const normalizedDirectories: string[] = [];

  for (const directory of directories) {
    const trimmedDirectory = directory.trim();

    if (!trimmedDirectory) {
      continue;
    }

    const normalizedDirectory = path.resolve(trimmedDirectory);

    if (!normalizedDirectory || seen.has(normalizedDirectory)) {
      continue;
    }

    seen.add(normalizedDirectory);
    normalizedDirectories.push(normalizedDirectory);
  }

  return normalizedDirectories;
}

function normalizePreferredModel(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeLogDirectory(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  return path.resolve(value.trim());
}

const SETTINGS_FILE_NAME = 'crashweaver-settings.json';
let settingsMutationQueue: Promise<void> = Promise.resolve();
let settingsFilePathOverride: string | null = null;

function createDefaultSettings(): PersistedSettings {
  return {
    version: 1,
    cardStoreByVault: {},
    imageDirectoriesByVault: {},
    crashpadDeletePreferences: {
      removeNoteBoundariesByDefault: true,
      requireConfirmationForNewCards: true,
      requireStrictConfirmationForExistingCards: true,
    },
  };
}

function getSettingsFilePath() {
  if (settingsFilePathOverride) {
    return settingsFilePathOverride;
  }

  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
}

export function __setSettingsFilePathForTests(filePath: string | null) {
  settingsFilePathOverride = filePath;
}

export function __resetSettingsMutationQueueForTests() {
  settingsMutationQueue = Promise.resolve();
}

function getVaultKey(rootPath: string) {
  return path.resolve(rootPath);
}

export function getDefaultCardStorePath(rootPath: string) {
  return path.join(path.resolve(rootPath), '.crashweaver', 'cards');
}

async function readSettings(): Promise<PersistedSettings> {
  try {
    const raw = await fs.readFile(getSettingsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;

    return {
      version: 1,
      cardStoreByVault:
        parsed.cardStoreByVault && typeof parsed.cardStoreByVault === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.cardStoreByVault).filter(
                (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
              ),
            )
          : {},
      openrouterApiKeyEncrypted:
        typeof parsed.openrouterApiKeyEncrypted === 'string' ? parsed.openrouterApiKeyEncrypted : undefined,
      weaverPreferredModel: normalizePreferredModel((parsed as { weaverPreferredModel?: unknown }).weaverPreferredModel),
      weaverRequestLogsDirectory: normalizeLogDirectory((parsed as { weaverRequestLogsDirectory?: unknown }).weaverRequestLogsDirectory),
      imageDirectoriesByVault:
        parsed.imageDirectoriesByVault && typeof parsed.imageDirectoriesByVault === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.imageDirectoriesByVault).map(([vaultKey, directories]) => [vaultKey, toStringArray(directories)]),
            )
          : {},
      crashpadDeletePreferences:
        parsed.crashpadDeletePreferences && typeof parsed.crashpadDeletePreferences === 'object'
          ? {
              removeNoteBoundariesByDefault:
                (parsed.crashpadDeletePreferences as Partial<CrashpadDeletePreferences>).removeNoteBoundariesByDefault !== false,
              requireConfirmationForNewCards:
                (parsed.crashpadDeletePreferences as Partial<CrashpadDeletePreferences>).requireConfirmationForNewCards !== false,
              requireStrictConfirmationForExistingCards:
                (parsed.crashpadDeletePreferences as Partial<CrashpadDeletePreferences>).requireStrictConfirmationForExistingCards !==
                false,
            }
          : createDefaultSettings().crashpadDeletePreferences,
      weaverDisableBudgetRestrictions:
        typeof parsed.weaverDisableBudgetRestrictions === 'boolean' ? parsed.weaverDisableBudgetRestrictions : undefined,
      weaverGuidedInsertBaseMaxTokens:
        typeof parsed.weaverGuidedInsertBaseMaxTokens === 'number' ? parsed.weaverGuidedInsertBaseMaxTokens : undefined,
      weaverGuidedInsertBaseTimeoutMs:
        typeof parsed.weaverGuidedInsertBaseTimeoutMs === 'number' ? parsed.weaverGuidedInsertBaseTimeoutMs : undefined,
      weaverGuidedInsertExpandedMaxTokens:
        typeof parsed.weaverGuidedInsertExpandedMaxTokens === 'number' ? parsed.weaverGuidedInsertExpandedMaxTokens : undefined,
      weaverGuidedInsertExpandedTimeoutMs:
        typeof parsed.weaverGuidedInsertExpandedTimeoutMs === 'number' ? parsed.weaverGuidedInsertExpandedTimeoutMs : undefined,
      weaverIntelligentLightMaxTokens:
        typeof parsed.weaverIntelligentLightMaxTokens === 'number' ? parsed.weaverIntelligentLightMaxTokens : undefined,
      weaverIntelligentLightTimeoutMs:
        typeof parsed.weaverIntelligentLightTimeoutMs === 'number' ? parsed.weaverIntelligentLightTimeoutMs : undefined,
      weaverIntelligentLightIterationLimit:
        typeof parsed.weaverIntelligentLightIterationLimit === 'number' ? parsed.weaverIntelligentLightIterationLimit : undefined,
      weaverIntelligentStandardMaxTokens:
        typeof parsed.weaverIntelligentStandardMaxTokens === 'number' ? parsed.weaverIntelligentStandardMaxTokens : undefined,
      weaverIntelligentStandardTimeoutMs:
        typeof parsed.weaverIntelligentStandardTimeoutMs === 'number' ? parsed.weaverIntelligentStandardTimeoutMs : undefined,
      weaverIntelligentStandardIterationLimit:
        typeof parsed.weaverIntelligentStandardIterationLimit === 'number' ? parsed.weaverIntelligentStandardIterationLimit : undefined,
      weaverIntelligentGoHamMaxTokens:
        typeof parsed.weaverIntelligentGoHamMaxTokens === 'number' ? parsed.weaverIntelligentGoHamMaxTokens : undefined,
      weaverIntelligentGoHamTimeoutMs:
        typeof parsed.weaverIntelligentGoHamTimeoutMs === 'number' ? parsed.weaverIntelligentGoHamTimeoutMs : undefined,
      weaverIntelligentGoHamIterationLimit:
        typeof parsed.weaverIntelligentGoHamIterationLimit === 'number' ? parsed.weaverIntelligentGoHamIterationLimit : undefined,
      weaverGuidedInsertMaxOperations:
        typeof parsed.weaverGuidedInsertMaxOperations === 'number' ? parsed.weaverGuidedInsertMaxOperations : undefined,
      weaverIntelligentLightMaxOperations:
        typeof parsed.weaverIntelligentLightMaxOperations === 'number' ? parsed.weaverIntelligentLightMaxOperations : undefined,
      weaverIntelligentStandardMaxOperations:
        typeof parsed.weaverIntelligentStandardMaxOperations === 'number' ? parsed.weaverIntelligentStandardMaxOperations : undefined,
      weaverIntelligentGoHamMaxOperations:
        typeof parsed.weaverIntelligentGoHamMaxOperations === 'number' ? parsed.weaverIntelligentGoHamMaxOperations : undefined,
    };
  } catch (error) {
    const code = getFsErrorCode(error);

    if (code === 'ENOENT') {
      return createDefaultSettings();
    }

    console.warn('CrashWeaver: failed to read persisted settings, using defaults.', error);
    return createDefaultSettings();
  }
}

async function writeSettings(settings: PersistedSettings) {
  const filePath = getSettingsFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomically(filePath, settings);
}

async function mutateSettings<T>(mutator: (settings: PersistedSettings) => Promise<T> | T): Promise<T> {
  const pendingMutation = settingsMutationQueue.then(async () => {
    const settings = await readSettings();
    const result = await mutator(settings);
    await writeSettings(settings);
    return result;
  });

  settingsMutationQueue = pendingMutation.then(
    () => undefined,
    () => undefined,
  );

  return pendingMutation;
}

export async function getCardStoreConfig(rootPath: string): Promise<CardStoreConfig> {
  const settings = await readSettings();
  const vaultKey = getVaultKey(rootPath);
  const configuredPath = settings.cardStoreByVault[vaultKey];
  const cardStorePath = configuredPath ?? getDefaultCardStorePath(vaultKey);

  return {
    cardStorePath,
    isDefaultPath: cardStorePath === getDefaultCardStorePath(vaultKey),
  };
}

export async function setCardStorePath(rootPath: string, cardStorePath: string): Promise<CardStoreConfig> {
  const vaultKey = getVaultKey(rootPath);
  const resolvedCardStorePath = path.resolve(cardStorePath);

  return mutateSettings((settings) => {
    settings.cardStoreByVault[vaultKey] = resolvedCardStorePath;

    return {
      cardStorePath: resolvedCardStorePath,
      isDefaultPath: resolvedCardStorePath === getDefaultCardStorePath(vaultKey),
    };
  });
}

export async function getImageDirectories(rootPath: string): Promise<string[]> {
  const settings = await readSettings();
  const vaultKey = getVaultKey(rootPath);
  return toStringArray(settings.imageDirectoriesByVault[vaultKey]);
}

export async function setImageDirectories(rootPath: string, imageDirectories: string[]): Promise<string[]> {
  const vaultKey = getVaultKey(rootPath);
  const normalizedDirectories = normalizeDirectoryList(imageDirectories);

  return mutateSettings((settings) => {
    if (normalizedDirectories.length) {
      settings.imageDirectoriesByVault[vaultKey] = normalizedDirectories;
    } else {
      delete settings.imageDirectoriesByVault[vaultKey];
    }

    return normalizedDirectories;
  });
}

export async function getCrashpadDeletePreferences(): Promise<CrashpadDeletePreferences> {
  const settings = await readSettings();
  return settings.crashpadDeletePreferences;
}

export async function setCrashpadDeletePreferences(
  value: CrashpadDeletePreferences,
): Promise<CrashpadDeletePreferences> {
  const nextValue: CrashpadDeletePreferences = {
    removeNoteBoundariesByDefault: value.removeNoteBoundariesByDefault !== false,
    requireConfirmationForNewCards: value.requireConfirmationForNewCards !== false,
    requireStrictConfirmationForExistingCards: value.requireStrictConfirmationForExistingCards !== false,
  };

  return mutateSettings((settings) => {
    settings.crashpadDeletePreferences = nextValue;
    return nextValue;
  });
}

// ----- Weaver API key management (main-process only) -----

function encryptApiKey(key: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // safeStorage unavailable (rare on Electron 35+); store as-is with a prefix so we can detect it
    return `plain:${key}`;
  }

  return safeStorage.encryptString(key).toString('base64');
}

function decryptApiKey(encrypted: string): string {
  if (encrypted.startsWith('plain:')) {
    return encrypted.slice('plain:'.length);
  }

  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

export async function setOpenRouterApiKey(key: string): Promise<void> {
  const trimmed = key.trim();

  if (!trimmed) {
    return clearOpenRouterApiKey();
  }

  return mutateSettings((settings) => {
    settings.openrouterApiKeyEncrypted = encryptApiKey(trimmed);
  });
}

export async function clearOpenRouterApiKey(): Promise<void> {
  return mutateSettings((settings) => {
    delete settings.openrouterApiKeyEncrypted;
  });
}

export async function getOpenRouterApiKeyDecrypted(): Promise<string | null> {
  const settings = await readSettings();

  if (!settings.openrouterApiKeyEncrypted) {
    return null;
  }

  try {
    return decryptApiKey(settings.openrouterApiKeyEncrypted);
  } catch (error) {
    console.warn('CrashWeaver: failed to decrypt OpenRouter API key.', error);
    return null;
  }
}

function buildWeaverSettingsResponse(settings: PersistedSettings): WeaverSettings {
  const result: any = {
    configured: Boolean(settings.openrouterApiKeyEncrypted),
    preferredModel: settings.weaverPreferredModel ?? null,
  };

  if (settings.weaverDisableBudgetRestrictions !== undefined) {
    result.disableBudgetRestrictions = settings.weaverDisableBudgetRestrictions;
  }
  if (settings.weaverGuidedInsertBaseMaxTokens !== undefined) {
    result.guidedInsertBaseMaxTokens = settings.weaverGuidedInsertBaseMaxTokens;
  }
  if (settings.weaverGuidedInsertBaseTimeoutMs !== undefined) {
    result.guidedInsertBaseTimeoutMs = settings.weaverGuidedInsertBaseTimeoutMs;
  }
  if (settings.weaverGuidedInsertExpandedMaxTokens !== undefined) {
    result.guidedInsertExpandedMaxTokens = settings.weaverGuidedInsertExpandedMaxTokens;
  }
  if (settings.weaverGuidedInsertExpandedTimeoutMs !== undefined) {
    result.guidedInsertExpandedTimeoutMs = settings.weaverGuidedInsertExpandedTimeoutMs;
  }
  if (settings.weaverIntelligentLightMaxTokens !== undefined) {
    result.intelligentLightMaxTokens = settings.weaverIntelligentLightMaxTokens;
  }
  if (settings.weaverIntelligentLightTimeoutMs !== undefined) {
    result.intelligentLightTimeoutMs = settings.weaverIntelligentLightTimeoutMs;
  }
  if (settings.weaverIntelligentLightIterationLimit !== undefined) {
    result.intelligentLightIterationLimit = settings.weaverIntelligentLightIterationLimit;
  }
  if (settings.weaverIntelligentStandardMaxTokens !== undefined) {
    result.intelligentStandardMaxTokens = settings.weaverIntelligentStandardMaxTokens;
  }
  if (settings.weaverIntelligentStandardTimeoutMs !== undefined) {
    result.intelligentStandardTimeoutMs = settings.weaverIntelligentStandardTimeoutMs;
  }
  if (settings.weaverIntelligentStandardIterationLimit !== undefined) {
    result.intelligentStandardIterationLimit = settings.weaverIntelligentStandardIterationLimit;
  }
  if (settings.weaverIntelligentGoHamMaxTokens !== undefined) {
    result.intelligentGoHamMaxTokens = settings.weaverIntelligentGoHamMaxTokens;
  }
  if (settings.weaverIntelligentGoHamTimeoutMs !== undefined) {
    result.intelligentGoHamTimeoutMs = settings.weaverIntelligentGoHamTimeoutMs;
  }
  if (settings.weaverIntelligentGoHamIterationLimit !== undefined) {
    result.intelligentGoHamIterationLimit = settings.weaverIntelligentGoHamIterationLimit;
  }
  if (settings.weaverGuidedInsertMaxOperations !== undefined) {
    result.guidedInsertMaxOperations = settings.weaverGuidedInsertMaxOperations;
  }
  if (settings.weaverIntelligentLightMaxOperations !== undefined) {
    result.intelligentLightMaxOperations = settings.weaverIntelligentLightMaxOperations;
  }
  if (settings.weaverIntelligentStandardMaxOperations !== undefined) {
    result.intelligentStandardMaxOperations = settings.weaverIntelligentStandardMaxOperations;
  }
  if (settings.weaverIntelligentGoHamMaxOperations !== undefined) {
    result.intelligentGoHamMaxOperations = settings.weaverIntelligentGoHamMaxOperations;
  }

  return result;
}

export async function getWeaverSettings(): Promise<WeaverSettings> {
  const settings = await readSettings();
  return buildWeaverSettingsResponse(settings);
}

export async function setWeaverPreferredModel(preferredModel: string | null): Promise<WeaverSettings> {
  const normalizedPreferredModel = normalizePreferredModel(preferredModel);

  return mutateSettings((settings) => {
    if (normalizedPreferredModel) {
      settings.weaverPreferredModel = normalizedPreferredModel;
    } else {
      delete settings.weaverPreferredModel;
    }

    return buildWeaverSettingsResponse(settings);
  });
}

export async function updateWeaverSettings(updates: Partial<WeaverSettings>): Promise<WeaverSettings> {
  return mutateSettings((settings) => {
    if (updates.disableBudgetRestrictions !== undefined) {
      settings.weaverDisableBudgetRestrictions = updates.disableBudgetRestrictions;
    }
    if (updates.guidedInsertBaseMaxTokens !== undefined) {
      settings.weaverGuidedInsertBaseMaxTokens = normalizeBoundedNumber(
        updates.guidedInsertBaseMaxTokens,
        'guidedInsertBaseMaxTokens',
        WEAVER_BUDGET_BOUNDS.minTokens,
        WEAVER_BUDGET_BOUNDS.maxTokens,
      );
    }
    if (updates.guidedInsertBaseTimeoutMs !== undefined) {
      settings.weaverGuidedInsertBaseTimeoutMs = normalizeBoundedNumber(
        updates.guidedInsertBaseTimeoutMs,
        'guidedInsertBaseTimeoutMs',
        WEAVER_BUDGET_BOUNDS.minTimeoutMs,
        WEAVER_BUDGET_BOUNDS.maxTimeoutMs,
      );
    }
    if (updates.guidedInsertExpandedMaxTokens !== undefined) {
      settings.weaverGuidedInsertExpandedMaxTokens = normalizeBoundedNumber(
        updates.guidedInsertExpandedMaxTokens,
        'guidedInsertExpandedMaxTokens',
        WEAVER_BUDGET_BOUNDS.minTokens,
        WEAVER_BUDGET_BOUNDS.maxTokens,
      );
    }
    if (updates.guidedInsertExpandedTimeoutMs !== undefined) {
      settings.weaverGuidedInsertExpandedTimeoutMs = normalizeBoundedNumber(
        updates.guidedInsertExpandedTimeoutMs,
        'guidedInsertExpandedTimeoutMs',
        WEAVER_BUDGET_BOUNDS.minTimeoutMs,
        WEAVER_BUDGET_BOUNDS.maxTimeoutMs,
      );
    }
    if (updates.intelligentLightMaxTokens !== undefined) {
      settings.weaverIntelligentLightMaxTokens = normalizeBoundedNumber(
        updates.intelligentLightMaxTokens,
        'intelligentLightMaxTokens',
        WEAVER_BUDGET_BOUNDS.minTokens,
        WEAVER_BUDGET_BOUNDS.maxTokens,
      );
    }
    if (updates.intelligentLightTimeoutMs !== undefined) {
      settings.weaverIntelligentLightTimeoutMs = normalizeBoundedNumber(
        updates.intelligentLightTimeoutMs,
        'intelligentLightTimeoutMs',
        WEAVER_BUDGET_BOUNDS.minTimeoutMs,
        WEAVER_BUDGET_BOUNDS.maxTimeoutMs,
      );
    }
    if (updates.intelligentLightIterationLimit !== undefined) {
      settings.weaverIntelligentLightIterationLimit = normalizeBoundedNumber(
        updates.intelligentLightIterationLimit,
        'intelligentLightIterationLimit',
        WEAVER_BUDGET_BOUNDS.minIterations,
        WEAVER_BUDGET_BOUNDS.maxIterations,
      );
    }
    if (updates.intelligentStandardMaxTokens !== undefined) {
      settings.weaverIntelligentStandardMaxTokens = normalizeBoundedNumber(
        updates.intelligentStandardMaxTokens,
        'intelligentStandardMaxTokens',
        WEAVER_BUDGET_BOUNDS.minTokens,
        WEAVER_BUDGET_BOUNDS.maxTokens,
      );
    }
    if (updates.intelligentStandardTimeoutMs !== undefined) {
      settings.weaverIntelligentStandardTimeoutMs = normalizeBoundedNumber(
        updates.intelligentStandardTimeoutMs,
        'intelligentStandardTimeoutMs',
        WEAVER_BUDGET_BOUNDS.minTimeoutMs,
        WEAVER_BUDGET_BOUNDS.maxTimeoutMs,
      );
    }
    if (updates.intelligentStandardIterationLimit !== undefined) {
      settings.weaverIntelligentStandardIterationLimit = normalizeBoundedNumber(
        updates.intelligentStandardIterationLimit,
        'intelligentStandardIterationLimit',
        WEAVER_BUDGET_BOUNDS.minIterations,
        WEAVER_BUDGET_BOUNDS.maxIterations,
      );
    }
    if (updates.intelligentGoHamMaxTokens !== undefined) {
      settings.weaverIntelligentGoHamMaxTokens = normalizeBoundedNumber(
        updates.intelligentGoHamMaxTokens,
        'intelligentGoHamMaxTokens',
        WEAVER_BUDGET_BOUNDS.minTokens,
        WEAVER_BUDGET_BOUNDS.maxTokens,
      );
    }
    if (updates.intelligentGoHamTimeoutMs !== undefined) {
      settings.weaverIntelligentGoHamTimeoutMs = normalizeBoundedNumber(
        updates.intelligentGoHamTimeoutMs,
        'intelligentGoHamTimeoutMs',
        WEAVER_BUDGET_BOUNDS.minTimeoutMs,
        WEAVER_BUDGET_BOUNDS.maxTimeoutMs,
      );
    }
    if (updates.intelligentGoHamIterationLimit !== undefined) {
      settings.weaverIntelligentGoHamIterationLimit = normalizeBoundedNumber(
        updates.intelligentGoHamIterationLimit,
        'intelligentGoHamIterationLimit',
        WEAVER_BUDGET_BOUNDS.minIterations,
        WEAVER_BUDGET_BOUNDS.maxIterations,
      );
    }
    if (updates.guidedInsertMaxOperations !== undefined) {
      settings.weaverGuidedInsertMaxOperations = normalizeBoundedNumber(
        updates.guidedInsertMaxOperations,
        'guidedInsertMaxOperations',
        WEAVER_BUDGET_BOUNDS.minOperations,
        WEAVER_BUDGET_BOUNDS.maxOperations,
      );
    }
    if (updates.intelligentLightMaxOperations !== undefined) {
      settings.weaverIntelligentLightMaxOperations = normalizeBoundedNumber(
        updates.intelligentLightMaxOperations,
        'intelligentLightMaxOperations',
        WEAVER_BUDGET_BOUNDS.minOperations,
        WEAVER_BUDGET_BOUNDS.maxOperations,
      );
    }
    if (updates.intelligentStandardMaxOperations !== undefined) {
      settings.weaverIntelligentStandardMaxOperations = normalizeBoundedNumber(
        updates.intelligentStandardMaxOperations,
        'intelligentStandardMaxOperations',
        WEAVER_BUDGET_BOUNDS.minOperations,
        WEAVER_BUDGET_BOUNDS.maxOperations,
      );
    }
    if (updates.intelligentGoHamMaxOperations !== undefined) {
      settings.weaverIntelligentGoHamMaxOperations = normalizeBoundedNumber(
        updates.intelligentGoHamMaxOperations,
        'intelligentGoHamMaxOperations',
        WEAVER_BUDGET_BOUNDS.minOperations,
        WEAVER_BUDGET_BOUNDS.maxOperations,
      );
    }

    return buildWeaverSettingsResponse(settings);
  });
}

export async function getWeaverRequestLogsDirectory(): Promise<string | null> {
  const settings = await readSettings();
  return settings.weaverRequestLogsDirectory ?? null;
}

export async function setWeaverRequestLogsDirectory(directoryPath: string | null): Promise<string | null> {
  const normalizedDirectoryPath = normalizeLogDirectory(directoryPath);

  return mutateSettings((settings) => {
    if (normalizedDirectoryPath) {
      settings.weaverRequestLogsDirectory = normalizedDirectoryPath;
    } else {
      delete settings.weaverRequestLogsDirectory;
    }

    return settings.weaverRequestLogsDirectory ?? null;
  });
}
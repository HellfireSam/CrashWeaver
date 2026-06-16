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

type WeaverBudgetCategory = 'tokens' | 'timeoutMs' | 'iterations' | 'operations';

interface WeaverBudgetFieldDescriptor {
  /** Key in PersistedSettings (snake_case). */
  settingsKey: keyof PersistedSettings;
  /** Key in the WeaverSettings response object (camelCase). */
  responseKey: keyof WeaverSettings;
  /** Which validation bound category applies. */
  boundCategory: WeaverBudgetCategory;
}

/**
 * Single source of truth for every Weaver budget field.
 *
 * Adding a new budget knob requires ONLY adding an entry here —
 * readSettings, buildWeaverSettingsResponse, and updateWeaverSettings
 * all derive their behaviour from this registry.
 */
const WEAVER_BUDGET_FIELD_REGISTRY: WeaverBudgetFieldDescriptor[] = [
  { settingsKey: 'weaverGuidedInsertBaseMaxTokens',       responseKey: 'guidedInsertBaseMaxTokens',       boundCategory: 'tokens' },
  { settingsKey: 'weaverGuidedInsertBaseTimeoutMs',       responseKey: 'guidedInsertBaseTimeoutMs',       boundCategory: 'timeoutMs' },
  { settingsKey: 'weaverGuidedInsertExpandedMaxTokens',   responseKey: 'guidedInsertExpandedMaxTokens',   boundCategory: 'tokens' },
  { settingsKey: 'weaverGuidedInsertExpandedTimeoutMs',   responseKey: 'guidedInsertExpandedTimeoutMs',   boundCategory: 'timeoutMs' },
  { settingsKey: 'weaverIntelligentLightMaxTokens',       responseKey: 'intelligentLightMaxTokens',       boundCategory: 'tokens' },
  { settingsKey: 'weaverIntelligentLightTimeoutMs',       responseKey: 'intelligentLightTimeoutMs',       boundCategory: 'timeoutMs' },
  { settingsKey: 'weaverIntelligentLightIterationLimit',  responseKey: 'intelligentLightIterationLimit',  boundCategory: 'iterations' },
  { settingsKey: 'weaverIntelligentStandardMaxTokens',    responseKey: 'intelligentStandardMaxTokens',    boundCategory: 'tokens' },
  { settingsKey: 'weaverIntelligentStandardTimeoutMs',    responseKey: 'intelligentStandardTimeoutMs',    boundCategory: 'timeoutMs' },
  { settingsKey: 'weaverIntelligentStandardIterationLimit', responseKey: 'intelligentStandardIterationLimit', boundCategory: 'iterations' },
  { settingsKey: 'weaverIntelligentGoHamMaxTokens',       responseKey: 'intelligentGoHamMaxTokens',       boundCategory: 'tokens' },
  { settingsKey: 'weaverIntelligentGoHamTimeoutMs',       responseKey: 'intelligentGoHamTimeoutMs',       boundCategory: 'timeoutMs' },
  { settingsKey: 'weaverIntelligentGoHamIterationLimit',  responseKey: 'intelligentGoHamIterationLimit',  boundCategory: 'iterations' },
  { settingsKey: 'weaverGuidedInsertMaxOperations',       responseKey: 'guidedInsertMaxOperations',       boundCategory: 'operations' },
  { settingsKey: 'weaverIntelligentLightMaxOperations',   responseKey: 'intelligentLightMaxOperations',   boundCategory: 'operations' },
  { settingsKey: 'weaverIntelligentStandardMaxOperations', responseKey: 'intelligentStandardMaxOperations', boundCategory: 'operations' },
  { settingsKey: 'weaverIntelligentGoHamMaxOperations',   responseKey: 'intelligentGoHamMaxOperations',   boundCategory: 'operations' },
];

/** Returns the {min, max} bound pair for a budget category. */
function getBoundsForCategory(category: WeaverBudgetCategory): { min: number; max: number } {
  switch (category) {
    case 'tokens':     return { min: WEAVER_BUDGET_BOUNDS.minTokens,     max: WEAVER_BUDGET_BOUNDS.maxTokens };
    case 'timeoutMs':  return { min: WEAVER_BUDGET_BOUNDS.minTimeoutMs,  max: WEAVER_BUDGET_BOUNDS.maxTimeoutMs };
    case 'iterations': return { min: WEAVER_BUDGET_BOUNDS.minIterations, max: WEAVER_BUDGET_BOUNDS.maxIterations };
    case 'operations': return { min: WEAVER_BUDGET_BOUNDS.minOperations, max: WEAVER_BUDGET_BOUNDS.maxOperations };
  }
}

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

    // Build the settings object, pulling budget fields from the registry.
    const settings: PersistedSettings = {
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
    };

    // All budget fields from the registry — single loop, no per-field boilerplate.
    for (const field of WEAVER_BUDGET_FIELD_REGISTRY) {
      const raw = (parsed as Record<string, unknown>)[field.settingsKey];
      (settings as unknown as Record<string, unknown>)[field.settingsKey] =
        typeof raw === 'number' ? raw : undefined;
    }

    return settings;
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
    // safeStorage unavailable (rare on Electron 35+).
    // Store with a plain: prefix — this is NOT secure and the user
    // should be warned. The key will be readable by anyone with
    // filesystem access to the settings JSON file.
    console.warn(
      'CrashWeaver SECURITY: OS-level encryption is unavailable on this system. ' +
      'The OpenRouter API key will be stored in plaintext in the settings file. ' +
      'Anyone with access to this machine can read it.',
    );
    return `plain:${key}`;
  }

  return safeStorage.encryptString(key).toString('base64');
}

function decryptApiKey(encrypted: string): string {
  if (encrypted.startsWith('plain:')) {
    // One-time warning per process lifetime.
    if (!decryptApiKey._warnedPlaintext) {
      console.warn(
        'CrashWeaver SECURITY: Reading OpenRouter API key from plaintext storage. ' +
        'Re-save your API key in Settings → Weaver to attempt OS-level encryption.',
      );
      decryptApiKey._warnedPlaintext = true;
    }
    return encrypted.slice('plain:'.length);
  }

  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}
decryptApiKey._warnedPlaintext = false;

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
  const result: Record<string, unknown> = {
    configured: Boolean(settings.openrouterApiKeyEncrypted),
    preferredModel: settings.weaverPreferredModel ?? null,
  };

  if (settings.weaverDisableBudgetRestrictions !== undefined) {
    result.disableBudgetRestrictions = settings.weaverDisableBudgetRestrictions;
  }

  // All budget fields from the registry — single loop.
  for (const field of WEAVER_BUDGET_FIELD_REGISTRY) {
    const value = settings[field.settingsKey];
    if (value !== undefined) {
      result[field.responseKey] = value;
    }
  }

  return result as unknown as WeaverSettings;
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

    // All budget fields — single loop over the registry with validation.
    for (const field of WEAVER_BUDGET_FIELD_REGISTRY) {
      const updateValue = (updates as Record<string, unknown>)[field.responseKey];
      if (updateValue !== undefined) {
        const bounds = getBoundsForCategory(field.boundCategory);
        (settings as unknown as Record<string, unknown>)[field.settingsKey] = normalizeBoundedNumber(
          updateValue,
          field.responseKey,
          bounds.min,
          bounds.max,
        );
      }
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
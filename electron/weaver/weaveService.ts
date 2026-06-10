import fs from 'node:fs/promises';
import path from 'node:path';
import { StubWeaveProvider } from './stubWeaveProvider';
import { OpenRouterWeaveProvider } from './openRouterClient';
import { buildWeaveContextSnapshot, type WeaveContextSnapshot } from './weaveContextService';
import { validateWeavePlanRequest, validateWeavePlanResult } from './weavePlanSchema';
import {
  getOpenRouterApiKeyDecrypted,
  setOpenRouterApiKey,
  clearOpenRouterApiKey,
  getWeaverSettings,
  setWeaverPreferredModel as persistWeaverPreferredModel,
  updateWeaverSettings as persistUpdateWeaverSettings,
  getWeaverRequestLogsDirectory,
  setWeaverRequestLogsDirectory as persistWeaverRequestLogsDirectory,
} from '../settingsService';
import type { WeavePlanRequest, WeavePlanResult, WeaveModelProvider, WeaveModelInfo, WeaveProviderHealth, WeaverSettings, WeaverKeyStatus } from '../vault-contract';

export type { WeaveModelProvider };

interface InternalWeaveModelProvider {
  generatePlan(
    request: WeavePlanRequest,
    context: WeaveContextSnapshot,
    options?: { requestLogDirectory?: string },
  ): Promise<WeavePlanResult>;
  healthCheck(): Promise<WeaveProviderHealth>;
  listModels(): Promise<WeaveModelInfo[]>;
}

let activeProvider: InternalWeaveModelProvider = new StubWeaveProvider();

async function assertVaultRoot(rootPath: string) {
  const resolvedRoot = path.resolve(rootPath);

  let stats;

  try {
    stats = await fs.stat(resolvedRoot);
  } catch {
    throw new Error(`Vault path does not exist: ${rootPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${rootPath}`);
  }

  return resolvedRoot;
}

export function __setWeaveProviderForTests(provider: InternalWeaveModelProvider) {
  activeProvider = provider;
}

export function __resetWeaveProviderForTests() {
  activeProvider = new StubWeaveProvider();
}

export async function initializeWeaveProvider(): Promise<void> {
  const apiKey = await getOpenRouterApiKeyDecrypted();
  const settings = await getWeaverSettings();

  if (apiKey) {
    activeProvider = new OpenRouterWeaveProvider(apiKey, settings.preferredModel);
    console.log('CrashWeaver: Weaver initialized with OpenRouter provider.');
  } else {
    activeProvider = new StubWeaveProvider();
    console.log('CrashWeaver: Weaver initialized with stub provider (no API key configured).');
  }
}

export async function setWeaveApiKey(key: string): Promise<void> {
  await setOpenRouterApiKey(key);
  await initializeWeaveProvider();
}

export async function clearWeaveApiKey(): Promise<void> {
  await clearOpenRouterApiKey();
  await initializeWeaveProvider();
}

export async function setWeaverPreferredModel(preferredModel: string | null): Promise<WeaverSettings> {
  const settings = await persistWeaverPreferredModel(preferredModel);
  await initializeWeaveProvider();
  return settings;
}

export async function updateWeaverSettings(updates: Partial<WeaverSettings>): Promise<WeaverSettings> {
  const settings = await persistUpdateWeaverSettings(updates);
  await initializeWeaveProvider();
  return settings;
}

export async function getConfiguredWeaverRequestLogsDirectory(): Promise<string | null> {
  return getWeaverRequestLogsDirectory();
}

export async function setConfiguredWeaverRequestLogsDirectory(directoryPath: string | null): Promise<string | null> {
  return persistWeaverRequestLogsDirectory(directoryPath);
}

export async function getWeaverKeyStatus(): Promise<WeaverKeyStatus> {
  const settings = await getWeaverSettings();
  return { configured: settings.configured };
}

export { getWeaverSettings };

export async function listWeaveModels() {
  return activeProvider.listModels();
}

export async function generateWeavePlan(request: WeavePlanRequest) {
  const validatedRequest = validateWeavePlanRequest(request);
  const resolvedRoot = await assertVaultRoot(validatedRequest.rootPath);
  const configuredLogsDirectory = await getWeaverRequestLogsDirectory();
  const requestLogDirectory = configuredLogsDirectory ?? path.join(resolvedRoot, '.crashweaver', 'weaver-request-logs');
  const normalizedRequest = {
    ...validatedRequest,
    rootPath: resolvedRoot,
  };
  const context = await buildWeaveContextSnapshot(normalizedRequest);
  const result = await activeProvider.generatePlan(normalizedRequest, context, { requestLogDirectory });
  return validateWeavePlanResult(result, {
    ...validatedRequest,
    rootPath: resolvedRoot,
  });
}

export function checkWeaveProvider() {
  return activeProvider.healthCheck();
}
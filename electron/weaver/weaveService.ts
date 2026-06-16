import fs from 'node:fs/promises';
import path from 'node:path';
import { net } from 'electron';
import { StubWeaveProvider } from './stubWeaveProvider';
import { OpenRouterWeaveProvider, clearModelListCache } from './openRouterClient';
import { buildWeaveContextSnapshot, type WeaveContextSnapshot } from './weaveContextService';
import { validateWeavePlanRequest, validateWeavePlanResult } from './weavePlanSchema';
import {
  listWeaverSessions,
  getWeaverSession,
  deleteWeaverSession,
  clearWeaverSessions,
  type WeaverSessionSummary,
  type WeaverSessionDetail,
} from './weaverSessionHistory';
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
import type { WeaveProgressCallback } from './weaveGraphState';

export type { WeaveModelProvider };

interface InternalWeaveModelProvider {
  generatePlan(
    request: WeavePlanRequest,
    context: WeaveContextSnapshot,
    options?: { requestLogDirectory?: string; onProgress?: WeaveProgressCallback },
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
    // Pre-fetch model list in the background so the picker is warm on first open
    activeProvider.listModels().catch(() => {});
  } else {
    activeProvider = new StubWeaveProvider();
    console.log('CrashWeaver: Weaver initialized with stub provider (no API key configured).');
  }
}

export function isStubProviderActive(): boolean {
  return activeProvider instanceof StubWeaveProvider;
}

export async function setWeaveApiKey(key: string): Promise<void> {
  await setOpenRouterApiKey(key);
  clearModelListCache();
  await initializeWeaveProvider();
}

export async function clearWeaveApiKey(): Promise<void> {
  await clearOpenRouterApiKey();
  clearModelListCache();
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

export async function generateWeavePlan(
  request: WeavePlanRequest,
  onProgress?: WeaveProgressCallback,
) {
  const settings = await getWeaverSettings();
  const validatedRequest = validateWeavePlanRequest(request, settings);
  const resolvedRoot = await assertVaultRoot(validatedRequest.rootPath);
  const configuredLogsDirectory = await getWeaverRequestLogsDirectory();
  const requestLogDirectory = configuredLogsDirectory ?? path.join(resolvedRoot, '.crashweaver', 'weaver-request-logs');
  const normalizedRequest = {
    ...validatedRequest,
    rootPath: resolvedRoot,
  };

  // Attempt to enrich context with embeddings if an API key is configured
  let embeddingOptions: import('./weaveContextService').BuildWeaveContextOptions['embedding'] | undefined;
  try {
    const apiKey = await getOpenRouterApiKeyDecrypted();
    if (apiKey) {
      embeddingOptions = {
        apiKey,
        fetchImpl: net.fetch.bind(net),
        appUrl: 'https://github.com/crashweaver/app',
      };
    }
  } catch {
    // No API key configured — embeddings are unavailable, keyword ranking only
  }

  const context = await buildWeaveContextSnapshot(normalizedRequest, {
    ...(embeddingOptions ? { embedding: embeddingOptions } : {}),
    settings,
  });
  const result = await activeProvider.generatePlan(normalizedRequest, context, {
    requestLogDirectory,
    onProgress,
  });
  return validateWeavePlanResult(result, normalizedRequest, settings);
}

export function checkWeaveProvider() {
  return activeProvider.healthCheck();
}

// ── Session history ───────────────────────────────────────────────────────────

export type { WeaverSessionSummary, WeaverSessionDetail, WeaverSessionStep } from './weaverSessionHistory';

async function resolveSessionLogsDirectory(rootPath?: string): Promise<string | null> {
  const configuredDirectory = await getWeaverRequestLogsDirectory();
  if (configuredDirectory) return configuredDirectory;
  // Fall back to the vault's default weaver-request-logs directory
  if (rootPath) return path.join(rootPath, '.crashweaver', 'weaver-request-logs');
  return null;
}

export async function listSessions(rootPath?: string): Promise<WeaverSessionSummary[]> {
  const logsDir = await resolveSessionLogsDirectory(rootPath);
  if (!logsDir) return [];
  return listWeaverSessions(logsDir);
}

export async function getSession(sessionId: string, rootPath?: string): Promise<WeaverSessionDetail | null> {
  const logsDir = await resolveSessionLogsDirectory(rootPath);
  if (!logsDir) return null;
  return getWeaverSession(logsDir, sessionId);
}

export async function deleteSession(sessionId: string, rootPath?: string): Promise<boolean> {
  const logsDir = await resolveSessionLogsDirectory(rootPath);
  if (!logsDir) return false;
  return deleteWeaverSession(logsDir, sessionId);
}

export async function clearSessions(rootPath?: string): Promise<number> {
  const logsDir = await resolveSessionLogsDirectory(rootPath);
  if (!logsDir) return 0;
  return clearWeaverSessions(logsDir);
}
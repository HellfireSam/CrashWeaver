import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WeavePlanRequest } from '../vault-contract';

interface LoggerEvent {
  ts: string;
  sessionId: string;
  event: string;
  payload: Record<string, unknown>;
}

function toIsoString(now: number) {
  return new Date(now).toISOString();
}

function sanitizeIsoForFileName(isoString: string) {
  return isoString.replace(/[:.]/g, '-');
}

function truncateString(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 13))}[...truncated]`;
}

function sanitizePayload(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncateString(value, 10_000);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizePayload);
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitized = Object.fromEntries(entries.map(([key, entry]) => [key, sanitizePayload(entry)]));
    return sanitized;
  }

  return value;
}

async function appendJsonLine(filePath: string, event: LoggerEvent) {
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
}

export class WeaveRequestSessionLogger {
  readonly sessionId: string;
  readonly filePath: string;

  constructor(
    private readonly directoryPath: string,
    private readonly now: () => number,
  ) {
    this.sessionId = randomUUID();
    const startedAt = toIsoString(this.now());
    const fileName = `${sanitizeIsoForFileName(startedAt)}-${this.sessionId}.jsonl`;
    this.filePath = path.join(this.directoryPath, fileName);
  }

  async initialize(request: WeavePlanRequest) {
    await fs.mkdir(this.directoryPath, { recursive: true });
    await this.log('session-start', {
      request: {
        kind: request.kind,
        rootPath: request.rootPath,
        cardUid: request.cardUid,
        intent: request.intent,
        preferredModel: request.preferredModel,
        activeNotePath: request.activeNotePath,
        activeCrashpadId: request.activeCrashpadId,
        activeCrashpadPath: request.activeCrashpadPath,
      },
    });
  }

  async log(event: string, payload: Record<string, unknown>) {
    await appendJsonLine(this.filePath, {
      ts: toIsoString(this.now()),
      sessionId: this.sessionId,
      event,
      payload: sanitizePayload(payload) as Record<string, unknown>,
    });
  }
}

export async function createWeaveRequestSessionLogger(
  request: WeavePlanRequest,
  requestLogDirectory: string,
  now: () => number,
) {
  const logger = new WeaveRequestSessionLogger(requestLogDirectory, now);
  await logger.initialize(request);
  return logger;
}
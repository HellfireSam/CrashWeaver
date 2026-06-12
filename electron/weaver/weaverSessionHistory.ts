/**
 * weaverSessionHistory.ts
 *
 * Session history module for the Weaver planner.
 *
 * Scans the weaver-request-logs directory for past session JSONL files,
 * extracts session-level metadata (request parameters, results, errors),
 * and provides list/get/delete operations.
 *
 * Designed to power a VS Code-style session history panel where users can
 * browse past Weaver plans, re-run them, or clean up old sessions.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeaverSessionSummary {
  /** UUID assigned at session creation. */
  sessionId: string;
  /** ISO-8601 timestamp of session start. */
  startedAt: string;
  /** 'guided-insert' or 'intelligent'. */
  requestKind: string;
  /** The focused card UID for this plan request. */
  cardUid: string;
  /** User-provided intent description. */
  intent: string;
  /** Resolved model ID used for generation. */
  model: string;
  /** Whether the plan generation succeeded. */
  success: boolean;
  /** Number of plan operations (only when success=true). */
  operations?: number;
  /** Total latency in milliseconds (only when success=true). */
  latencyMs?: number;
  /** Error message (only when success=false). */
  errorMessage?: string;
  /** The JSONL file name (for deletion). */
  fileName: string;
}

export interface WeaverSessionDetail extends WeaverSessionSummary {
  /** Full plan result if successful. */
  plan?: unknown;
  /** Full request parameters. */
  request?: unknown;
  /** Budget and context summary from the session. */
  budget?: unknown;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

interface JsonLineEvent {
  event: string;
  payload: Record<string, unknown>;
}

async function readJsonLines(filePath: string): Promise<JsonLineEvent[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    return lines.map((line) => {
      try {
        return JSON.parse(line) as JsonLineEvent;
      } catch {
        return { event: 'parse-error', payload: { raw: line.slice(0, 200) } };
      }
    });
  } catch {
    return [];
  }
}

function findFirstEvent(events: JsonLineEvent[], eventName: string): JsonLineEvent | undefined {
  return events.find((e) => e.event === eventName);
}

function findLastEvent(events: JsonLineEvent[], eventName: string): JsonLineEvent | undefined {
  return [...events].reverse().find((e) => e.event === eventName);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Lists all Weaver sessions found in the logs directory.
 * Sessions are sorted newest-first by start timestamp.
 */
export async function listWeaverSessions(logsDirectory: string): Promise<WeaverSessionSummary[]> {
  let fileNames: string[];

  try {
    const entries = await fs.readdir(logsDirectory);
    fileNames = entries.filter((name) => name.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const sessions: WeaverSessionSummary[] = [];

  for (const fileName of fileNames) {
    const filePath = path.join(logsDirectory, fileName);
    const events = await readJsonLines(filePath);

    if (events.length === 0) continue;

    const sessionStart = findFirstEvent(events, 'session-start');
    if (!sessionStart) continue;

    const graphComplete = findLastEvent(events, 'graph-complete');

    const request = sessionStart.payload.request as Record<string, unknown> | undefined;
    const sessionId = (sessionStart.payload as { sessionId?: string }).sessionId ?? fileName.replace('.jsonl', '');

    sessions.push({
      sessionId,
      startedAt: (sessionStart as { ts?: string }).ts ?? '',
      requestKind: String(request?.kind ?? 'unknown'),
      cardUid: String(request?.cardUid ?? 'unknown'),
      intent: String(request?.intent ?? ''),
      model: String(graphComplete?.payload?.model ?? request?.preferredModel ?? 'unknown'),
      success: graphComplete?.payload?.success === true,
      operations: graphComplete?.payload?.operations as number | undefined,
      latencyMs: graphComplete?.payload?.latencyMs as number | undefined,
      errorMessage: graphComplete?.payload?.errorMessage as string | undefined,
      fileName,
    });
  }

  // Sort newest first by parsing the ISO timestamp from fileName or startedAt
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return sessions;
}

/**
 * Returns the full detail for a single session, including plan and request data.
 */
export async function getWeaverSession(
  logsDirectory: string,
  sessionId: string,
): Promise<WeaverSessionDetail | null> {
  let fileNames: string[];

  try {
    const entries = await fs.readdir(logsDirectory);
    fileNames = entries.filter((name) => name.endsWith('.jsonl'));
  } catch {
    return null;
  }

  // Find the file matching this session ID
  const fileName = fileNames.find((name) => name.includes(sessionId));
  if (!fileName) return null;

  const filePath = path.join(logsDirectory, fileName);
  const events = await readJsonLines(filePath);

  if (events.length === 0) return null;

  const sessionStart = findFirstEvent(events, 'session-start');
  if (!sessionStart) return null;

  const graphComplete = findLastEvent(events, 'graph-complete');
  const budgetResolved = findFirstEvent(events, 'budget-resolved');

  const request = sessionStart.payload.request as Record<string, unknown> | undefined;

  const summary: WeaverSessionDetail = {
    sessionId,
    startedAt: (sessionStart as { ts?: string }).ts ?? '',
    requestKind: String(request?.kind ?? 'unknown'),
    cardUid: String(request?.cardUid ?? 'unknown'),
    intent: String(request?.intent ?? ''),
    model: String(graphComplete?.payload?.model ?? request?.preferredModel ?? 'unknown'),
    success: graphComplete?.payload?.success === true,
    operations: graphComplete?.payload?.operations as number | undefined,
    latencyMs: graphComplete?.payload?.latencyMs as number | undefined,
    errorMessage: graphComplete?.payload?.errorMessage as string | undefined,
    fileName,
    request: request ?? null,
    budget: budgetResolved?.payload ?? null,
    plan: null,
  };

  // Extract the full validated plan from the validate-success event
  const validateSuccess = findLastEvent(events, 'node-validate-success');
  if (validateSuccess) {
    summary.plan = validateSuccess.payload;
  }

  return summary;
}

/**
 * Deletes a single session log file.
 */
export async function deleteWeaverSession(
  logsDirectory: string,
  sessionId: string,
): Promise<boolean> {
  let fileNames: string[];

  try {
    const entries = await fs.readdir(logsDirectory);
    fileNames = entries.filter((name) => name.endsWith('.jsonl'));
  } catch {
    return false;
  }

  const fileName = fileNames.find((name) => name.includes(sessionId));
  if (!fileName) return false;

  const filePath = path.join(logsDirectory, fileName);
  await fs.unlink(filePath);
  return true;
}

/**
 * Deletes all session log files in the directory.
 * Returns the number of files deleted.
 */
export async function clearWeaverSessions(logsDirectory: string): Promise<number> {
  let fileNames: string[];

  try {
    const entries = await fs.readdir(logsDirectory);
    fileNames = entries.filter((name) => name.endsWith('.jsonl'));
  } catch {
    return 0;
  }

  let deleted = 0;
  for (const fileName of fileNames) {
    try {
      await fs.unlink(path.join(logsDirectory, fileName));
      deleted += 1;
    } catch {
      // Skip files that can't be deleted
    }
  }

  return deleted;
}

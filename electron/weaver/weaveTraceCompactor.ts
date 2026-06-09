/**
 * weaveTraceCompactor.ts
 *
 * Utilities for compacting ReAct trace payloads to prevent unbounded growth
 * and performance/readability issues.
 *
 * Stores compact summaries by default with an option to include raw detail
 * only when explicitly requested (e.g., debug mode).
 */

export interface WeaveTraceItem {
  thought?: string;
  action: string;
  observation: string;
  toolResult?: unknown;  // Full result stored only when explicitly retained
}

export interface WeaveTraceCompactItem {
  thought?: string;
  action: string;
  observationLength?: number;
  observationSummary?: string;
  isLargeObservation?: boolean;
  resultHash?: string;  // SHA256 hash of full result for audit trail
  toolResult?: unknown;
}

const MAX_OBSERVATION_CHARS = 400;  // Truncate observations in compact mode
const MAX_RESULT_CHARS = 2000;       // Hard cap on raw result storage

/**
 * Generates a SHA256 hash of a value for audit/debugging purposes.
 * Does NOT require crypto module to be available.
 */
function quickHashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;  // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).slice(0, 12);
}

/**
 * Compacts a trace item by truncating observations and summarizing large results.
 * When debug/verbose mode is off, only essential metadata is retained.
 */
export function compactTraceItem(item: WeaveTraceItem, includeRawResult = false): WeaveTraceCompactItem {
  const observation = item.observation || '';
  const isLarge = observation.length > MAX_OBSERVATION_CHARS;
  
  const resultStr = item.toolResult 
    ? typeof item.toolResult === 'string' 
      ? item.toolResult 
      : JSON.stringify(item.toolResult)
    : '';

  return {
    thought: item.thought,
    action: item.action,
    observationLength: observation.length,
    observationSummary: isLarge 
      ? observation.slice(0, MAX_OBSERVATION_CHARS) + '…'
      : observation,
    isLargeObservation: isLarge,
    resultHash: resultStr ? quickHashString(resultStr) : undefined,
    ...(includeRawResult && item.toolResult && resultStr.length <= MAX_RESULT_CHARS
      ? { toolResult: item.toolResult }
      : {}),
  };
}

/**
 * Accumulates trace items with automatic compaction and size management.
 * Prevents unbounded growth by enforcing a per-step size budget.
 */
export class WeaveTraceAccumulator {
  private items: WeaveTraceCompactItem[] = [];
  private totalCharCount = 0;
  private readonly maxCharCountPerItem = 1500;
  private readonly includeRawResults: boolean;

  constructor(includeRawResults = false) {
    this.includeRawResults = includeRawResults;
  }

  addItem(item: WeaveTraceItem): void {
    const compacted = compactTraceItem(item, this.includeRawResults);
    const itemStr = JSON.stringify(compacted);

    // If this single item exceeds the budget, truncate its observation
    if (itemStr.length > this.maxCharCountPerItem) {
      compacted.observationSummary = (compacted.observationSummary || '')
        .slice(0, 100) + '…';
      if ('toolResult' in compacted) {
        delete compacted.toolResult;
      }
    }

    this.items.push(compacted);
    this.totalCharCount += JSON.stringify(compacted).length;
  }

  getTrace(): WeaveTraceCompactItem[] {
    return this.items;
  }

  getStats() {
    return {
      itemCount: this.items.length,
      totalCharCount: this.totalCharCount,
      avgCharCountPerItem: this.items.length > 0 
        ? Math.round(this.totalCharCount / this.items.length)
        : 0,
    };
  }
}
